# RoutineLog 제공자: SQL 과 규칙

`modules/assistant-share` (Kotlin `RoutineApi.kt`, `RoutineSql.kt`)는 **`tests/provider/routine.py` 의 한 줄씩 포팅**이다.
규칙을 바꿀 때는 ① 이 문서 ② `tests/provider/routine.py` + 테스트 ③ Kotlin 순서로 고친다.
Kotlin 은 이 환경에서 실행할 수 없어서(Android 에뮬레이터 없음), 동작은 Python 참조 구현의 테스트(`python3 -m unittest tests.provider.test_provider`)로 고정하고,
SQL 문자열이 어긋나지 않는지는 `tests.provider.test_parity` 가 검사한다.

- authority `com.hwetj.routinelog.assistant`, `ContentResolver.call(Uri("content://com.hwetj.routinelog.assistant"), method, argJson, null)`
- 호출자: `getCallingPackage() == "com.hwetj.assistant"` (null 이면 호출 uid 의 패키지 목록에 포함) 아니면 `forbidden`
- DB: `<filesDir>/SQLite/routinelog.db`. 없거나 테이블이 없으면 `no_db`. **앱 JS 와 제공자는 `SharedDb`(Kotlin 싱글턴)의 같은 SQLite 연결 하나를 공유한다** (아래 "하나의 연결" 절)
- 응답 Bundle: 성공 `json`+`ts`, 실패 `error`+`message`. 오류 코드: `forbidden no_db unknown_method invalid ambiguous not_found already_done busy db_error unavailable`
- ContentProvider 본연의 query/insert/update/delete/getType 은 null/0 (다른 경로 없음)

## 하나의 연결 (DB 손상 방지)
한 프로세스에서 SQLite 라이브러리가 둘(앱에 번들된 expo-sqlite + 안드로이드 시스템 것)이면 POSIX 잠금(fcntl)이 서로를 풀어 `database disk image is malformed` 가 생긴다
(어느 한쪽이 같은 파일의 fd 를 close() 하면 프로세스의 모든 잠금이 풀림). 그래서
- 앱은 expo-sqlite 를 쓰지 않는다. `RoutineDbModule`(JS 래퍼 `src/db/native.ts`)이 `SharedDb` 의 연결로 SQL 을 실행한다.
- 제공자도 `SharedDb` 를 쓴다. 연결은 프로세스 수명 동안 하나이고 절대 닫지 않는다. WAL 은 쓰지 않는다(기본 저널, 단일 연결).
- 모든 DB 작업은 단일 스레드 실행기에서 하고, 하나의 `Semaphore` 가 "누가 DB 를 쓰는가"를 정한다. JS 트랜잭션은 `txBegin`(BEGIN IMMEDIATE)부터 `txEnd`(COMMIT/ROLLBACK)까지 잠금을 쥐고,
  제공자의 작업은 같은 잠금 안에서 돌아서 JS 트랜잭션 도중에 끼어들지 못한다. 잠금을 못 얻으면(10초) `busy`. 트랜잭션은 60초 안전장치가 있다.
- 시작할 때 `PRAGMA quick_check`. 실패하면 파일(+ -wal/-shm/-journal)을 `routinelog.db.corrupt-<시각>` 로 **이름만 바꿔 보존**하고 새 DB 를 만든다(앱이 안내, 설정에서 삭제 가능).
  예전 expo-sqlite 가 WAL 로 만든 파일은 열 때 기본 저널로 되돌리며 `-wal` 내용을 합친다(같은 파일을 이어서 쓴다).

## ping (DB 를 열지 않는 상태 확인)
`ping` → `{ok:true, db:<DB 파일 존재>, recovered:<이번 실행에서 손상 복구 여부>, version}`. 호출자 검사 후 바로 응답하며 DB 를 건드리지 않는다. 비서 앱의 "연동 앱" 탭이 자주 부르는 용도.

## 스키마 수정 (앱도 같은 DDL 을 써야 한다)
스펙의 `logs_slot` 표현식 인덱스는 같은 밀리초의 습관 로그 2건을 UNIQUE 위반으로 막고 SQLite 3.9+ 가 필요하다.
같은 의미("복약 슬롯은 루틴·날짜·슬롯당 1건, 습관 로그는 여러 건")를 부분 인덱스(SQLite 3.8+)로 대체:
```sql
CREATE UNIQUE INDEX logs_slot ON logs(routine_id, date, slot) WHERE slot IS NOT NULL;
```
슬롯이 없는 복약 루틴(시각 0개)의 "하루 1회" 는 인덱스가 아니라 코드가 `slot IS NULL` 로그를 확인해 지킨다. (`routines.notify_style` 컬럼은 제공자가 쓰지 않는다.)

## 메서드
| method | arg(JSON) | 성공 json |
|---|---|---|
| `query` | `{from?, to?}` (기본 `to`=오늘, `from`=to−14일, 최대 400일) | `{v,app:'routinelog',ts,today,from,to,routines[],logs[],truncated}` (logs 최대 3000) |
| `log` | `{req_id, routine, date?, slot?, status?, count?, value?, note?}` | `{ok,id,duplicate,log,routine:{name},progress:{date,done,target}}` |
| `undo` | `{id}` | `{ok,deleted,id,routine:{name},progress}` |

`query` 의 routine 은 `{id,name,kind,detail?,schedule,weekdays,interval_days?,weekly_count?,start_date,end_date?,daily_target,unit?,times:[{time,label?}],archived}` (보관 루틴은 뒤쪽),
log 는 `{id,routine(이름),routine_id,date,slot?,status,count,value?,note?,logged_at,source}`. 비어 있는 선택 필드는 키를 생략한다. 스케줄 해석(오늘 해야 할 것·스트릭)은 비서가 원시 데이터로 계산한다.

## 규칙
- **이름 정규화** `norm(s)` = 모든 공백 제거 + 소문자. 루틴 매칭: id 일치 → 정규화 이름 완전일치(1건 확정, 2건 이상 `ambiguous`) → 부분일치(1건 확정, 2건 이상 `ambiguous`) → `not_found`(후보 나열). 보관(archived) 루틴은 후보에서 빼고, 보관 루틴을 가리키면 `invalid`.
- **하루 시작 시각**: kv `day_start`(`HH:MM`, 없거나 형식이 틀리면 `00:00`). 기기 현지 시각이 그 시각 이전이면 "오늘"은 전날. 슬롯 시각이 `day_start` 보다 이르면 그날의 끝(+24h)으로 취급한다(예: day_start 04:00 이면 01:00 슬롯은 25:00).
- **슬롯(복약·영양제 `times` 가 있을 때)**: `slot` 이 `H:MM|HH:MM` 이면 그 시각이 있어야 함(없으면 `not_found`), 아니면 라벨 정규화 완전일치→부분일치(여러 개 `ambiguous`). 생략하면 그 날짜에 아직 로그(done/skipped 불문)가 없는 슬롯 중 **현재(논리) 시각 이하 중 가장 늦은 것**, 없으면 **가장 이른 미체크 슬롯**. 과거 날짜는 전부 "지난 것"(가장 늦은 미체크), 미래 날짜는 "안 지난 것"(가장 이른 미체크). 미체크가 없으면 `already_done`.
- **중복 체크**: 같은 (루틴, 날짜, 슬롯) 로그가 이미 있으면 `already_done`(DB 부분 인덱스가 동시 요청에서도 보장). 시각이 없는 복약 루틴은 날짜당 1건(`slot IS NULL` 로그 확인). 습관은 여러 건 가능.
- **습관**: `slot` 불가, `count`(1..1000, 기본 1)는 새 로그 행으로 추가(누적 아님), `value`(유한 숫자, |v|≤1e9), `note`(≤500자, 공백뿐이면 없음). 복약·영양제는 `count` 를 1 외로 줄 수 없다.
- **status**: `done`(기본) 또는 `skipped`. skipped 도 슬롯을 차지하지만 progress 의 done 에는 안 센다.
- **progress**: 습관 = 그날 done 로그의 `count` 합 / `daily_target`; 복약·영양제 = 그날 done 슬롯 수 / 시각 개수(0개면 1).
- **멱등**: `req_id`(`[A-Za-z0-9_.:-]{1,64}`)를 `source_ref` 에 저장. 같은 `req_id` 는 인자가 달라도 새로 만들지 않고 처음 기록을 `duplicate:true` 로 돌려줌. `BEGIN IMMEDIATE` + UNIQUE 위반 시 재조회로 동시 요청도 1건만 생성. `undo` 로 지우면 그 `req_id` 는 다시 쓸 수 있다.
- **검증**: date `YYYY-MM-DD` 실존 날짜 2000-01-01..2100-12-31(생략 시 논리적 오늘), routine ≤80자, 입력 JSON ≤20,000자.
- 쓰기는 모두 `BEGIN IMMEDIATE`(Kotlin `beginTransactionNonExclusive`) 한 트랜잭션. 오류면 롤백.

## SQL (tests/provider/routine.py 상수와 동일)
```sql
-- SQL_ROUTINES
SELECT id, name, kind, detail, schedule, weekdays, interval_days, weekly_count, start_date, end_date, daily_target, unit, archived
FROM routines ORDER BY archived, sort, created_at, name;

-- SQL_ROUTINES_LITE
SELECT id, name, kind, archived FROM routines ORDER BY sort, created_at, name;

-- SQL_TIMES
SELECT routine_id, time, label FROM routine_times ORDER BY routine_id, time, id;

-- SQL_TIMES_FOR
SELECT time, label FROM routine_times WHERE routine_id = ? ORDER BY time, id;

-- SQL_LOG_SELECT
SELECT l.id, l.routine_id, r.name AS routine, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source
FROM logs l JOIN routines r ON r.id = l.routine_id;

-- SQL_LOG_RANGE
SELECT l.id, l.routine_id, r.name AS routine, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source
FROM logs l JOIN routines r ON r.id = l.routine_id
WHERE l.date >= ? AND l.date <= ?
ORDER BY l.date DESC, COALESCE(l.slot,'') DESC, l.logged_at DESC, l.id DESC LIMIT ?;

-- SQL_LOG_BY_ID
SELECT l.id, l.routine_id, r.name AS routine, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source
FROM logs l JOIN routines r ON r.id = l.routine_id WHERE l.id = ?;

-- SQL_LOG_BY_REF
SELECT id FROM logs WHERE source_ref = ?;

-- SQL_LOG_SLOT
SELECT id, status FROM logs WHERE routine_id = ? AND date = ? AND slot = ?;

-- SQL_LOG_NOSLOT
SELECT id, status FROM logs WHERE routine_id = ? AND date = ? AND slot IS NULL;

-- SQL_SLOTS_USED
SELECT slot FROM logs WHERE routine_id = ? AND date = ? AND slot IS NOT NULL;

-- SQL_INSERT
INSERT INTO logs(id,routine_id,date,slot,status,count,value,note,logged_at,source,source_ref)
VALUES(?,?,?,?,?,?,?,?,?,'assistant',?);

-- SQL_DELETE
DELETE FROM logs WHERE id = ?;

-- SQL_PROGRESS_COUNT
SELECT COUNT(*) FROM logs WHERE routine_id = ? AND date = ? AND status = 'done';

-- SQL_PROGRESS_SUM
SELECT COALESCE(SUM(count),0) FROM logs WHERE routine_id = ? AND date = ? AND status = 'done';

-- SQL_ROUTINE_BY_ID
SELECT id, name, kind, daily_target FROM routines WHERE id = ?;

-- SQL_KV
SELECT value FROM kv WHERE key = ?;
```
