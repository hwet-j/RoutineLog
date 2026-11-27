# RoutineLog

복약·영양제 알림과 습관 기록을 위한 루틴 앱 (Android, Expo SDK 58). 캘린더와 별개의 기록용 앱입니다.

- **오늘**: 시간대별 체크리스트(복약·영양제·습관), 탭 한 번으로 체크
- **기록**: 날짜별 일지, 메모 검색, 월 히트맵
- **루틴**: 매일/요일/N일마다/주 N회, 여러 시각, 알림 방식(소리·진동·조용히)
- **통계**: 연속 달성(streak), 복약 순응도, 요일 패턴, 12주 히트맵
- 비서 앱(`com.hwetj.assistant`) 연동: 앱을 열지 않고 "영양제 먹었어" 같은 말로 체크

개발: `npm test` (jest), `npx tsc --noEmit`, `npx eslint .`. 빌드는 GitHub Actions(build-apk.yml)가 release APK 를 만듭니다.
