package expo.modules.assistantshare

import android.database.Cursor
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class RoutineError(val code: String, override val message: String) : RuntimeException(message)

/**
 * tests/provider/routine.py 의 한 줄씩 옮긴 포팅. 규칙을 바꿀 때는 Python 참조 구현과 docs/provider-sql.md 를 먼저 고친다.
 * 호출자 검사는 Provider 에서 끝낸 뒤 여기로 온다. 날짜 계산은 java.time 없이(구형 기기 호환) 직접 한다.
 */
object RoutineApi {
  private const val DATE_MIN = "2000-01-01"
  private const val DATE_MAX = "2100-12-31"
  private const val MAX_SPAN_DAYS = 400L
  private const val DEFAULT_WINDOW_DAYS = 14L
  private const val MAX_LOGS = 3000
  private const val MAX_NAME = 80
  private const val MAX_NOTE = 500
  private const val MAX_COUNT = 1000
  private const val MAX_VALUE = 1_000_000_000.0
  private val REQ_ID_RE = Regex("^[A-Za-z0-9_.:\\-]{1,64}$")
  private val DATE_RE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
  private val TIME_RE = Regex("^([01]?\\d|2[0-3]):[0-5]\\d$")
  private val HHMM_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

  fun handle(db: SQLiteDatabase, method: String, arg: String?, now: Calendar = Calendar.getInstance()): JSONObject {
    val obj = parse(arg)
    return when (method) {
      "query" -> query(db, obj, now)
      "log" -> log(db, obj, now)
      "undo" -> undo(db, obj)
      else -> throw RoutineError("unknown_method", method)
    }
  }

  // ---- 작은 도구들 ----------------------------------------------------------------------------
  private fun parse(arg: String?): JSONObject {
    if (arg == null || arg.isBlank()) return JSONObject()
    if (arg.length > 20_000) throw RoutineError("invalid", "요청이 너무 커요")
    return try { JSONObject(arg) } catch (e: JSONException) { throw RoutineError("invalid", "요청 형식이 올바르지 않아요") }
  }

  private fun Cursor.str(name: String): String? { val i = getColumnIndexOrThrow(name); return if (isNull(i)) null else getString(i) }
  private fun Cursor.lng(name: String): Long { val i = getColumnIndexOrThrow(name); return if (isNull(i)) 0L else getLong(i) }
  private fun Cursor.lngOrNull(name: String): Long? { val i = getColumnIndexOrThrow(name); return if (isNull(i)) null else getLong(i) }
  private fun Cursor.dblOrNull(name: String): Double? { val i = getColumnIndexOrThrow(name); return if (isNull(i)) null else getDouble(i) }

  private fun nowIso(): String {
    val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    f.timeZone = TimeZone.getTimeZone("UTC")
    return f.format(Date())
  }

  fun norm(s: String): String = s.filter { !it.isWhitespace() }.lowercase()

  /** 값이 없거나 null 이거나 빈 문자열이면 "없음" (Python 의 `arg.get(k) in (None, "")`) */
  private fun blank(o: JSONObject, k: String): Boolean = !o.has(k) || o.isNull(k) || (o.opt(k) is String && (o.opt(k) as String).isEmpty())
  private fun nullish(o: JSONObject, k: String): Boolean = !o.has(k) || o.isNull(k)
  private fun refString(o: JSONObject, k: String): String = o.opt(k).toString()

  private inline fun <T> rows(db: SQLiteDatabase, sql: String, args: Array<String>? = null, f: (Cursor) -> T): List<T> {
    val out = ArrayList<T>()
    db.rawQuery(sql, args).use { c -> while (c.moveToNext()) out.add(f(c)) }
    return out
  }

  private inline fun <T> writeTx(db: SQLiteDatabase, f: () -> T): T {
    db.beginTransactionNonExclusive() // BEGIN IMMEDIATE
    try {
      val r = f()
      db.setTransactionSuccessful()
      return r
    } finally {
      db.endTransaction()
    }
  }

  // ---- 날짜 (그레고리력 일수 변환: java.time 없이) -------------------------------------------------
  private fun daysFromCivil(y0: Int, m: Int, d: Int): Long {
    val y = (if (m <= 2) y0 - 1 else y0).toLong()
    val era = (if (y >= 0) y else y - 399) / 400
    val yoe = y - era * 400
    val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
  }

  private fun civilFromDays(z0: Long): String {
    val z = z0 + 719468
    val era = (if (z >= 0) z else z - 146096) / 146097
    val doe = z - era * 146097
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val y = yoe + era * 400
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val m = (mp + (if (mp < 10) 3 else -9)).toInt()
    val yy = (y + (if (m <= 2) 1 else 0)).toInt()
    return "%04d-%02d-%02d".format(Locale.US, yy, m, d)
  }

  private fun epochDay(date: String): Long = daysFromCivil(date.substring(0, 4).toInt(), date.substring(5, 7).toInt(), date.substring(8, 10).toInt())

  private fun vDate(v: Any?): String {
    if (v !is String || !DATE_RE.matches(v)) throw RoutineError("invalid", "date 는 YYYY-MM-DD 형식이어야 해요")
    val y = v.substring(0, 4).toInt(); val m = v.substring(5, 7).toInt(); val d = v.substring(8, 10).toInt()
    val ok = m in 1..12 && d >= 1 && civilFromDays(daysFromCivil(y, m, d)) == v
    if (!ok) throw RoutineError("invalid", "존재하지 않는 날짜예요")
    if (v < DATE_MIN || v > DATE_MAX) throw RoutineError("invalid", "date 는 $DATE_MIN ~ $DATE_MAX 사이여야 해요")
    return v
  }

  // ---- 하루 시작 시각 / 오늘 ------------------------------------------------------------------
  private fun dayStartMinutes(db: SQLiteDatabase): Int {
    db.rawQuery(RoutineSql.KV, arrayOf("day_start")).use {
      if (it.moveToFirst()) {
        val v = it.str("value")
        if (v != null && HHMM_RE.matches(v)) return v.substring(0, 2).toInt() * 60 + v.substring(3).toInt()
      }
    }
    return 0
  }

  private fun clockDate(now: Calendar): String =
    "%04d-%02d-%02d".format(Locale.US, now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH))

  /** 하루 시작 시각(kv 'day_start', 기본 00:00) 이전의 새벽은 전날로 센다 */
  private fun logicalToday(db: SQLiteDatabase, now: Calendar): String {
    val m = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    val d = clockDate(now)
    return if (m < dayStartMinutes(db)) civilFromDays(epochDay(d) - 1) else d
  }

  private fun logicalMinutes(db: SQLiteDatabase, now: Calendar): Int {
    val m = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    return if (m < dayStartMinutes(db)) m + 1440 else m
  }

  private fun slotMinutes(startMin: Int, hhmm: String): Int {
    val m = hhmm.substring(0, 2).toInt() * 60 + hhmm.substring(3).toInt()
    return if (m < startMin) m + 1440 else m
  }

  // ---- 입력 검증 ----------------------------------------------------------------------------
  private fun vCount(v: Any?): Int {
    if (v !is Number) throw RoutineError("invalid", "count 는 정수여야 해요")
    val d = v.toDouble()
    if (d.isNaN() || d.isInfinite() || d != Math.floor(d)) throw RoutineError("invalid", "count 는 정수여야 해요")
    if (d < 1 || d > MAX_COUNT) throw RoutineError("invalid", "count 는 1 ~ $MAX_COUNT 사이여야 해요")
    return d.toInt()
  }

  private fun vValue(o: JSONObject): Double? {
    if (nullish(o, "value")) return null
    val v = o.opt("value")
    if (v !is Number) throw RoutineError("invalid", "value 는 숫자여야 해요")
    val f = v.toDouble()
    if (f.isNaN() || f.isInfinite() || Math.abs(f) > MAX_VALUE) throw RoutineError("invalid", "value 가 올바르지 않아요")
    return f
  }

  private fun vNote(o: JSONObject): String? {
    if (nullish(o, "note")) return null
    val v = o.opt("note")
    if (v !is String) throw RoutineError("invalid", "note 는 문자열이어야 해요")
    val s = v.trim()
    if (s.length > MAX_NOTE) throw RoutineError("invalid", "note 는 ${MAX_NOTE}자 이하여야 해요")
    return s.ifEmpty { null }
  }

  // ---- JSON ----------------------------------------------------------------------------------
  private fun logJson(c: Cursor): JSONObject {
    val o = JSONObject().put("id", c.str("id")).put("routine", c.str("routine")).put("routine_id", c.str("routine_id")).put("date", c.str("date"))
    c.str("slot")?.let { o.put("slot", it) }
    o.put("status", c.str("status")).put("count", c.lng("count"))
    c.dblOrNull("value")?.let { o.put("value", it) }
    c.str("note")?.let { o.put("note", it) }
    o.put("logged_at", c.str("logged_at")).put("source", c.str("source"))
    return o
  }

  private fun loadLog(db: SQLiteDatabase, id: String): JSONObject? =
    db.rawQuery(RoutineSql.LOG_BY_ID, arrayOf(id)).use { if (it.moveToFirst()) logJson(it) else null }

  private fun progress(db: SQLiteDatabase, routineId: String, kind: String, target: Long, nTimes: Int, d: String): JSONObject {
    val o = JSONObject().put("date", d)
    if (kind == "habit") {
      val done = db.rawQuery(RoutineSql.PROGRESS_SUM, arrayOf(routineId, d)).use { if (it.moveToFirst()) it.getLong(0) else 0L }
      return o.put("done", done).put("target", target)
    }
    val done = db.rawQuery(RoutineSql.PROGRESS_COUNT, arrayOf(routineId, d)).use { if (it.moveToFirst()) it.getLong(0) else 0L }
    return o.put("done", done).put("target", Math.max(nTimes, 1))
  }

  private fun progressFor(db: SQLiteDatabase, routineId: String, d: String): JSONObject {
    var kind = "habit"; var target = 1L
    db.rawQuery(RoutineSql.ROUTINE_BY_ID, arrayOf(routineId)).use { if (it.moveToFirst()) { kind = it.str("kind")!!; target = it.lng("daily_target") } }
    val n = rows(db, RoutineSql.TIMES_FOR, arrayOf(routineId)) { 1 }.size
    return progress(db, routineId, kind, target, n, d)
  }

  // ---- query ---------------------------------------------------------------------------------
  fun query(db: SQLiteDatabase, a: JSONObject, now: Calendar): JSONObject {
    val today = logicalToday(db, now)
    val to = if (!nullish(a, "to")) vDate(a.opt("to")) else today
    val from = if (!nullish(a, "from")) vDate(a.opt("from")) else civilFromDays(epochDay(to) - DEFAULT_WINDOW_DAYS)
    if (from > to) throw RoutineError("invalid", "from 이 to 보다 늦어요")
    if (epochDay(to) - epochDay(from) > MAX_SPAN_DAYS) throw RoutineError("invalid", "기간은 최대 ${MAX_SPAN_DAYS}일까지예요")

    val times = HashMap<String, JSONArray>()
    db.rawQuery(RoutineSql.TIMES, null).use { c ->
      while (c.moveToNext()) {
        val o = JSONObject().put("time", c.str("time"))
        c.str("label")?.takeIf { it.isNotEmpty() }?.let { o.put("label", it) }
        times.getOrPut(c.str("routine_id")!!) { JSONArray() }.put(o)
      }
    }
    val routines = JSONArray()
    db.rawQuery(RoutineSql.ROUTINES, null).use { c ->
      while (c.moveToNext()) {
        val id = c.str("id")!!
        val o = JSONObject().put("id", id).put("name", c.str("name")).put("kind", c.str("kind"))
        c.str("detail")?.let { o.put("detail", it) }
        o.put("schedule", c.str("schedule")).put("weekdays", c.lng("weekdays"))
        c.lngOrNull("interval_days")?.let { o.put("interval_days", it) }
        c.lngOrNull("weekly_count")?.let { o.put("weekly_count", it) }
        o.put("start_date", c.str("start_date"))
        c.str("end_date")?.let { o.put("end_date", it) }
        o.put("daily_target", c.lng("daily_target"))
        c.str("unit")?.let { o.put("unit", it) }
        o.put("times", times[id] ?: JSONArray())
        o.put("archived", c.lng("archived") != 0L)
        routines.put(o)
      }
    }
    val logs = JSONArray()
    var n = 0
    db.rawQuery(RoutineSql.logRange(MAX_LOGS + 1), arrayOf(from, to)).use { c ->
      while (c.moveToNext()) { if (n < MAX_LOGS) logs.put(logJson(c)); n++ }
    }
    return JSONObject().put("v", 1).put("app", "routinelog").put("ts", System.currentTimeMillis()).put("today", today)
      .put("from", from).put("to", to).put("routines", routines).put("logs", logs).put("truncated", n > MAX_LOGS)
  }

  // ---- 루틴·슬롯 선택 ---------------------------------------------------------------------------
  private data class Rt(val id: String, val name: String, val kind: String, val archived: Boolean)
  private data class Slot(val time: String, val label: String?)

  private fun resolveRoutine(db: SQLiteDatabase, ref: String): Rt {
    val all = rows(db, RoutineSql.ROUTINES_LITE) { Rt(it.str("id")!!, it.str("name")!!, it.str("kind")!!, it.lng("archived") != 0L) }
    val refS = ref.trim()
    if (refS.length > MAX_NAME) throw RoutineError("invalid", "routine 은 ${MAX_NAME}자 이하여야 해요")
    all.firstOrNull { it.id == refS }?.let {
      if (it.archived) throw RoutineError("invalid", "'${it.name}' 루틴은 보관 상태라 기록할 수 없어요")
      return it
    }
    val pool = all.filter { !it.archived }
    val n = norm(refS)
    if (n.isEmpty()) throw RoutineError("invalid", "routine 이름이 비어 있어요")
    val exact = pool.filter { norm(it.name) == n }
    if (exact.size == 1) return exact[0]
    if (exact.size > 1) throw RoutineError("ambiguous", "같은 이름의 루틴이 여러 개예요: " + exact.joinToString(", ") { it.name })
    val part = pool.filter { norm(it.name).contains(n) }
    if (part.size == 1) return part[0]
    if (part.size > 1) throw RoutineError("ambiguous", "'$refS' 와 맞는 루틴이 여러 개예요: " + part.joinToString(", ") { it.name })
    val archived = all.filter { it.archived && norm(it.name).contains(n) }
    if (archived.isNotEmpty()) throw RoutineError("invalid", "'${archived[0].name}' 루틴은 보관 상태라 기록할 수 없어요")
    throw RoutineError("not_found", "'$refS' 루틴을 찾을 수 없어요. 있는 루틴: " + pool.joinToString(", ") { it.name })
  }

  /** slot 지정(HH:MM 또는 라벨) 또는 자동 선택 */
  private fun pickSlot(db: SQLiteDatabase, times: List<Slot>, slotArg: String?, d: String, routineId: String, today: String, now: Calendar): String {
    if (slotArg != null) {
      val s = slotArg.trim()
      if (TIME_RE.matches(s)) {
        val hhmm = s.padStart(5, '0')
        if (times.none { it.time == hhmm }) throw RoutineError("not_found", "'$s' 시각이 없어요. 있는 시각: " + times.joinToString(", ") { it.time })
        return hhmm
      }
      val n = norm(s)
      val exact = times.filter { it.label != null && norm(it.label) == n }.map { it.time }
      val pool = if (exact.isNotEmpty()) exact else times.filter { it.label != null && norm(it.label).contains(n) }.map { it.time }
      if (pool.size == 1) return pool[0]
      if (pool.size > 1) throw RoutineError("ambiguous", "'$s' 와 맞는 시각이 여러 개예요: " + pool.joinToString(", "))
      throw RoutineError("not_found", "'$s' 시각/라벨이 없어요. 있는 시각: " + times.joinToString(", ") { it.time + (if (!it.label.isNullOrEmpty()) "(${it.label})" else "") })
    }
    val used = rows(db, RoutineSql.SLOTS_USED, arrayOf(routineId, d)) { it.str("slot") }.toSet()
    val free = times.map { it.time }.filter { it !in used }
    if (free.isEmpty()) throw RoutineError("already_done", "그날의 모든 시각을 이미 체크했어요")
    val startMin = dayStartMinutes(db)
    val passed: List<String> = when {
      d < today -> free
      d > today -> emptyList()
      else -> { val cur = logicalMinutes(db, now); free.filter { slotMinutes(startMin, it) <= cur } }
    }
    if (passed.isNotEmpty()) return passed.maxByOrNull { slotMinutes(startMin, it) }!!
    return free.minByOrNull { slotMinutes(startMin, it) }!!
  }

  // ---- log -----------------------------------------------------------------------------------
  private fun dupResult(db: SQLiteDatabase, id: String): JSONObject {
    val lg = loadLog(db, id) ?: throw RoutineError("db_error", "기록을 찾을 수 없어요")
    return JSONObject().put("ok", true).put("id", id).put("duplicate", true).put("log", lg)
      .put("routine", JSONObject().put("name", lg.optString("routine")))
      .put("progress", progressFor(db, lg.optString("routine_id"), lg.optString("date")))
  }

  fun log(db: SQLiteDatabase, a: JSONObject, now: Calendar): JSONObject {
    val reqId = a.opt("req_id")
    if (reqId !is String || !REQ_ID_RE.matches(reqId)) throw RoutineError("invalid", "req_id 가 필요해요 (영문·숫자·_.:- 64자 이하)")
    if (blank(a, "routine")) throw RoutineError("invalid", "routine(루틴 이름)이 필요해요")
    val status = if (nullish(a, "status")) "done" else (a.opt("status") as? String)
    if (status != "done" && status != "skipped") throw RoutineError("invalid", "status 는 done 또는 skipped 여야 해요")
    val countGiven = !nullish(a, "count")
    val count = if (countGiven) vCount(a.opt("count")) else 1
    val value = vValue(a)
    val note = vNote(a)
    val today = logicalToday(db, now)
    val d = if (!nullish(a, "date")) vDate(a.opt("date")) else today
    return writeTx(db) {
      db.rawQuery(RoutineSql.LOG_BY_REF, arrayOf(reqId)).use { if (it.moveToFirst()) return@writeTx dupResult(db, it.str("id")!!) }
      val rt = resolveRoutine(db, refString(a, "routine"))
      val times = rows(db, RoutineSql.TIMES_FOR, arrayOf(rt.id)) { Slot(it.str("time")!!, it.str("label")) }
      var slot: String? = null
      if (rt.kind == "habit") {
        if (!blank(a, "slot")) throw RoutineError("invalid", "습관에는 slot 을 쓸 수 없어요")
      } else {
        if (countGiven && count != 1) throw RoutineError("invalid", "복약·영양제는 count 를 쓸 수 없어요 (시각마다 1회)")
        if (times.isNotEmpty()) {
          val picked = pickSlot(db, times, if (blank(a, "slot")) null else refString(a, "slot"), d, rt.id, today, now)
          slot = picked
          db.rawQuery(RoutineSql.LOG_SLOT, arrayOf(rt.id, d, picked)).use {
            if (it.moveToFirst()) throw RoutineError("already_done", "$d $picked 은 이미 체크했어요 (${it.str("status")})")
          }
        } else {
          if (!blank(a, "slot")) throw RoutineError("invalid", "이 루틴에는 정해진 시각이 없어요")
          db.rawQuery(RoutineSql.LOG_NOSLOT, arrayOf(rt.id, d)).use {
            if (it.moveToFirst()) throw RoutineError("already_done", "$d 은 이미 체크했어요 (${it.str("status")})")
          }
        }
      }
      val logId = "lg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16)
      try {
        db.execSQL(RoutineSql.INSERT, arrayOf<Any?>(logId, rt.id, d, slot, status, count, value, note, nowIso(), reqId))
      } catch (e: SQLiteConstraintException) {
        // 동시에 같은 req_id 가 먼저 들어간 경우(UNIQUE) → 기존 결과, 아니면 슬롯 중복
        db.rawQuery(RoutineSql.LOG_BY_REF, arrayOf(reqId)).use { if (it.moveToFirst()) return@writeTx dupResult(db, it.str("id")!!) }
        throw RoutineError("already_done", "$d ${slot ?: ""} 은 이미 체크했어요")
      }
      val lg = loadLog(db, logId) ?: throw RoutineError("db_error", "저장한 기록을 읽지 못했어요")
      var target = 1L
      db.rawQuery(RoutineSql.ROUTINE_BY_ID, arrayOf(rt.id)).use { if (it.moveToFirst()) target = it.lng("daily_target") }
      JSONObject().put("ok", true).put("id", logId).put("duplicate", false).put("log", lg)
        .put("routine", JSONObject().put("name", rt.name)).put("progress", progress(db, rt.id, rt.kind, target, times.size, d))
    }
  }

  // ---- undo ----------------------------------------------------------------------------------
  fun undo(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val id = (a.opt("id") as? String)?.trim()
    if (id.isNullOrEmpty()) throw RoutineError("invalid", "id 가 필요해요")
    return writeTx(db) {
      val lg = loadLog(db, id) ?: throw RoutineError("not_found", "해당 기록을 찾을 수 없어요")
      db.execSQL(RoutineSql.DELETE, arrayOf<Any?>(lg.optString("id")))
      JSONObject().put("ok", true).put("deleted", true).put("id", lg.optString("id"))
        .put("routine", JSONObject().put("name", lg.optString("routine"))).put("progress", progressFor(db, lg.optString("routine_id"), lg.optString("date")))
    }
  }
}
