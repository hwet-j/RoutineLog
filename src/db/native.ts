/**
 * 네이티브 SQLite 래퍼 (modules/assistant-share 의 RoutineDbModule).
 *
 * expo-sqlite 를 쓰지 않는 이유: 비서 연동 제공자(Kotlin)가 같은 DB 파일을 열기 때문에, 한 프로세스에서 SQLite 라이브러리가 둘이면
 * 잠금이 서로 풀려 "database disk image is malformed" 로 손상된다. 앱 JS 와 제공자는 이 모듈이 가진 연결 하나를 같이 쓴다.
 * expo-sqlite 의 SQLiteDatabase 와 같은 모양의 메서드(execAsync/runAsync/getAllAsync/getFirstAsync/with*TransactionAsync)만 제공한다.
 */
export type Bind = string | number | boolean | null | undefined;

export interface NativeDb {
  open(): Promise<{ recovered: string | null }>;
  exec(sql: string): Promise<void>;
  run(sql: string, params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAll(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  txBegin(): Promise<string>;
  txExec(token: string, sql: string): Promise<void>;
  txRun(token: string, sql: string, params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  txGetAll(token: string, sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  txEnd(token: string, commit: boolean): Promise<void>;
  listCorrupt(): Promise<{ name: string; bytes: number }[]>;
  deleteCorrupt(name: string): Promise<boolean>;
}

/** 여러 문장으로 된 SQL 을 문장 단위로 쪼갠다 (문자열·따옴표 식별자·주석 안의 `;` 는 무시). 트리거(BEGIN…END)는 지원하지 않는다 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 바인딩 값을 네이티브가 받을 수 있는 형태로 (undefined → null, boolean → 0/1) */
export function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return flat.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

const GONE = /이미 끝났어요|transaction/i;

export class Database {
  /** 진행 중인 트랜잭션 토큰. 트랜잭션이 열려 있는 동안 이 객체로 하는 호출은 모두 그 트랜잭션에 합류한다 (expo-sqlite 의 withTransactionAsync 와 같은 동작) */
  private token: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly native: NativeDb) {}

  private async viaToken<T>(withTx: (t: string) => Promise<T>, plain: () => Promise<T>): Promise<T> {
    const t = this.token;
    if (!t) return plain();
    try {
      return await withTx(t);
    } catch (e) {
      // 막 끝난 트랜잭션에 합류하려다 실패한 경우(드문 경합): 트랜잭션 밖에서 다시 시도
      if (this.token !== t && GONE.test(e instanceof Error ? e.message : String(e))) return plain();
      throw e;
    }
  }

  async execAsync(source: string): Promise<void> {
    for (const st of splitStatements(source)) {
      await this.viaToken((t) => this.native.txExec(t, st), () => this.native.exec(st));
    }
  }

  runAsync(source: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    const p = normalizeParams(params);
    return this.viaToken((t) => this.native.txRun(t, source, p), () => this.native.run(source, p));
  }

  getAllAsync<T = Record<string, unknown>>(source: string, ...params: unknown[]): Promise<T[]> {
    const p = normalizeParams(params);
    return this.viaToken((t) => this.native.txGetAll(t, source, p), () => this.native.getAll(source, p)) as Promise<T[]>;
  }

  async getFirstAsync<T = Record<string, unknown>>(source: string, ...params: unknown[]): Promise<T | null> {
    const rows = await this.getAllAsync<T>(source, ...params);
    return rows[0] ?? null;
  }

  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return this.transaction(() => task());
  }

  withExclusiveTransactionAsync(task: (tx: Database) => Promise<void>): Promise<void> {
    return this.transaction(() => task(this));
  }

  private transaction(fn: () => Promise<void>): Promise<void> {
    // 이미 열린 트랜잭션 안에서의 호출은 그 트랜잭션에 합류 (기다리면 자기 자신을 기다리게 된다)
    if (this.token) return fn();
    const run = async () => {
      const token = await this.native.txBegin();
      this.token = token;
      try {
        await fn();
        await this.native.txEnd(token, true);
      } catch (e) {
        await this.native.txEnd(token, false).catch(() => {});
        throw e;
      } finally {
        this.token = null;
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}
