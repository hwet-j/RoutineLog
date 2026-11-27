package expo.modules.assistantshare

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteCursorDriver
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteQuery
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

class NoDbException : RuntimeException("DB 파일이 아직 없어요")
class DbBusyException : RuntimeException("DB 가 사용 중이에요")

/**
 * 프로세스 안의 **유일한** SQLite 연결. 앱 JS(RoutineDbModule)와 비서 제공자(AssistantShareProvider)가 모두 이걸 쓴다.
 *
 * 왜: 같은 프로세스에서 SQLite 라이브러리 둘(expo-sqlite 의 번들본 + 안드로이드 시스템 것)이 한 파일을 열면
 * POSIX 잠금이 서로 풀려 "database disk image is malformed" 로 손상된다. 그래서 expo-sqlite 를 쓰지 않고,
 * 앱과 제공자가 같은 android.database.sqlite 연결 하나를 공유한다.
 *
 * - 모든 DB 작업은 단일 스레드 실행기에서 한다 (안드로이드의 트랜잭션은 스레드에 묶여 있어서, JS 가 여러 번의 호출에 걸쳐
 *   BEGIN … COMMIT 을 하려면 같은 스레드여야 한다).
 * - lock(Semaphore)은 "누가 DB 를 쓰는 중인가"를 정한다: 일반 호출은 짧게, JS 트랜잭션은 BEGIN 부터 COMMIT/ROLLBACK 까지 잡는다.
 *   제공자의 작업도 같은 lock 안에서 실행되므로 JS 트랜잭션 도중에 끼어들지 못한다.
 * - 저널은 WAL 이 아닌 기본(DELETE) 모드, 연결은 하나 (데이터가 작아 충분).
 */
object SharedDb {
  const val DB_FILE = "routinelog.db"
  private const val LOCK_WAIT_MS = 30_000L
  private const val TX_MAX_MS = 60_000L

  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "routine-db").apply { isDaemon = true } }
  private val watchdog = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "routine-db-watchdog").apply { isDaemon = true } }
  private val lock = Semaphore(1, true)

  @Volatile private var db: SQLiteDatabase? = null
  /** 이번 프로세스에서 손상된 DB 를 치우고 새로 만들었다면 보존된 파일 이름 */
  @Volatile var recovered: String? = null
    private set

  // 진행 중인 JS 트랜잭션
  @Volatile private var txToken: String? = null
  private var txWatch: ScheduledFuture<*>? = null

  fun file(ctx: Context) = File(ctx.filesDir, "SQLite/$DB_FILE")

  // ---- 실행기 -------------------------------------------------------------------------------
  fun <T> onDb(ctx: Context, create: Boolean, block: (SQLiteDatabase) -> T): T {
    try {
      return executor.submit(Callable { block(ensureOpen(ctx, create)) }).get()
    } catch (e: ExecutionException) {
      throw e.cause ?: e
    }
  }

  /** 일반(트랜잭션 밖) 작업: 잠금을 잠깐 잡고 실행한다 */
  fun <T> locked(waitMs: Long = LOCK_WAIT_MS, block: () -> T): T {
    if (!lock.tryAcquire(waitMs, TimeUnit.MILLISECONDS)) throw DbBusyException()
    try {
      return block()
    } finally {
      lock.release()
    }
  }

  // ---- 열기 / 손상 처리 -------------------------------------------------------------------
  /** 실행기 스레드에서만 호출 */
  private fun ensureOpen(ctx: Context, create: Boolean): SQLiteDatabase {
    db?.let { if (it.isOpen) return it }
    val f = file(ctx)
    if (!f.exists() && !create) throw NoDbException()
    f.parentFile?.mkdirs()
    var opened = tryOpen(f)
    if (opened == null && f.exists()) {
      // 손상: 지우지 않고 이름만 바꿔 보존한 뒤 새로 시작한다
      val stamp = System.currentTimeMillis()
      val keep = "${DB_FILE}.corrupt-$stamp"
      f.renameTo(File(f.parentFile, keep))
      for (suffix in listOf("-wal", "-shm", "-journal")) {
        val side = File(f.parentFile, DB_FILE + suffix)
        if (side.exists()) side.renameTo(File(f.parentFile, "$keep$suffix"))
      }
      recovered = keep
      opened = tryOpen(f)
    }
    val d = opened ?: throw SQLiteException("DB 를 열 수 없어요")
    db = d
    return d
  }

  /** 열고 무결성을 확인한다. 손상이면 null (열린 연결은 닫는다) */
  private fun tryOpen(f: File): SQLiteDatabase? {
    var d: SQLiteDatabase? = null
    return try {
      d = SQLiteDatabase.openDatabase(f.path, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY)
      d.disableWriteAheadLogging() // 연결 풀(읽기 전용 추가 연결) 없이 단일 연결, 호환 WAL 도 끈다
      // 예전 expo-sqlite 가 WAL 로 만든 파일이면 기본 저널로 되돌리며 -wal 내용을 본 파일에 합친다
      d.rawQuery("PRAGMA journal_mode", null).use { c -> if (c.moveToFirst() && c.getString(0).equals("wal", true)) d.rawQuery("PRAGMA journal_mode=DELETE", null).use { it.moveToFirst() } }
      d.setForeignKeyConstraintsEnabled(true)
      d.rawQuery("PRAGMA busy_timeout = 5000", null).use { it.moveToFirst() }
      val ok = d.rawQuery("PRAGMA quick_check", null).use { c -> c.moveToFirst() && c.getString(0).equals("ok", true) }
      if (ok) d else { d.close(); null }
    } catch (e: SQLiteException) {
      try { d?.close() } catch (_: Exception) {}
      null
    }
  }

  fun listCorrupt(ctx: Context): List<Pair<String, Long>> =
    (file(ctx).parentFile?.listFiles() ?: emptyArray()).filter { it.name.startsWith("$DB_FILE.corrupt-") && !it.name.endsWith("-wal") && !it.name.endsWith("-shm") && !it.name.endsWith("-journal") }
      .map { it.name to it.length() }.sortedBy { it.first }

  fun deleteCorrupt(ctx: Context, name: String): Boolean {
    if (!name.startsWith("$DB_FILE.corrupt-") || name.contains('/') || name.contains("..")) return false
    val dir = file(ctx).parentFile ?: return false
    var any = false
    for (suffix in listOf("", "-wal", "-shm", "-journal")) {
      val x = File(dir, name + suffix)
      if (x.exists() && x.delete()) any = true
    }
    return any
  }

  // ---- JS 트랜잭션 --------------------------------------------------------------------------
  fun txBegin(ctx: Context): String {
    if (!lock.tryAcquire(LOCK_WAIT_MS, TimeUnit.MILLISECONDS)) throw DbBusyException()
    val token = java.util.UUID.randomUUID().toString()
    try {
      onDb(ctx, true) { it.execSQL("BEGIN IMMEDIATE") }
    } catch (e: Exception) {
      lock.release()
      throw e
    }
    txToken = token
    // 안전장치: JS 가 끝내지 않고 사라져도 DB 가 영원히 잠기지 않게 한다
    txWatch = watchdog.schedule({ forceEnd(ctx, token) }, TX_MAX_MS, TimeUnit.MILLISECONDS)
    return token
  }

  fun requireTx(token: String) {
    if (token != txToken) throw IllegalStateException("트랜잭션이 이미 끝났어요")
  }

  fun txEnd(ctx: Context, token: String, commit: Boolean) {
    requireTx(token)
    try {
      onDb(ctx, true) { d ->
        if (commit) {
          try {
            d.execSQL("COMMIT")
          } catch (e: Exception) {
            try { d.execSQL("ROLLBACK") } catch (_: Exception) {}
            throw e
          }
        } else {
          d.execSQL("ROLLBACK")
        }
      }
    } finally {
      release(token)
    }
  }

  private fun forceEnd(ctx: Context, token: String) {
    if (token != txToken) return
    try { onDb(ctx, true) { it.execSQL("ROLLBACK") } } catch (_: Exception) {}
    release(token)
  }

  private fun release(token: String) {
    if (token != txToken) return
    txToken = null
    txWatch?.cancel(false)
    txWatch = null
    lock.release()
  }

  // ---- SQL 실행 도우미 (실행기 스레드에서) --------------------------------------------------------
  private fun isQuery(sql: String): Boolean {
    val first = sql.trimStart().takeWhile { !it.isWhitespace() && it != '(' }.uppercase()
    return first == "SELECT" || first == "PRAGMA" || first == "WITH" || first == "EXPLAIN" || first == "VALUES"
  }

  /** JS 에서 온 값을 SQLite 값으로: 정수처럼 보이는 숫자는 Long, Boolean 은 0/1 */
  fun normalize(v: Any?): Any? = when (v) {
    null -> null
    is Boolean -> if (v) 1L else 0L
    is Int -> v.toLong()
    is Long -> v
    is Float -> normalize(v.toDouble())
    is Double -> if (v == Math.floor(v) && Math.abs(v) < 9.0e15) v.toLong() else v
    is String -> v
    else -> v.toString()
  }

  fun exec(d: SQLiteDatabase, sql: String) {
    if (isQuery(sql)) d.rawQuery(sql, null).use { while (it.moveToNext()) { /* 결과는 버린다 */ } } else d.execSQL(sql)
  }

  fun run(d: SQLiteDatabase, sql: String, params: List<Any?>): Map<String, Any?> {
    val args = params.map(::normalize).toTypedArray()
    if (isQuery(sql)) {
      query(d, sql, params).size // PRAGMA 등: 실행만
      return mapOf("changes" to 0, "lastInsertRowId" to 0L)
    }
    if (args.isEmpty()) d.execSQL(sql) else d.execSQL(sql, args)
    return d.rawQuery("SELECT changes(), last_insert_rowid()", null).use { c ->
      c.moveToFirst()
      mapOf("changes" to c.getInt(0), "lastInsertRowId" to c.getLong(1))
    }
  }

  /** 형식 있는 바인딩으로 SELECT: rawQuery 는 문자열 인자만 받아서 LIMIT ? 같은 곳에서 타입이 어긋날 수 있다 */
  fun query(d: SQLiteDatabase, sql: String, params: List<Any?>): List<Map<String, Any?>> {
    val args = params.map(::normalize)
    val factory = SQLiteDatabase.CursorFactory { _, driver: SQLiteCursorDriver, editTable: String?, q: SQLiteQuery ->
      args.forEachIndexed { i, v ->
        val idx = i + 1
        when (v) {
          null -> q.bindNull(idx)
          is Long -> q.bindLong(idx, v)
          is Double -> q.bindDouble(idx, v)
          else -> q.bindString(idx, v.toString())
        }
      }
      SQLiteCursor(driver, editTable, q)
    }
    val out = ArrayList<Map<String, Any?>>()
    d.rawQueryWithFactory(factory, sql, null, null).use { c ->
      val names = c.columnNames
      while (c.moveToNext()) {
        val row = LinkedHashMap<String, Any?>(names.size)
        for (i in names.indices) {
          row[names[i]] = when (c.getType(i)) {
            Cursor.FIELD_TYPE_NULL -> null
            Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
            Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
            Cursor.FIELD_TYPE_BLOB -> android.util.Base64.encodeToString(c.getBlob(i), android.util.Base64.NO_WRAP)
            else -> c.getString(i)
          }
        }
        out.add(row)
      }
    }
    return out
  }
}
