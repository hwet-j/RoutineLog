package expo.modules.assistantshare

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 앱 JS 가 쓰는 DB. expo-sqlite 대신 SharedDb(프로세스 안의 단일 연결)를 쓰므로,
 * 비서 제공자와 같은 연결·같은 잠금을 공유해 파일이 손상되지 않는다.
 * JS 쪽 얇은 래퍼는 src/db/native.ts (expo-sqlite 와 같은 모양의 API).
 */
class RoutineDbModule : Module() {
  private fun ctx() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RoutineDb")

    /** DB 를 열고(없으면 만들고) 무결성을 확인한다. 손상이면 보존하고 새로 만든다 → recovered 에 보존된 파일 이름 */
    AsyncFunction("open") {
      val c = ctx()
      SharedDb.locked { SharedDb.onDb(c, true) { } }
      mapOf<String, Any?>("recovered" to SharedDb.recovered)
    }

    AsyncFunction("exec") { sql: String ->
      val c = ctx()
      SharedDb.locked { SharedDb.onDb(c, true) { d -> SharedDb.exec(d, sql) } }
      null
    }
    AsyncFunction("run") { sql: String, params: List<Any?> ->
      val c = ctx()
      SharedDb.locked { SharedDb.onDb(c, true) { d -> SharedDb.run(d, sql, params) } }
    }
    AsyncFunction("getAll") { sql: String, params: List<Any?> ->
      val c = ctx()
      SharedDb.locked { SharedDb.onDb(c, true) { d -> SharedDb.query(d, sql, params) } }
    }

    // 트랜잭션: txBegin 이 잠금을 잡고 BEGIN IMMEDIATE, txEnd 가 COMMIT/ROLLBACK 후 잠금을 놓는다
    AsyncFunction("txBegin") { SharedDb.txBegin(ctx()) }
    AsyncFunction("txExec") { token: String, sql: String ->
      val c = ctx()
      SharedDb.requireTx(token)
      SharedDb.onDb(c, true) { d -> SharedDb.exec(d, sql) }
      null
    }
    AsyncFunction("txRun") { token: String, sql: String, params: List<Any?> ->
      val c = ctx()
      SharedDb.requireTx(token)
      SharedDb.onDb(c, true) { d -> SharedDb.run(d, sql, params) }
    }
    AsyncFunction("txGetAll") { token: String, sql: String, params: List<Any?> ->
      val c = ctx()
      SharedDb.requireTx(token)
      SharedDb.onDb(c, true) { d -> SharedDb.query(d, sql, params) }
    }
    AsyncFunction("txEnd") { token: String, commit: Boolean ->
      SharedDb.txEnd(ctx(), token, commit)
      null
    }

    // 손상되어 보존된 파일 목록 / 삭제
    AsyncFunction("listCorrupt") {
      SharedDb.listCorrupt(ctx()).map { mapOf<String, Any?>("name" to it.first, "bytes" to it.second) }
    }
    AsyncFunction("deleteCorrupt") { name: String -> SharedDb.deleteCorrupt(ctx(), name) }
  }
}
