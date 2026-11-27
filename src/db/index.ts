import { requireNativeModule } from 'expo';

import { Database, type NativeDb } from './native';
import { MIGRATE_V2, SCHEMA_V1, SCHEMA_VERSION } from './schema';

export const DB_NAME = 'routinelog.db';
export type { Database } from './native';

// 앱 JS 와 비서 제공자가 같은 연결을 쓰는 네이티브 모듈 (expo-sqlite 는 쓰지 않는다 — native.ts 참고)
const native = requireNativeModule<NativeDb>('RoutineDb');

let dbPromise: Promise<Database> | null = null;
let recovered: string | null = null;

/** 단일 DB 핸들. 최초 호출 시 열기(손상 검사)·스키마·마이그레이션 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const info = await native.open();
      if (info.recovered) recovered = info.recovered;
      const db = new Database(native);
      await migrate(db);
      return db;
    })();
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** 이번 실행에서 손상된 DB 를 치우고 새로 시작했다면, 보존된 파일 이름 (아니면 null) */
export const getRecovery = () => recovered;
export const listCorruptFiles = () => native.listCorrupt();
export const deleteCorruptFile = (name: string) => native.deleteCorrupt(name);

async function migrate(db: Database) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V1);
    });
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } else if (v < 2) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(MIGRATE_V2);
    });
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}
