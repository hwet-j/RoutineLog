#!/usr/bin/env bash
# 에뮬레이터에서 앱을 설치·실행해 네이티브 DB 모듈과 제공자를 확인한다 (CI: .github/workflows/emulator-test.yml)
# 확인: ① 앱이 죽지 않고 계속 실행 ② 로그에 치명적 오류(FATAL, UnsatisfiedLinkError) 없음
#       ③ 제공자 호출이 셸(비서 앱이 아닌 호출자)에게는 forbidden ④ DB 파일이 만들어지고 스키마(user_version 2)·무결성·저널 모드가 맞음
set -u
PKG=com.hwetj.routinelog
APK=android/app/build/outputs/apk/release/app-release.apk
fail=0
check() { if [ "$2" = "ok" ]; then echo "PASS $1"; else echo "FAIL $1 :: $3"; fail=1; fi; }

adb install -r "$APK" >/dev/null 2>&1 || { echo "FAIL install"; exit 1; }
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 40

# ① 실행 유지
if adb shell pidof "$PKG" >/dev/null 2>&1; then check "앱이 실행 중" ok; else check "앱이 실행 중" fail "프로세스 없음"; fi

# ② 치명적 오류
adb logcat -d > /tmp/logcat.txt
if grep -E "FATAL EXCEPTION|UnsatisfiedLinkError|VerifyError|Process: $PKG.*crash" /tmp/logcat.txt >/dev/null; then
  check "치명적 오류 없음" fail "$(grep -E 'FATAL EXCEPTION|UnsatisfiedLinkError|VerifyError' /tmp/logcat.txt | head -3)"
else check "치명적 오류 없음" ok; fi

# ③ 제공자 호출자 검사 (셸 uid 는 com.hwetj.assistant 가 아니므로 forbidden)
out=$(adb shell content call --uri content://com.hwetj.routinelog.assistant --method ping 2>&1)
echo "ping: $out"
if echo "$out" | grep -q "forbidden"; then check "제공자 등록·호출자 검사(ping=forbidden)" ok; else check "제공자 등록·호출자 검사" fail "$out"; fi
out=$(adb shell content call --uri content://com.hwetj.routinelog.assistant --method query --arg '{}' 2>&1)
if echo "$out" | grep -q "forbidden"; then check "제공자 query 도 forbidden" ok; else check "제공자 query 도 forbidden" fail "$out"; fi

# ④ DB 파일 (google_apis 이미지는 adb root 가능)
adb root >/dev/null 2>&1; sleep 4
DIR=/data/data/$PKG/files/SQLite
adb shell "ls -la $DIR" || true
mkdir -p /tmp/dbcheck && rm -f /tmp/dbcheck/*
for f in routinelog.db routinelog.db-wal routinelog.db-shm routinelog.db-journal; do adb pull "$DIR/$f" /tmp/dbcheck/ >/dev/null 2>&1 || true; done
ls -la /tmp/dbcheck
python3 - <<'PY'
import os, sqlite3, sys
p = '/tmp/dbcheck/routinelog.db'
if not os.path.exists(p):
    print('FAIL DB 파일 생성 :: 없음'); sys.exit(1)
try:
    c = sqlite3.connect(p)
    uv = c.execute('PRAGMA user_version').fetchone()[0]
    qc = c.execute('PRAGMA quick_check').fetchone()[0]
    jm = c.execute('PRAGMA journal_mode').fetchone()[0]
    tables = sorted(r[0] for r in c.execute("select name from sqlite_master where type='table'"))
    idx = c.execute("select sql from sqlite_master where name='logs_slot'").fetchone()
except Exception as e:
    print('FAIL DB 열기 ::', e); sys.exit(1)
ok = True
def chk(name, cond, detail=''):
    global ok
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else ' :: ' + str(detail)))
    ok = ok and cond
chk('user_version == 2', uv == 2, uv)
chk('quick_check == ok', qc == 'ok', qc)
chk('저널 모드가 WAL 이 아님(단일 연결)', jm.lower() != 'wal', jm)
chk('테이블 생성', {'routines', 'routine_times', 'logs', 'kv'} <= set(tables), tables)
chk('logs_slot 부분 인덱스', bool(idx) and 'WHERE slot IS NOT NULL' in idx[0], idx)
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] || fail=1
echo "RESULT fail=$fail"
exit $fail
