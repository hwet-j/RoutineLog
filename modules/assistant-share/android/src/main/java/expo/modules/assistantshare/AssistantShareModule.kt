package expo.modules.assistantshare

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 이 모듈의 실체는 AssistantShareProvider(매니페스트의 ContentProvider)이다.
 * JS 쪽에서 부를 함수는 없다. DB 는 RoutineDbModule(앱 JS)과 제공자가 SharedDb 의 같은 연결을 공유한다.
 */
class AssistantShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AssistantShare")
  }
}
