import * as SQLite from 'expo-sqlite';

import { PRAGMAS, SCHEMA_V1, SCHEMA_VERSION } from './schema';

export const DB_NAME = 'routinelog.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 단일 DB 핸들. 최초 호출 시 PRAGMA·스키마·마이그레이션 (비서 제공자도 같은 파일을 연다) */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(PRAGMAS);
      await migrate(db);
      return db;
    })();
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V1);
    });
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}
