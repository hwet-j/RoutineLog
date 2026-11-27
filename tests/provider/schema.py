"""스펙(/tmp/claude-0/spec/routinelog-spec.md)과 같은 스키마 + 테스트용 시드. Kotlin 제공자가 여는 실제 DB 와 같은 모양이다.
logs_slot 은 스펙의 표현식 인덱스를 부분 인덱스로 고친 것(같은 밀리초의 습관 로그가 충돌하지 않게)."""

SCHEMA = """
CREATE TABLE routines(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('medication','supplement','habit')),
  detail TEXT, color TEXT, icon TEXT,
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK(schedule IN ('daily','weekdays','interval','weekly_count')),
  weekdays INTEGER NOT NULL DEFAULT 127,
  interval_days INTEGER, weekly_count INTEGER,
  start_date TEXT NOT NULL, end_date TEXT,
  daily_target INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  reminder INTEGER NOT NULL DEFAULT 1,
  nag_minutes INTEGER,
  notify_style TEXT CHECK(notify_style IN ('sound','vibrate','silent')),
  archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE routine_times(
  id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  time TEXT NOT NULL CHECK(time GLOB '[0-2][0-9]:[0-5][0-9]'), label TEXT);
CREATE TABLE logs(
  id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  date TEXT NOT NULL, slot TEXT,
  status TEXT NOT NULL CHECK(status IN ('done','skipped')),
  count INTEGER NOT NULL DEFAULT 1,
  value REAL, note TEXT,
  logged_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'app' CHECK(source IN ('app','assistant','notification')),
  source_ref TEXT UNIQUE);
CREATE UNIQUE INDEX logs_slot ON logs(routine_id, date, slot) WHERE slot IS NOT NULL;
CREATE INDEX logs_date ON logs(date DESC);
CREATE INDEX logs_routine ON logs(routine_id, date);
CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

CREATED = "2026-01-01T00:00:00.000Z"

# (id, name, kind, detail, daily_target, unit, archived, [(time, label)])
ROUTINES = [
    ("r_bp", "혈압약", "medication", "1정, 식후", 1, None, 0, [("08:00", "아침"), ("20:00", "저녁")]),
    ("r_vitd", "비타민D", "supplement", "1000IU", 1, None, 0, [("09:00", "아침")]),
    ("r_vitc", "비타민C", "supplement", None, 1, None, 0, [("09:00", "아침"), ("13:00", "점심"), ("21:00", "취침 전")]),
    ("r_run", "러닝", "habit", "주 3회", 1, "km", 0, []),
    ("r_water", "물 마시기", "habit", None, 8, "잔", 0, []),
    ("r_eng", "영어 공부", "habit", "쉐도잉", 1, "분", 0, []),
    ("r_old", "옛날약", "medication", None, 1, None, 1, [("08:00", "아침")]),
    ("r_nt", "시각없는약", "medication", None, 1, None, 0, []),
]


def seed(db):
    db.executescript(SCHEMA)
    for i, (rid, name, kind, detail, target, unit, archived, times) in enumerate(ROUTINES):
        db.execute("INSERT INTO routines(id,name,kind,detail,schedule,weekdays,start_date,daily_target,unit,archived,sort,created_at) VALUES(?,?,?,?,'daily',127,'2026-01-01',?,?,?,?,?)",
                   (rid, name, kind, detail, target, unit, archived, i, CREATED))
        for j, (t, label) in enumerate(times):
            db.execute("INSERT INTO routine_times(id,routine_id,time,label) VALUES(?,?,?,?)", (f"{rid}_t{j}", rid, t, label))
