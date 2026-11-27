import { Database, normalizeParams, splitStatements, type NativeDb } from '../src/db/native';
import { MIGRATE_V2, SCHEMA_V1 } from '../src/db/schema';

describe('splitStatements', () => {
  test('세미콜론으로 나누고 빈 문장은 버린다', () => {
    expect(splitStatements('A; B;; C ;')).toEqual(['A', 'B', 'C']);
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('  \n ')).toEqual([]);
  });
  test('문자열·따옴표 식별자 안의 ; 는 무시, 이스케이프된 따옴표', () => {
    expect(splitStatements("INSERT INTO t VALUES('a;b'); INSERT INTO t VALUES('it''s;ok')")).toEqual(["INSERT INTO t VALUES('a;b')", "INSERT INTO t VALUES('it''s;ok')"]);
    expect(splitStatements('SELECT "a;b"; SELECT `c;d`')).toEqual(['SELECT "a;b"', 'SELECT `c;d`']);
  });
  test('주석 안의 ; 는 무시', () => {
    expect(splitStatements('A; -- 주석; 안\nB; /* x; y */ C')).toEqual(['A', 'B', 'C']);
  });
  test('실제 스키마: 모든 문장이 CREATE 이고 마지막 문장이 잘리지 않는다', () => {
    const s = splitStatements(SCHEMA_V1);
    expect(s.length).toBe(8);
    expect(s.every((x) => /^CREATE /.test(x))).toBe(true);
    expect(s.some((x) => x.includes('logs_slot') && x.includes('WHERE slot IS NOT NULL'))).toBe(true);
    expect(s[s.length - 1]).toMatch(/kv\(key TEXT PRIMARY KEY, value TEXT NOT NULL\)$/);
    expect(splitStatements(MIGRATE_V2)).toHaveLength(2);
  });
});

describe('normalizeParams', () => {
  test('undefined → null, boolean → 0/1, 배열 하나는 펼침', () => {
    expect(normalizeParams(['a', undefined, true, false, 3, null])).toEqual(['a', null, 1, 0, 3, null]);
    expect(normalizeParams([['x', 1]])).toEqual(['x', 1]);
    expect(normalizeParams([])).toEqual([]);
  });
});

/** 호출 기록을 남기는 가짜 네이티브. 트랜잭션 토큰과 직렬화를 검증한다 */
function fake(opts: { failCommit?: boolean } = {}) {
  const calls: string[] = [];
  let open: string | null = null;
  let seq = 0;
  const native: NativeDb = {
    open: async () => ({ recovered: null }),
    exec: async (sql) => { calls.push(`exec:${sql}`); },
    run: async (sql) => { calls.push(`run:${sql}`); return { changes: 1, lastInsertRowId: 7 }; },
    getAll: async (sql) => { calls.push(`all:${sql}`); return [{ n: 1 }, { n: 2 }]; },
    txBegin: async () => {
      if (open) throw new Error('이미 트랜잭션 중');
      open = `t${++seq}`;
      calls.push(`begin:${open}`);
      return open;
    },
    txExec: async (t, sql) => { calls.push(`txexec:${t}:${sql}`); },
    txRun: async (t, sql) => { calls.push(`txrun:${t}:${sql}`); return { changes: 1, lastInsertRowId: 1 }; },
    txGetAll: async (t, sql) => { calls.push(`txall:${t}:${sql}`); return [{ n: 1 }]; },
    txEnd: async (t, commit) => {
      if (t !== open) throw new Error('트랜잭션이 이미 끝났어요');
      calls.push(`end:${t}:${commit ? 'commit' : 'rollback'}`);
      open = null;
      if (commit && opts.failCommit) throw new Error('commit 실패');
    },
    listCorrupt: async () => [],
    deleteCorrupt: async () => true,
  };
  return { native, calls };
}

describe('Database (네이티브 래퍼)', () => {
  test('트랜잭션 밖의 호출은 일반 경로', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    expect(await db.runAsync('INSERT x', 1, 'a')).toEqual({ changes: 1, lastInsertRowId: 7 });
    expect(await db.getFirstAsync('SELECT x')).toEqual({ n: 1 });
    expect(await db.getAllAsync('SELECT y')).toHaveLength(2);
    await db.execAsync('A; B');
    expect(calls).toEqual(['run:INSERT x', 'all:SELECT x', 'all:SELECT y', 'exec:A', 'exec:B']);
  });

  test('getFirstAsync 는 결과가 없으면 null', async () => {
    const { native } = fake();
    native.getAll = async () => [];
    expect(await new Database(native).getFirstAsync('SELECT')).toBeNull();
  });

  test('withTransactionAsync: 안의 db 호출은 모두 같은 트랜잭션, 끝나면 commit', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    await db.withTransactionAsync(async () => {
      await db.runAsync('W1');
      await db.getAllAsync('R1');
    });
    await db.runAsync('AFTER');
    expect(calls).toEqual(['begin:t1', 'txrun:t1:W1', 'txall:t1:R1', 'end:t1:commit', 'run:AFTER']);
  });

  test('withExclusiveTransactionAsync: tx 객체로 하는 호출도 같은 트랜잭션', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync('CREATE a; CREATE b');
      await tx.runAsync('INS', 1);
    });
    expect(calls).toEqual(['begin:t1', 'txexec:t1:CREATE a', 'txexec:t1:CREATE b', 'txrun:t1:INS', 'end:t1:commit']);
  });

  test('콜백이 예외를 던지면 rollback 하고 다시 던진다, 이후 트랜잭션은 정상', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    await expect(db.withTransactionAsync(async () => { await db.runAsync('W'); throw new Error('boom'); })).rejects.toThrow('boom');
    await db.withTransactionAsync(async () => { await db.runAsync('W2'); });
    expect(calls).toEqual(['begin:t1', 'txrun:t1:W', 'end:t1:rollback', 'begin:t2', 'txrun:t2:W2', 'end:t2:commit']);
  });

  test('commit 이 실패하면 rollback 을 시도하고 오류를 전달, 토큰은 해제', async () => {
    const { native } = fake({ failCommit: true });
    const db = new Database(native);
    await expect(db.withTransactionAsync(async () => { await db.runAsync('W'); })).rejects.toThrow('commit 실패');
    native.txBegin = async () => 'tz';
    native.txEnd = async () => {};
    await db.withTransactionAsync(async () => {});
  });

  test('동시에 시작한 두 트랜잭션은 겹치지 않고 차례로 실행', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    const a = db.withTransactionAsync(async () => { await db.runAsync('A1'); await new Promise((r) => setTimeout(r, 10)); await db.runAsync('A2'); });
    const b = db.withTransactionAsync(async () => { await db.runAsync('B1'); });
    await Promise.all([a, b]);
    expect(calls).toEqual(['begin:t1', 'txrun:t1:A1', 'txrun:t1:A2', 'end:t1:commit', 'begin:t2', 'txrun:t2:B1', 'end:t2:commit']);
  });

  test('중첩 호출은 바깥 트랜잭션에 합류 (자기 자신을 기다리다 멈추지 않는다)', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    await db.withTransactionAsync(async () => {
      await db.withExclusiveTransactionAsync(async (tx) => { await tx.runAsync('INNER'); });
      await db.runAsync('OUTER');
    });
    expect(calls).toEqual(['begin:t1', 'txrun:t1:INNER', 'txrun:t1:OUTER', 'end:t1:commit']);
  });

  test('막 끝난 트랜잭션에 합류하려다 실패하면 일반 경로로 재시도', async () => {
    const { native, calls } = fake();
    const db = new Database(native);
    native.txRun = async (t) => {
      // 토큰은 JS 가 정했지만 그 사이 트랜잭션이 끝난 상황을 흉내
      (db as unknown as { token: string | null }).token = null;
      throw new Error(`트랜잭션이 이미 끝났어요 (${t})`);
    };
    (db as unknown as { token: string | null }).token = 'tOld';
    await db.runAsync('X');
    expect(calls).toEqual(['run:X']);
  });
});
