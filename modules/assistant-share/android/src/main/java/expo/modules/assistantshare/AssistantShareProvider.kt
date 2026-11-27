package expo.modules.assistantshare

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteException
import android.net.Uri
import android.os.Binder
import android.os.Bundle

/**
 * 비서 앱 전용 제공자. ContentResolver.call(authority, method, arg) 로 루틴 DB 를 읽고 기록한다.
 * - 호출자 패키지가 com.hwetj.assistant 가 아니면 "forbidden"
 * - method: ping(DB 를 열지 않음) · query · log · undo (그 밖은 "unknown_method")
 * - query/insert/update/delete(ContentProvider 본연의 메서드)는 전부 막혀 있어 다른 경로로는 아무것도 노출되지 않는다
 * 응답 Bundle: 성공 = json(String), ts(Long) / 실패 = error(코드), message
 * 오류 코드: forbidden · no_db · unknown_method · invalid · ambiguous · not_found · already_done · busy · db_error · unavailable
 */
class AssistantShareProvider : ContentProvider() {
  override fun onCreate() = true

  override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
    val ctx = context ?: return error("unavailable", "컨텍스트가 없어요")
    if (!callerAllowed()) return error("forbidden", "허용되지 않은 호출자예요")
    // ping: DB 를 열지 않는다. 비서 앱이 연동 상태를 자주 확인하므로 가볍게 응답한다
    if (method == "ping") return ping(ctx)
    if (method !in METHODS) return error("unknown_method", method)
    if (!SharedDb.file(ctx).exists()) return error("no_db", "RoutineLog 를 한 번 실행해 주세요")
    return try {
      // 앱 JS 와 같은 연결·같은 잠금 안에서 실행한다 (SQLite 라이브러리를 둘 쓰면 파일이 손상된다)
      val result = SharedDb.locked(10_000) { SharedDb.onDb(ctx, false) { db -> RoutineApi.handle(db, method, arg) } }
      Bundle().apply {
        putString("json", result.toString())
        putLong("ts", System.currentTimeMillis())
      }
    } catch (e: RoutineError) {
      error(e.code, e.message)
    } catch (e: NoDbException) {
      error("no_db", "RoutineLog 를 한 번 실행해 주세요")
    } catch (e: DbBusyException) {
      error("busy", "앱이 DB 를 쓰는 중이에요. 잠시 뒤 다시 시도해 주세요")
    } catch (e: SQLiteException) {
      // 테이블이 아직 없으면(앱이 DB 를 초기화하기 전) no_db 로 안내
      if ((e.message ?: "").contains("no such table")) error("no_db", "RoutineLog 를 한 번 실행해 주세요") else error("db_error", e.message ?: "DB 오류")
    } catch (e: Exception) {
      error("db_error", e.message ?: e.javaClass.simpleName)
    }
  }

  private fun ping(ctx: android.content.Context): Bundle {
    val version = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
    val json = org.json.JSONObject().put("ok", true).put("db", SharedDb.file(ctx).exists()).put("recovered", SharedDb.recovered != null).put("version", version)
    return Bundle().apply {
      putString("json", json.toString())
      putLong("ts", System.currentTimeMillis())
    }
  }

  private fun error(code: String, message: String) = Bundle().apply {
    putString("error", code)
    putString("message", message)
  }

  private fun callerAllowed(): Boolean {
    if (callingPackage == ALLOWED) return true
    // callingPackage 가 null 일 수 있어 uid 로도 확인한다 (uid 는 위조할 수 없다)
    val pkgs = context?.packageManager?.getPackagesForUid(Binder.getCallingUid()) ?: return false
    return pkgs.contains(ALLOWED)
  }

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun getType(uri: Uri): String? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

  companion object {
    const val ALLOWED = "com.hwetj.assistant"
    private val METHODS = setOf("query", "log", "undo")
  }
}
