// journal_mode·busy_timeout·foreign_keys 는 네이티브 모듈(SharedDb)이 연결을 열 때 설정한다

export const SCHEMA_VERSION = 2;

/** v1→v2: 슬롯 유니크 인덱스를 부분 인덱스로 교체 (같은 밀리초의 습관 로그가 충돌하지 않게. 비서 제공자와 같은 정의) */
export const MIGRATE_V2 = `
DROP INDEX IF EXISTS logs_slot;
CREATE UNIQUE INDEX IF NOT EXISTS logs_slot ON logs(routine_id, date, slot) WHERE slot IS NOT NULL;
`;

/** 스펙(/docs/provider-sql.md 와 비서 제공자)과 같은 스키마. 바꾸면 제공자도 같이 바꿔야 한다 */
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS routines(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('medication','supplement','habit')),
  detail TEXT,
  color TEXT, icon TEXT,
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK(schedule IN ('daily','weekdays','interval','weekly_count')),
  weekdays INTEGER NOT NULL DEFAULT 127,
  interval_days INTEGER,
  weekly_count INTEGER,
  start_date TEXT NOT NULL, end_date TEXT,
  daily_target INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  reminder INTEGER NOT NULL DEFAULT 1,
  nag_minutes INTEGER,
  notify_style TEXT CHECK(notify_style IN ('sound','vibrate','silent')),
  archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS routine_times(
  id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  time TEXT NOT NULL CHECK(time GLOB '[0-2][0-9]:[0-5][0-9]'), label TEXT);
CREATE TABLE IF NOT EXISTS logs(
  id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT,
  status TEXT NOT NULL CHECK(status IN ('done','skipped')),
  count INTEGER NOT NULL DEFAULT 1,
  value REAL, note TEXT,
  logged_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'app' CHECK(source IN ('app','assistant','notification')),
  source_ref TEXT UNIQUE);
-- 복약 슬롯은 하루 1건(중복 체크 방지), 습관(slot NULL)은 여러 건 허용. 비서 제공자 쪽 스키마와 같다
CREATE UNIQUE INDEX IF NOT EXISTS logs_slot ON logs(routine_id, date, slot) WHERE slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS logs_date ON logs(date DESC);
CREATE INDEX IF NOT EXISTS logs_routine ON logs(routine_id, date);
CREATE INDEX IF NOT EXISTS times_routine ON routine_times(routine_id);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
