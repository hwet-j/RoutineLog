export const PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;
PRAGMA foreign_keys = ON;
`;

export const SCHEMA_VERSION = 1;

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
CREATE UNIQUE INDEX IF NOT EXISTS logs_slot ON logs(routine_id, date, COALESCE(slot,''), CASE WHEN slot IS NULL THEN logged_at ELSE '' END);
CREATE INDEX IF NOT EXISTS logs_date ON logs(date DESC);
CREATE INDEX IF NOT EXISTS logs_routine ON logs(routine_id, date);
CREATE INDEX IF NOT EXISTS times_routine ON routine_times(routine_id);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
