import type { SQLiteDatabase } from 'expo-sqlite';

import { uid } from '../lib/id';
import type { Backup } from '../lib/backup';
import type { Log, LogSource, LogStatus, Routine, RoutineTime, Snapshot } from '../lib/types';
import { addDays } from '../lib/dates';

export async function kvGet(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return r?.value ?? null;
}
export async function kvSet(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync('INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)', key, value);
}

/** 화면이 쓰는 전체 데이터. 기록은 최근 400일만 메모리에 올린다 (그 이전은 listLogs 로 따로 조회) */
export async function loadAll(db: SQLiteDatabase, today: string): Promise<Snapshot> {
  const since = addDays(today, -400);
  const [routines, times, logs] = await Promise.all([
    db.getAllAsync<Routine>('SELECT * FROM routines ORDER BY archived, sort, name'),
    db.getAllAsync<RoutineTime>('SELECT * FROM routine_times ORDER BY time'),
    db.getAllAsync<Log>('SELECT * FROM logs WHERE date >= ? ORDER BY date DESC, logged_at DESC', since),
  ]);
  return { routines, times, logs };
}

export type RoutineInput = Omit<Routine, 'id' | 'created_at' | 'sort' | 'archived'> & Partial<Pick<Routine, 'sort' | 'archived'>>;
export type TimeInput = { time: string; label: string | null };

const R_COLS = ['name', 'kind', 'detail', 'color', 'icon', 'schedule', 'weekdays', 'interval_days', 'weekly_count', 'start_date', 'end_date', 'daily_target', 'unit', 'reminder', 'nag_minutes', 'notify_style'] as const;

async function writeTimes(db: SQLiteDatabase, routineId: string, times: TimeInput[]) {
  await db.runAsync('DELETE FROM routine_times WHERE routine_id = ?', routineId);
  const seen = new Set<string>();
  for (const t of times) {
    if (seen.has(t.time)) continue;
    seen.add(t.time);
    await db.runAsync('INSERT INTO routine_times(id, routine_id, time, label) VALUES(?,?,?,?)', uid('t'), routineId, t.time, t.label);
  }
}

export async function insertRoutine(db: SQLiteDatabase, r: RoutineInput, times: TimeInput[], now: Date = new Date()): Promise<string> {
  const id = uid('r');
  await db.withTransactionAsync(async () => {
    const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort) AS m FROM routines');
    await db.runAsync(
      `INSERT INTO routines(id, ${R_COLS.join(', ')}, archived, sort, created_at) VALUES(?, ${R_COLS.map(() => '?').join(', ')}, ?, ?, ?)`,
      id, ...R_COLS.map((c) => r[c] as never), r.archived ?? 0, r.sort ?? (max?.m ?? 0) + 1, now.toISOString(),
    );
    await writeTimes(db, id, times);
  });
  return id;
}

export async function updateRoutine(db: SQLiteDatabase, id: string, r: RoutineInput, times: TimeInput[]) {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE routines SET ${R_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...R_COLS.map((c) => r[c] as never), id);
    await writeTimes(db, id, times);
  });
}

export async function setArchived(db: SQLiteDatabase, id: string, archived: boolean) {
  await db.runAsync('UPDATE routines SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
}

/** 루틴과 그 시각·기록을 모두 지운다 (되돌리기용 스냅샷은 호출 쪽에서 만든다) */
export async function deleteRoutine(db: SQLiteDatabase, id: string) {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM logs WHERE routine_id = ?', id);
    await db.runAsync('DELETE FROM routine_times WHERE routine_id = ?', id);
    await db.runAsync('DELETE FROM routines WHERE id = ?', id);
  });
}

/** 루틴을 복제 (이름 뒤에 "(복사)", 기록은 복제하지 않음) */
export async function duplicateRoutine(db: SQLiteDatabase, r: Routine, times: RoutineTime[], now: Date = new Date()) {
  const { id: _id, created_at: _c, sort: _s, archived: _a, ...rest } = r;
  return insertRoutine(db, { ...rest, name: `${r.name} (복사)` }, times.filter((t) => t.routine_id === r.id).map((t) => ({ time: t.time, label: t.label })), now);
}

export interface LogInput {
  routine_id: string;
  date: string;
  slot: string | null;
  status: LogStatus;
  count?: number;
  value?: number | null;
  note?: string | null;
  source?: LogSource;
  source_ref?: string | null;
  logged_at?: string;
}

/** 로그 한 건 추가. 복약 슬롯이 이미 체크돼 있으면(unique) 그 로그를 갱신한다 */
export async function upsertLog(db: SQLiteDatabase, l: LogInput, now: Date = new Date()): Promise<string> {
  const loggedAt = l.logged_at ?? now.toISOString();
  if (l.slot !== null) {
    const ex = await db.getFirstAsync<{ id: string }>('SELECT id FROM logs WHERE routine_id = ? AND date = ? AND slot = ?', l.routine_id, l.date, l.slot);
    if (ex) {
      await db.runAsync('UPDATE logs SET status = ?, count = ?, value = ?, note = ?, logged_at = ?, source = ? WHERE id = ?', l.status, l.count ?? 1, l.value ?? null, l.note ?? null, loggedAt, l.source ?? 'app', ex.id);
      return ex.id;
    }
  }
  const id = uid('l');
  await db.runAsync(
    'INSERT INTO logs(id, routine_id, date, slot, status, count, value, note, logged_at, source, source_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, l.routine_id, l.date, l.slot, l.status, l.count ?? 1, l.value ?? null, l.note ?? null, loggedAt, l.source ?? 'app', l.source_ref ?? null,
  );
  return id;
}

export async function updateLog(db: SQLiteDatabase, id: string, patch: Partial<Pick<Log, 'status' | 'count' | 'value' | 'note' | 'logged_at' | 'date'>>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  await db.runAsync(`UPDATE logs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k] as never), id);
}

export async function deleteLog(db: SQLiteDatabase, id: string) {
  await db.runAsync('DELETE FROM logs WHERE id = ?', id);
}

export async function restoreLog(db: SQLiteDatabase, l: Log) {
  await db.runAsync(
    'INSERT OR REPLACE INTO logs(id, routine_id, date, slot, status, count, value, note, logged_at, source, source_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    l.id, l.routine_id, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source, l.source_ref,
  );
}

export interface LogQuery {
  from?: string;
  to?: string;
  routineId?: string;
  text?: string;
  limit?: number;
}

/** 기록 화면용 조회 (기간·루틴·메모 검색) */
export async function listLogs(db: SQLiteDatabase, q: LogQuery): Promise<Log[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.from) { where.push('date >= ?'); args.push(q.from); }
  if (q.to) { where.push('date <= ?'); args.push(q.to); }
  if (q.routineId) { where.push('routine_id = ?'); args.push(q.routineId); }
  if (q.text) {
    where.push("(note LIKE ? ESCAPE '\\' OR routine_id IN (SELECT id FROM routines WHERE name LIKE ? ESCAPE '\\'))");
    const like = `%${q.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like);
  }
  return db.getAllAsync<Log>(`SELECT * FROM logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, logged_at DESC LIMIT ?`, ...args, q.limit ?? 500);
}

export async function allLogs(db: SQLiteDatabase): Promise<Log[]> {
  return db.getAllAsync<Log>('SELECT * FROM logs ORDER BY date, logged_at');
}

/** 백업 복원: 한 트랜잭션에서 전부 지우고 다시 넣는다 (중간에 실패하면 원래대로) */
export async function restoreBackup(db: SQLiteDatabase, b: Backup) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM logs');
    await tx.runAsync('DELETE FROM routine_times');
    await tx.runAsync('DELETE FROM routines');
    for (const r of b.routines) {
      await tx.runAsync(
        `INSERT INTO routines(id, ${R_COLS.join(', ')}, archived, sort, created_at) VALUES(?, ${R_COLS.map(() => '?').join(', ')}, ?, ?, ?)`,
        r.id, ...R_COLS.map((c) => r[c] as never), r.archived, r.sort, r.created_at,
      );
    }
    for (const t of b.times) await tx.runAsync('INSERT INTO routine_times(id, routine_id, time, label) VALUES(?,?,?,?)', t.id, t.routine_id, t.time, t.label);
    for (const l of b.logs) {
      await tx.runAsync(
        'INSERT INTO logs(id, routine_id, date, slot, status, count, value, note, logged_at, source, source_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        l.id, l.routine_id, l.date, l.slot, l.status, l.count, l.value, l.note, l.logged_at, l.source, l.source_ref,
      );
    }
  });
}

export async function wipeAll(db: SQLiteDatabase) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM logs');
    await tx.runAsync('DELETE FROM routine_times');
    await tx.runAsync('DELETE FROM routines');
  });
}
