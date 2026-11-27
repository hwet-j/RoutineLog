"""
제공자(Kotlin) 로직의 Python 참조 구현. docs/provider-sql.md 의 SQL 과 규칙을 그대로 옮겼다.
Kotlin 쪽(RoutineApi.kt)은 이 파일을 한 줄씩 옮긴 것이므로, 규칙을 바꿀 때는 여기와 문서를 먼저 고친다.
"""
import json
import re
import sqlite3
import uuid
from datetime import date as _date, datetime, timedelta, timezone

DATE_MIN, DATE_MAX = "2000-01-01", "2100-12-31"
MAX_SPAN_DAYS = 400
DEFAULT_WINDOW_DAYS = 14
MAX_LOGS = 3000
REQ_ID_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_NAME, MAX_NOTE, MAX_COUNT = 80, 500, 1000
MAX_VALUE = 1_000_000_000


class RoutineError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


# ---- SQL (docs/provider-sql.md 와 동일) -------------------------------------------------
SQL_ROUTINES = """
SELECT id, name, kind, detail, schedule, weekdays, interval_days, weekly_count, start_date, end_date, daily_target, unit, archived
FROM routines ORDER BY archived, sort, created_at, name"""
SQL_ROUTINES_LITE = "SELECT id, name, kind, archived FROM routines ORDER BY sort, created_at, name"
SQL_TIMES = "SELECT routine_id, time, label FROM routine_times ORDER BY routine_id, time, id"
SQL_TIMES_FOR = "SELECT time, label FROM routine_times WHERE routine_id = ? ORDER BY time, id"
SQL_LOG_SELECT = """
SELECT l.id, l.routine_id, r.name AS routine, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source
FROM logs l JOIN routines r ON r.id = l.routine_id"""
SQL_LOG_RANGE = SQL_LOG_SELECT + """
WHERE l.date >= ? AND l.date <= ?
ORDER BY l.date DESC, COALESCE(l.slot,'') DESC, l.logged_at DESC, l.id DESC LIMIT ?"""
SQL_LOG_BY_ID = SQL_LOG_SELECT + " WHERE l.id = ?"
SQL_LOG_BY_REF = "SELECT id FROM logs WHERE source_ref = ?"
SQL_LOG_SLOT = "SELECT id, status FROM logs WHERE routine_id = ? AND date = ? AND slot = ?"
SQL_LOG_NOSLOT = "SELECT id, status FROM logs WHERE routine_id = ? AND date = ? AND slot IS NULL"
SQL_SLOTS_USED = "SELECT slot FROM logs WHERE routine_id = ? AND date = ? AND slot IS NOT NULL"
SQL_INSERT = """INSERT INTO logs(id,routine_id,date,slot,status,count,value,note,logged_at,source,source_ref)
VALUES(?,?,?,?,?,?,?,?,?,'assistant',?)"""
SQL_DELETE = "DELETE FROM logs WHERE id = ?"
SQL_PROGRESS_COUNT = "SELECT COUNT(*) FROM logs WHERE routine_id = ? AND date = ? AND status = 'done'"
SQL_PROGRESS_SUM = "SELECT COALESCE(SUM(count),0) FROM logs WHERE routine_id = ? AND date = ? AND status = 'done'"
SQL_ROUTINE_BY_ID = "SELECT id, name, kind, daily_target FROM routines WHERE id = ?"
SQL_KV = "SELECT value FROM kv WHERE key = ?"


def connect(path=":memory:"):
    db = sqlite3.connect(path, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=3000")
    return db


def now_iso(now=None):
    n = datetime.now(timezone.utc) if now is None else now
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def norm(s):
    return "".join(str(s).split()).lower()


# ---- 하루 시작 시각 / 오늘 ------------------------------------------------------------------
def day_start_minutes(db):
    r = db.execute(SQL_KV, ("day_start",)).fetchone()
    if r and isinstance(r["value"], str) and HHMM_RE.match(r["value"]):
        return int(r["value"][:2]) * 60 + int(r["value"][3:])
    return 0


def logical_today(db, now):
    """하루 시작 시각(kv 'day_start', 기본 00:00) 이전의 새벽은 전날로 센다"""
    m = now.hour * 60 + now.minute
    d = now.date()
    if m < day_start_minutes(db):
        d = d - timedelta(days=1)
    return d.isoformat()


def logical_minutes(db, now):
    m = now.hour * 60 + now.minute
    return m + 1440 if m < day_start_minutes(db) else m


def slot_minutes(db, hhmm):
    m = int(hhmm[:2]) * 60 + int(hhmm[3:])
    return m + 1440 if m < day_start_minutes(db) else m


# ---- 입력 검증 ----------------------------------------------------------------------------
def v_date(v):
    if not isinstance(v, str) or not DATE_RE.match(v):
        raise RoutineError("invalid", "date 는 YYYY-MM-DD 형식이어야 해요")
    try:
        _date.fromisoformat(v)
    except ValueError:
        raise RoutineError("invalid", "존재하지 않는 날짜예요")
    if v < DATE_MIN or v > DATE_MAX:
        raise RoutineError("invalid", f"date 는 {DATE_MIN} ~ {DATE_MAX} 사이여야 해요")
    return v


def v_count(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not v.is_integer()):
        raise RoutineError("invalid", "count 는 정수여야 해요")
    v = int(v)
    if v < 1 or v > MAX_COUNT:
        raise RoutineError("invalid", f"count 는 1 ~ {MAX_COUNT} 사이여야 해요")
    return v


def v_value(v):
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise RoutineError("invalid", "value 는 숫자여야 해요")
    f = float(v)
    if f != f or f in (float("inf"), float("-inf")) or abs(f) > MAX_VALUE:
        raise RoutineError("invalid", "value 가 올바르지 않아요")
    return f


def v_note(v):
    if v is None:
        return None
    if not isinstance(v, str):
        raise RoutineError("invalid", "note 는 문자열이어야 해요")
    s = v.strip()
    if len(s) > MAX_NOTE:
        raise RoutineError("invalid", f"note 는 {MAX_NOTE}자 이하여야 해요")
    return s or None


# ---- JSON ----------------------------------------------------------------------------------
def log_json(r):
    o = {"id": r["id"], "routine": r["routine"], "routine_id": r["routine_id"], "date": r["date"]}
    if r["slot"] is not None:
        o["slot"] = r["slot"]
    o["status"] = r["status"]
    o["count"] = r["count"]
    if r["value"] is not None:
        o["value"] = r["value"]
    if r["note"] is not None:
        o["note"] = r["note"]
    o["logged_at"] = r["logged_at"]
    o["source"] = r["source"]
    return o


def load_log(db, log_id):
    r = db.execute(SQL_LOG_BY_ID, (log_id,)).fetchone()
    return log_json(r) if r else None


def progress(db, routine_id, kind, target, n_times, d):
    """habit: 그날 done 로그의 count 합 / daily_target. 복약·영양제: done 슬롯 수 / 시각 개수(없으면 1)"""
    if kind == "habit":
        done = db.execute(SQL_PROGRESS_SUM, (routine_id, d)).fetchone()[0]
        return {"date": d, "done": int(done), "target": int(target)}
    done = db.execute(SQL_PROGRESS_COUNT, (routine_id, d)).fetchone()[0]
    return {"date": d, "done": int(done), "target": max(n_times, 1)}


def progress_for(db, routine_id, d):
    r = db.execute(SQL_ROUTINE_BY_ID, (routine_id,)).fetchone()
    n = len(db.execute(SQL_TIMES_FOR, (routine_id,)).fetchall())
    return progress(db, routine_id, r["kind"], r["daily_target"], n, d)


# ---- query ---------------------------------------------------------------------------------
def query(db, arg=None, now=None, now_ms=0):
    now = now or datetime.now()
    arg = arg or {}
    if not isinstance(arg, dict):
        raise RoutineError("invalid", "요청 형식이 올바르지 않아요")
    today = logical_today(db, now)
    to = v_date(arg["to"]) if arg.get("to") is not None else today
    frm = v_date(arg["from"]) if arg.get("from") is not None else (_date.fromisoformat(to) - timedelta(days=DEFAULT_WINDOW_DAYS)).isoformat()
    if frm > to:
        raise RoutineError("invalid", "from 이 to 보다 늦어요")
    if (_date.fromisoformat(to) - _date.fromisoformat(frm)).days > MAX_SPAN_DAYS:
        raise RoutineError("invalid", f"기간은 최대 {MAX_SPAN_DAYS}일까지예요")
    times = {}
    for t in db.execute(SQL_TIMES).fetchall():
        o = {"time": t["time"]}
        if t["label"]:
            o["label"] = t["label"]
        times.setdefault(t["routine_id"], []).append(o)
    routines = []
    for r in db.execute(SQL_ROUTINES).fetchall():
        o = {"id": r["id"], "name": r["name"], "kind": r["kind"]}
        for k in ("detail",):
            if r[k] is not None:
                o[k] = r[k]
        o["schedule"], o["weekdays"] = r["schedule"], r["weekdays"]
        for k in ("interval_days", "weekly_count"):
            if r[k] is not None:
                o[k] = r[k]
        o["start_date"] = r["start_date"]
        if r["end_date"] is not None:
            o["end_date"] = r["end_date"]
        o["daily_target"] = r["daily_target"]
        if r["unit"] is not None:
            o["unit"] = r["unit"]
        o["times"] = times.get(r["id"], [])
        o["archived"] = bool(r["archived"])
        routines.append(o)
    rows = db.execute(SQL_LOG_RANGE, (frm, to, MAX_LOGS + 1)).fetchall()
    return {"v": 1, "app": "routinelog", "ts": now_ms, "today": today, "from": frm, "to": to,
            "routines": routines, "logs": [log_json(r) for r in rows[:MAX_LOGS]], "truncated": len(rows) > MAX_LOGS}


# ---- 루틴·슬롯 선택 ---------------------------------------------------------------------------
def resolve_routine(db, ref):
    rows = db.execute(SQL_ROUTINES_LITE).fetchall()
    ref_s = str(ref).strip()
    if len(ref_s) > MAX_NAME:
        raise RoutineError("invalid", f"routine 은 {MAX_NAME}자 이하여야 해요")
    for r in rows:
        if r["id"] == ref_s:
            if r["archived"]:
                raise RoutineError("invalid", f"'{r['name']}' 루틴은 보관 상태라 기록할 수 없어요")
            return r
    pool = [r for r in rows if not r["archived"]]
    n = norm(ref_s)
    if not n:
        raise RoutineError("invalid", "routine 이름이 비어 있어요")
    exact = [r for r in pool if norm(r["name"]) == n]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise RoutineError("ambiguous", "같은 이름의 루틴이 여러 개예요: " + ", ".join(r["name"] for r in exact))
    part = [r for r in pool if n in norm(r["name"])]
    if len(part) == 1:
        return part[0]
    if len(part) > 1:
        raise RoutineError("ambiguous", f"'{ref_s}' 와 맞는 루틴이 여러 개예요: " + ", ".join(r["name"] for r in part))
    archived = [r for r in rows if r["archived"] and n in norm(r["name"])]
    if archived:
        raise RoutineError("invalid", f"'{archived[0]['name']}' 루틴은 보관 상태라 기록할 수 없어요")
    raise RoutineError("not_found", f"'{ref_s}' 루틴을 찾을 수 없어요. 있는 루틴: " + ", ".join(r["name"] for r in pool))


def pick_slot(db, times, slot_arg, d, routine_id, today, now):
    """slot 지정(HH:MM 또는 라벨) 또는 자동 선택. times: [(time,label)]"""
    if slot_arg not in (None, ""):
        s = str(slot_arg).strip()
        if TIME_RE.match(s):
            hhmm = s.rjust(5, "0")
            if hhmm not in [t for t, _ in times]:
                raise RoutineError("not_found", f"'{s}' 시각이 없어요. 있는 시각: " + ", ".join(t for t, _ in times))
            return hhmm
        n = norm(s)
        exact = [t for t, lab in times if lab and norm(lab) == n]
        pool = exact or [t for t, lab in times if lab and n in norm(lab)]
        if len(pool) == 1:
            return pool[0]
        if len(pool) > 1:
            raise RoutineError("ambiguous", f"'{s}' 와 맞는 시각이 여러 개예요: " + ", ".join(pool))
        raise RoutineError("not_found", f"'{s}' 시각/라벨이 없어요. 있는 시각: " + ", ".join(f"{t}{'(' + lab + ')' if lab else ''}" for t, lab in times))
    used = {r["slot"] for r in db.execute(SQL_SLOTS_USED, (routine_id, d)).fetchall()}
    free = [t for t, _ in times if t not in used]
    if not free:
        raise RoutineError("already_done", "그날의 모든 시각을 이미 체크했어요")
    if d < today:
        passed = free
    elif d > today:
        passed = []
    else:
        cur = logical_minutes(db, now)
        passed = [t for t in free if slot_minutes(db, t) <= cur]
    if passed:
        return max(passed, key=lambda t: slot_minutes(db, t))
    return min(free, key=lambda t: slot_minutes(db, t))


# ---- log -----------------------------------------------------------------------------------
def _dup_result(db, ref_id):
    lg = load_log(db, ref_id)
    return {"ok": True, "id": ref_id, "duplicate": True, "log": lg, "routine": {"name": lg["routine"]},
            "progress": progress_for(db, lg["routine_id"], lg["date"])}


def log(db, arg, now=None):
    now = now or datetime.now()
    if not isinstance(arg, dict):
        raise RoutineError("invalid", "요청 형식이 올바르지 않아요")
    req_id = arg.get("req_id")
    if not isinstance(req_id, str) or not REQ_ID_RE.match(req_id):
        raise RoutineError("invalid", "req_id 가 필요해요 (영문·숫자·_.:- 64자 이하)")
    if arg.get("routine") in (None, ""):
        raise RoutineError("invalid", "routine(루틴 이름)이 필요해요")
    status = arg.get("status", "done")
    if status is None:
        status = "done"
    if status not in ("done", "skipped"):
        raise RoutineError("invalid", "status 는 done 또는 skipped 여야 해요")
    count_given = arg.get("count") is not None
    count = v_count(arg["count"]) if count_given else 1
    value, note = v_value(arg.get("value")), v_note(arg.get("note"))
    today = logical_today(db, now)
    d = v_date(arg["date"]) if arg.get("date") is not None else today
    db.execute("BEGIN IMMEDIATE")
    try:
        dup = db.execute(SQL_LOG_BY_REF, (req_id,)).fetchone()
        if dup:
            res = _dup_result(db, dup["id"])
            db.execute("COMMIT")
            return res
        rt = resolve_routine(db, arg["routine"])
        times = [(t["time"], t["label"]) for t in db.execute(SQL_TIMES_FOR, (rt["id"],)).fetchall()]
        slot = None
        if rt["kind"] == "habit":
            if arg.get("slot") not in (None, ""):
                raise RoutineError("invalid", "습관에는 slot 을 쓸 수 없어요")
        else:
            if count_given and count != 1:
                raise RoutineError("invalid", "복약·영양제는 count 를 쓸 수 없어요 (시각마다 1회)")
            if times:
                slot = pick_slot(db, times, arg.get("slot"), d, rt["id"], today, now)
                ex = db.execute(SQL_LOG_SLOT, (rt["id"], d, slot)).fetchone()
                if ex:
                    raise RoutineError("already_done", f"{d} {slot} 은 이미 체크했어요 ({ex['status']})")
            else:
                if arg.get("slot") not in (None, ""):
                    raise RoutineError("invalid", "이 루틴에는 정해진 시각이 없어요")
                ex = db.execute(SQL_LOG_NOSLOT, (rt["id"], d)).fetchone()
                if ex:
                    raise RoutineError("already_done", f"{d} 은 이미 체크했어요 ({ex['status']})")
        log_id = "lg_" + uuid.uuid4().hex[:16]
        try:
            db.execute(SQL_INSERT, (log_id, rt["id"], d, slot, status, count, value, note, now_iso(), req_id))
        except sqlite3.IntegrityError:
            dup = db.execute(SQL_LOG_BY_REF, (req_id,)).fetchone()
            if dup:
                res = _dup_result(db, dup["id"])
                db.execute("COMMIT")
                return res
            raise RoutineError("already_done", f"{d} {slot or ''} 은 이미 체크했어요")
        lg = load_log(db, log_id)
        prog = progress(db, rt["id"], rt["kind"], db.execute(SQL_ROUTINE_BY_ID, (rt["id"],)).fetchone()["daily_target"], len(times), d)
        db.execute("COMMIT")
        return {"ok": True, "id": log_id, "duplicate": False, "log": lg, "routine": {"name": rt["name"]}, "progress": prog}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


# ---- undo ----------------------------------------------------------------------------------
def undo(db, arg):
    if not isinstance(arg, dict) or not isinstance(arg.get("id"), str) or not arg["id"].strip():
        raise RoutineError("invalid", "id 가 필요해요")
    db.execute("BEGIN IMMEDIATE")
    try:
        lg = load_log(db, arg["id"].strip())
        if not lg:
            raise RoutineError("not_found", "해당 기록을 찾을 수 없어요")
        db.execute(SQL_DELETE, (lg["id"],))
        prog = progress_for(db, lg["routine_id"], lg["date"])
        db.execute("COMMIT")
        return {"ok": True, "deleted": True, "id": lg["id"], "routine": {"name": lg["routine"]}, "progress": prog}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def handle(db, method, arg_json, now=None):
    """Kotlin RoutineApi.handle 과 같은 진입점 (JSON 문자열 in/out)"""
    arg = json.loads(arg_json) if arg_json else {}
    fn = {"query": query, "log": log, "undo": undo}.get(method)
    if fn is None:
        raise RoutineError("unknown_method", method)
    return fn(db, arg) if method == "undo" else fn(db, arg, now=now)
