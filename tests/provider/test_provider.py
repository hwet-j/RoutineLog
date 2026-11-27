import os
import tempfile
import threading
import unittest
from datetime import datetime

from . import routine as R
from . import schema

NOW = datetime(2026, 11, 27, 10, 30)  # 금요일 10:30
TODAY = "2026-11-27"


def fresh():
    db = R.connect()
    schema.seed(db)
    return db


def log(db, now=NOW, **kw):
    kw.setdefault("req_id", "r" + str(abs(hash(str(sorted(kw.items()))))) + str(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0]))
    return R.log(db, kw, now=now)


class Schema(unittest.TestCase):
    def test_spec_expression_index_collides_but_partial_index_does_not(self):
        """스펙의 표현식 인덱스는 같은 밀리초의 습관 로그 2건을 UNIQUE 위반으로 막는다 → 부분 인덱스로 교체"""
        import sqlite3
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE logs(id TEXT PRIMARY KEY, routine_id TEXT, date TEXT, slot TEXT, logged_at TEXT);"
                         "CREATE UNIQUE INDEX logs_slot ON logs(routine_id, date, COALESCE(slot,''), CASE WHEN slot IS NULL THEN logged_at ELSE '' END);")
        db.execute("INSERT INTO logs VALUES('1','r','d',NULL,'t')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO logs VALUES('2','r','d',NULL,'t')")
        db2 = sqlite3.connect(":memory:")
        db2.executescript("CREATE TABLE logs(id TEXT PRIMARY KEY, routine_id TEXT, date TEXT, slot TEXT, logged_at TEXT);"
                          "CREATE UNIQUE INDEX logs_slot ON logs(routine_id, date, slot) WHERE slot IS NOT NULL;")
        db2.execute("INSERT INTO logs VALUES('1','r','d',NULL,'t')")
        db2.execute("INSERT INTO logs VALUES('2','r','d',NULL,'t')")  # 습관은 여러 건
        db2.execute("INSERT INTO logs VALUES('3','r','d','08:00','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            db2.execute("INSERT INTO logs VALUES('4','r','d','08:00','t2')")  # 복약 슬롯은 1건

    def test_notify_style_column_check(self):
        import sqlite3
        db = fresh()
        db.execute("UPDATE routines SET notify_style='silent' WHERE id='r_bp'")
        db.execute("UPDATE routines SET notify_style=NULL WHERE id='r_bp'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE routines SET notify_style='loud' WHERE id='r_bp'")


class SlotSelection(unittest.TestCase):
    def test_closest_passed_slot(self):
        db = fresh()
        # 10:30 — 혈압약 08:00(지남) / 20:00(아직) → 08:00
        r = log(db, routine="혈압약")
        self.assertEqual(r["log"]["slot"], "08:00")
        self.assertEqual(r["progress"], {"date": TODAY, "done": 1, "target": 2})
        # 다음 호출: 지난 미체크 없음 → 가장 이른 미체크 = 20:00
        r2 = log(db, routine="혈압약")
        self.assertEqual(r2["log"]["slot"], "20:00")
        self.assertEqual(r2["progress"]["done"], 2)

    def test_latest_passed_among_several(self):
        db = fresh()
        now = datetime(2026, 11, 27, 14, 0)  # 비타민C 09:00/13:00 지남, 21:00 전
        self.assertEqual(log(db, now=now, routine="비타민C")["log"]["slot"], "13:00")  # 현재에 가장 가까운 지난 시각
        self.assertEqual(log(db, now=now, routine="비타민C")["log"]["slot"], "09:00")  # 남은 지난 것
        self.assertEqual(log(db, now=now, routine="비타민C")["log"]["slot"], "21:00")  # 지난 것이 없으니 가장 이른 미체크

    def test_before_first_slot_picks_earliest(self):
        db = fresh()
        now = datetime(2026, 11, 27, 6, 0)
        self.assertEqual(log(db, now=now, routine="혈압약")["log"]["slot"], "08:00")

    def test_all_done_is_already_done(self):
        db = fresh()
        log(db, routine="비타민D")
        with self.assertRaises(R.RoutineError) as c:
            log(db, routine="비타민D")
        self.assertEqual(c.exception.code, "already_done")

    def test_explicit_slot_by_time_and_label(self):
        db = fresh()
        self.assertEqual(log(db, routine="혈압약", slot="20:00")["log"]["slot"], "20:00")
        self.assertEqual(log(db, routine="비타민C", slot="취침")["log"]["slot"], "21:00")  # 라벨 부분일치
        self.assertEqual(log(db, routine="비타민C", slot="점심")["log"]["slot"], "13:00")
        self.assertEqual(log(db, routine="비타민C", slot="9:00")["log"]["slot"], "09:00")  # 0 패딩
        for bad, code in (("07:00", "not_found"), ("저녁", "not_found")):
            with self.assertRaises(R.RoutineError) as c:
                log(db, routine="혈압약", slot=bad) if bad != "저녁" else log(db, routine="비타민C", slot=bad)
            self.assertEqual(c.exception.code, code)

    def test_explicit_slot_already_checked(self):
        db = fresh()
        log(db, routine="혈압약", slot="08:00")
        with self.assertRaises(R.RoutineError) as c:
            log(db, routine="혈압약", slot="08:00")
        self.assertEqual(c.exception.code, "already_done")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 1)

    def test_past_and_future_dates(self):
        db = fresh()
        self.assertEqual(log(db, routine="혈압약", date="2026-11-20")["log"]["slot"], "20:00")  # 과거: 지난 것 중 가장 늦은
        self.assertEqual(log(db, routine="혈압약", date="2026-12-05")["log"]["slot"], "08:00")  # 미래: 가장 이른

    def test_skipped_counts_as_checked_but_not_done(self):
        db = fresh()
        r = log(db, routine="혈압약", status="skipped")
        self.assertEqual(r["log"]["status"], "skipped")
        self.assertEqual(r["progress"]["done"], 0)
        self.assertEqual(log(db, routine="혈압약")["log"]["slot"], "20:00")
        with self.assertRaises(R.RoutineError) as c:
            log(db, routine="혈압약", slot="08:00", status="done")
        self.assertEqual(c.exception.code, "already_done")

    def test_routine_without_times_once_per_day(self):
        db = fresh()
        r = log(db, routine="시각없는약")
        self.assertNotIn("slot", r["log"])
        self.assertEqual(r["progress"], {"date": TODAY, "done": 1, "target": 1})
        with self.assertRaises(R.RoutineError) as c:
            log(db, routine="시각없는약")
        self.assertEqual(c.exception.code, "already_done")
        with self.assertRaises(R.RoutineError):
            log(db, routine="시각없는약", date="2026-11-26", slot="08:00")
        self.assertEqual(log(db, routine="시각없는약", date="2026-11-26")["log"]["date"], "2026-11-26")


class Habits(unittest.TestCase):
    def test_counts_are_new_rows_and_progress_sums(self):
        db = fresh()
        r1 = log(db, routine="물 마시기", count=3)
        self.assertEqual(r1["progress"], {"date": TODAY, "done": 3, "target": 8})
        r2 = log(db, routine="물 마시기")
        self.assertEqual(r2["progress"]["done"], 4)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs WHERE routine_id='r_water'").fetchone()[0], 2)  # 누적이 아니라 새 행
        self.assertEqual(r2["log"]["count"], 1)

    def test_value_and_note(self):
        db = fresh()
        r = log(db, routine="러닝", value=5.2, note="  공원 한 바퀴  ")
        self.assertEqual((r["log"]["value"], r["log"]["note"]), (5.2, "공원 한 바퀴"))
        r = log(db, routine="영어공부", note="쉐도잉 30분 · 단어 20개", count=1)
        self.assertEqual(r["routine"]["name"], "영어 공부")  # 공백 무시 매칭
        self.assertNotIn("value", r["log"])

    def test_same_timestamp_habit_logs_do_not_collide(self):
        db = fresh()
        for i in range(5):
            log(db, routine="물 마시기", req_id=f"w{i}")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 5)

    def test_habit_rejects_slot_med_rejects_count(self):
        db = fresh()
        with self.assertRaises(R.RoutineError):
            log(db, routine="러닝", slot="08:00")
        with self.assertRaises(R.RoutineError):
            log(db, routine="혈압약", count=2)
        self.assertEqual(log(db, routine="혈압약", count=1)["log"]["count"], 1)


class Idempotency(unittest.TestCase):
    def test_duplicate_req_id(self):
        db = fresh()
        a = log(db, req_id="abc-1", routine="혈압약")
        b = log(db, req_id="abc-1", routine="혈압약")
        self.assertFalse(a["duplicate"])
        self.assertTrue(b["duplicate"])
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(b["log"]["slot"], "08:00")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 1)

    def test_duplicate_req_id_even_with_different_args(self):
        db = fresh()
        a = log(db, req_id="same", routine="러닝", value=3)
        b = log(db, req_id="same", routine="물 마시기", count=5)
        self.assertTrue(b["duplicate"])
        self.assertEqual(b["routine"]["name"], "러닝")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 1)

    def test_source_is_assistant(self):
        db = fresh()
        self.assertEqual(log(db, routine="러닝")["log"]["source"], "assistant")

    def test_race_same_req_id_on_file_wal_db(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "routinelog.db")
            setup = R.connect(path)
            setup.execute("PRAGMA journal_mode=WAL")
            schema.seed(setup)
            setup.close()
            results, errors = [], []

            def worker():
                db = R.connect(path)
                try:
                    results.append(R.log(db, {"req_id": "race-1", "routine": "물 마시기", "count": 2}, now=NOW))
                except Exception as e:  # pragma: no cover
                    errors.append(e)
                finally:
                    db.close()

            ts = [threading.Thread(target=worker) for _ in range(8)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            self.assertEqual(errors, [])
            self.assertEqual(len(results), 8)
            self.assertEqual(len({r["id"] for r in results}), 1)
            self.assertEqual(sum(1 for r in results if not r["duplicate"]), 1)
            chk = R.connect(path)
            self.assertEqual(chk.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 1)

    def test_race_different_req_ids_same_slot_only_one_wins(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "routinelog.db")
            setup = R.connect(path)
            setup.execute("PRAGMA journal_mode=WAL")
            schema.seed(setup)
            setup.close()
            outcome = []

            def worker(i):
                db = R.connect(path)
                try:
                    outcome.append(("ok", R.log(db, {"req_id": f"s{i}", "routine": "비타민D", "slot": "09:00"}, now=NOW)["id"]))
                except R.RoutineError as e:
                    outcome.append((e.code, None))
                finally:
                    db.close()

            ts = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            self.assertEqual([o[0] for o in outcome].count("ok"), 1)
            self.assertEqual([o[0] for o in outcome].count("already_done"), 7)
            self.assertEqual(R.connect(path).execute("SELECT COUNT(*) FROM logs").fetchone()[0], 1)


class Matching(unittest.TestCase):
    def test_exact_partial_ambiguous_not_found(self):
        db = fresh()
        self.assertEqual(log(db, routine=" 비타민 D ")["routine"]["name"], "비타민D")  # 공백·대소문자 무시
        self.assertEqual(log(db, routine="혈압")["routine"]["name"], "혈압약")  # 유일한 부분일치
        with self.assertRaises(R.RoutineError) as c:
            log(db, routine="비타민")  # 비타민D / 비타민C
        self.assertEqual(c.exception.code, "ambiguous")
        self.assertIn("비타민C", c.exception.message)
        self.assertIn("비타민D", c.exception.message)
        with self.assertRaises(R.RoutineError) as c:
            log(db, routine="없는루틴")
        self.assertEqual(c.exception.code, "not_found")
        self.assertIn("러닝", c.exception.message)

    def test_exact_beats_partial(self):
        db = fresh()
        db.execute("INSERT INTO routines(id,name,kind,start_date,created_at,sort) VALUES('r_va','비타민',  'supplement','2026-01-01','2026-01-01T00:00:00.000Z',9)")
        self.assertEqual(log(db, routine="비타민")["routine"]["name"], "비타민")

    def test_by_id_and_archived(self):
        db = fresh()
        self.assertEqual(log(db, routine="r_run")["routine"]["name"], "러닝")
        for ref in ("r_old", "옛날약"):
            with self.assertRaises(R.RoutineError) as c:
                log(db, routine=ref)
            self.assertEqual(c.exception.code, "invalid")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs WHERE routine_id='r_old'").fetchone()[0], 0)


class Undo(unittest.TestCase):
    def test_undo_deletes_and_reports_progress(self):
        db = fresh()
        a = log(db, routine="물 마시기", count=3)
        b = log(db, routine="물 마시기", count=2)
        u = R.undo(db, {"id": b["id"]})
        self.assertEqual(u, {"ok": True, "deleted": True, "id": b["id"], "routine": {"name": "물 마시기"}, "progress": {"date": TODAY, "done": 3, "target": 8}})
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 1)
        with self.assertRaises(R.RoutineError) as c:
            R.undo(db, {"id": b["id"]})
        self.assertEqual(c.exception.code, "not_found")
        R.undo(db, {"id": a["id"]})
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 0)

    def test_undo_frees_the_slot_and_req_id(self):
        db = fresh()
        a = log(db, req_id="u1", routine="혈압약", slot="08:00")
        R.undo(db, {"id": a["id"]})
        again = log(db, req_id="u1", routine="혈압약", slot="08:00")  # 같은 req_id 도 이제 새 기록
        self.assertFalse(again["duplicate"])

    def test_undo_invalid(self):
        db = fresh()
        for bad in (None, {}, {"id": ""}, {"id": 5}, "x"):
            with self.assertRaises(R.RoutineError) as c:
                R.undo(db, bad)
            self.assertEqual(c.exception.code, "invalid")


class QueryTests(unittest.TestCase):
    def test_shape_and_defaults(self):
        db = fresh()
        log(db, routine="혈압약", note="식후")
        q = R.query(db, None, now=NOW, now_ms=123)
        self.assertEqual((q["v"], q["app"], q["ts"], q["today"], q["to"], q["from"], q["truncated"]), (1, "routinelog", 123, TODAY, TODAY, "2026-11-13", False))
        bp = next(r for r in q["routines"] if r["name"] == "혈압약")
        self.assertEqual(bp["times"], [{"time": "08:00", "label": "아침"}, {"time": "20:00", "label": "저녁"}])
        self.assertEqual((bp["kind"], bp["schedule"], bp["weekdays"], bp["daily_target"], bp["archived"], bp["detail"]), ("medication", "daily", 127, 1, False, "1정, 식후"))
        self.assertNotIn("interval_days", bp)
        self.assertNotIn("end_date", bp)
        self.assertEqual(next(r for r in q["routines"] if r["name"] == "러닝")["unit"], "km")
        self.assertTrue(next(r for r in q["routines"] if r["name"] == "옛날약")["archived"])
        self.assertEqual(q["routines"][-1]["archived"], True)  # 보관 루틴은 뒤로
        self.assertEqual(len(q["logs"]), 1)
        self.assertEqual((q["logs"][0]["routine"], q["logs"][0]["note"], q["logs"][0]["slot"]), ("혈압약", "식후", "08:00"))

    def test_window_and_order(self):
        db = fresh()
        log(db, routine="러닝", date="2026-11-20", value=3)
        log(db, routine="러닝", date="2026-11-25", value=5)
        log(db, routine="혈압약", date="2026-11-25", slot="08:00")
        log(db, routine="혈압약", date="2026-11-25", slot="20:00")
        q = R.query(db, {"from": "2026-11-21", "to": "2026-11-30"}, now=NOW)
        self.assertEqual([(l["date"], l.get("slot"), l["routine"]) for l in q["logs"]], [("2026-11-25", "20:00", "혈압약"), ("2026-11-25", "08:00", "혈압약"), ("2026-11-25", None, "러닝")])
        self.assertEqual(R.query(db, {"to": "2026-11-20"}, now=NOW)["from"], "2026-11-06")

    def test_invalid_window(self):
        db = fresh()
        for bad in ({"from": "2026-11-30", "to": "2026-11-01"}, {"from": "2025-01-01", "to": "2026-11-30"}, {"from": "2026-13-01"}, {"to": "내일"}, [1]):
            with self.assertRaises(R.RoutineError) as c:
                R.query(db, bad, now=NOW)
            self.assertEqual(c.exception.code, "invalid")
        R.query(db, {"from": "2025-10-23", "to": "2026-11-27"}, now=NOW)  # 정확히 400일은 허용

    def test_truncation(self):
        db = fresh()
        db.execute("BEGIN")
        for i in range(R.MAX_LOGS + 5):
            db.execute("INSERT INTO logs(id,routine_id,date,slot,status,count,logged_at) VALUES(?,?,?,NULL,'done',1,'t')", (f"l{i}", "r_water", TODAY))
        db.execute("COMMIT")
        q = R.query(db, {"from": TODAY, "to": TODAY}, now=NOW)
        self.assertEqual(len(q["logs"]), R.MAX_LOGS)
        self.assertTrue(q["truncated"])


class Validation(unittest.TestCase):
    def test_invalid_inputs(self):
        db = fresh()
        cases = [
            {"routine": "러닝"},  # req_id 없음
            {"req_id": "bad id!", "routine": "러닝"},
            {"req_id": "x" * 65, "routine": "러닝"},
            {"req_id": "a"},  # routine 없음
            {"req_id": "a", "routine": ""},
            {"req_id": "a", "routine": "x" * 81},
            {"req_id": "a", "routine": "러닝", "status": "maybe"},
            {"req_id": "a", "routine": "러닝", "count": 0},
            {"req_id": "a", "routine": "러닝", "count": 1001},
            {"req_id": "a", "routine": "러닝", "count": 1.5},
            {"req_id": "a", "routine": "러닝", "count": True},
            {"req_id": "a", "routine": "러닝", "count": "2"},
            {"req_id": "a", "routine": "러닝", "value": "5"},
            {"req_id": "a", "routine": "러닝", "value": float("nan")},
            {"req_id": "a", "routine": "러닝", "value": float("inf")},
            {"req_id": "a", "routine": "러닝", "value": True},
            {"req_id": "a", "routine": "러닝", "note": "n" * 501},
            {"req_id": "a", "routine": "러닝", "note": 5},
            {"req_id": "a", "routine": "러닝", "date": "2026-02-30"},
            {"req_id": "a", "routine": "러닝", "date": "1999-12-31"},
            {"req_id": "a", "routine": "러닝", "date": "2101-01-01"},
            {"req_id": "a", "routine": "러닝", "date": "어제"},
        ]
        for c in cases:
            with self.assertRaises(R.RoutineError, msg=str(c)[:70]) as ctx:
                R.log(db, c, now=NOW)
            self.assertEqual(ctx.exception.code, "invalid")
        with self.assertRaises(R.RoutineError):
            R.log(db, "x", now=NOW)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 0)

    def test_limits_accepted(self):
        db = fresh()
        r = log(db, routine="물 마시기", count=1000, note="n" * 500, value=1_000_000_000, date="2000-01-01")
        self.assertEqual((r["log"]["count"], len(r["log"]["note"])), (1000, 500))
        self.assertEqual(r["progress"], {"date": "2000-01-01", "done": 1000, "target": 8})

    def test_blank_note_becomes_none(self):
        db = fresh()
        self.assertNotIn("note", log(db, routine="러닝", note="   ")["log"])

    def test_failed_log_rolls_back(self):
        db = fresh()
        with self.assertRaises(R.RoutineError):
            log(db, routine="비타민C", slot="없는시각")
        self.assertFalse(db.in_transaction)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM logs").fetchone()[0], 0)

    def test_unknown_method_and_handle(self):
        db = fresh()
        with self.assertRaises(R.RoutineError) as c:
            R.handle(db, "drop_table", "{}")
        self.assertEqual(c.exception.code, "unknown_method")
        self.assertEqual(R.handle(db, "query", "", now=NOW)["today"], TODAY)
        self.assertEqual(R.handle(db, "log", '{"req_id":"h1","routine":"러닝"}', now=NOW)["progress"]["done"], 1)


class DayStart(unittest.TestCase):
    def test_default_midnight(self):
        db = fresh()
        self.assertEqual(R.logical_today(db, datetime(2026, 11, 28, 0, 30)), "2026-11-28")

    def test_before_day_start_counts_as_yesterday(self):
        db = fresh()
        db.execute("INSERT INTO kv(key,value) VALUES('day_start','04:00')")
        self.assertEqual(R.logical_today(db, datetime(2026, 11, 28, 2, 0)), "2026-11-27")
        self.assertEqual(R.logical_today(db, datetime(2026, 11, 28, 4, 0)), "2026-11-28")
        self.assertEqual(R.logical_today(db, datetime(2026, 11, 28, 3, 59)), "2026-11-27")

    def test_log_date_and_slot_use_logical_day(self):
        db = fresh()
        db.execute("INSERT INTO kv(key,value) VALUES('day_start','04:00')")
        db.execute("INSERT INTO routine_times(id,routine_id,time,label) VALUES('x1','r_vitd','01:00','야식 후')")
        now = datetime(2026, 11, 28, 2, 0)  # 논리적으로 27일 심야
        r = log(db, now=now, routine="비타민D")
        self.assertEqual(r["log"]["date"], "2026-11-27")
        # 01:00 은 하루의 끝(25:00)으로 취급 → 02:00(26:00) 시점에 지난 슬롯 중 가장 늦은 것 = 01:00
        self.assertEqual(r["log"]["slot"], "01:00")
        self.assertEqual(R.query(db, None, now=now)["today"], "2026-11-27")

    def test_invalid_day_start_falls_back(self):
        db = fresh()
        db.execute("INSERT INTO kv(key,value) VALUES('day_start','25:99')")
        self.assertEqual(R.logical_today(db, datetime(2026, 11, 28, 2, 0)), "2026-11-28")


if __name__ == "__main__":
    unittest.main()
