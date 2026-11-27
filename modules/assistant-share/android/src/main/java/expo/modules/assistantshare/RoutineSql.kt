package expo.modules.assistantshare

/** docs/provider-sql.md 와 tests/provider/routine.py 의 SQL 과 글자 그대로 같다. 바꿀 때는 셋을 함께 고친다. */
object RoutineSql {
  const val ROUTINES = """
SELECT id, name, kind, detail, schedule, weekdays, interval_days, weekly_count, start_date, end_date, daily_target, unit, archived
FROM routines ORDER BY archived, sort, created_at, name"""
  const val ROUTINES_LITE = "SELECT id, name, kind, archived FROM routines ORDER BY sort, created_at, name"
  const val TIMES = "SELECT routine_id, time, label FROM routine_times ORDER BY routine_id, time, id"
  const val TIMES_FOR = "SELECT time, label FROM routine_times WHERE routine_id = ? ORDER BY time, id"
  const val LOG_SELECT = """
SELECT l.id, l.routine_id, r.name AS routine, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source
FROM logs l JOIN routines r ON r.id = l.routine_id"""

  /** LIMIT 은 검증된 정수를 문자열 템플릿으로 넣는다 (Android 의 바인딩은 전부 문자열이라) */
  fun logRange(limit: Int) = LOG_SELECT + """
WHERE l.date >= ? AND l.date <= ?
ORDER BY l.date DESC, COALESCE(l.slot,'') DESC, l.logged_at DESC, l.id DESC LIMIT $limit"""

  const val LOG_BY_ID = LOG_SELECT + " WHERE l.id = ?"
  const val LOG_BY_REF = "SELECT id FROM logs WHERE source_ref = ?"
  const val LOG_SLOT = "SELECT id, status FROM logs WHERE routine_id = ? AND date = ? AND slot = ?"
  const val LOG_NOSLOT = "SELECT id, status FROM logs WHERE routine_id = ? AND date = ? AND slot IS NULL"
  const val SLOTS_USED = "SELECT slot FROM logs WHERE routine_id = ? AND date = ? AND slot IS NOT NULL"
  const val INSERT = """INSERT INTO logs(id,routine_id,date,slot,status,count,value,note,logged_at,source,source_ref)
VALUES(?,?,?,?,?,?,?,?,?,'assistant',?)"""
  const val DELETE = "DELETE FROM logs WHERE id = ?"
  const val PROGRESS_COUNT = "SELECT COUNT(*) FROM logs WHERE routine_id = ? AND date = ? AND status = 'done'"
  const val PROGRESS_SUM = "SELECT COALESCE(SUM(count),0) FROM logs WHERE routine_id = ? AND date = ? AND status = 'done'"
  const val ROUTINE_BY_ID = "SELECT id, name, kind, daily_target FROM routines WHERE id = ?"
  const val KV = "SELECT value FROM kv WHERE key = ?"
}
