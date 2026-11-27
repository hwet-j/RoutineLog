package expo.modules.assistantshare

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 이 모듈의 실체는 AssistantShareProvider(매니페스트의 ContentProvider)이다.
 * JS 쪽에서 부를 함수는 없다 (루틴 데이터는 expo-sqlite 가 쓰는 같은 DB 파일을 제공자가 직접 연다).
 */
class AssistantShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AssistantShare")
  }
}
