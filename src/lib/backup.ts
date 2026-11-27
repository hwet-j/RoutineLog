import { isDate, isTime } from './dates';
import type { Log, Routine, RoutineTime, Snapshot } from './types';

export const BACKUP_APP = 'routinelog';
export const BACKUP_VERSION = 1;

export interface Backup extends Snapshot {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
}

export function makeBackup(s: Snapshot, now: Date = new Date()): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), routines: s.routines, times: s.times, logs: s.logs };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, what: string, max = 500): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${what} 가 올바르지 않아요`);
  return v;
};
const optStr = (v: unknown, what: string, max = 500): string | null => (v == null || v === '' ? null : str(v, what, max));
const int = (v: unknown, what: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${what} 가 올바르지 않아요`);
  return v;
};
const optInt = (v: unknown, what: string, min: number, max: number) => (v == null ? null : int(v, what, min, max));

/** 백업 텍스트를 검증해서 돌려준다. 하나라도 어긋나면 예외 (복원은 전부 아니면 전무) */
export function parseBackup(text: string): Backup {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('백업 파일을 읽을 수 없어요 (JSON 형식이 아니에요)');
  }
  if (!isObj(j) || j.app !== BACKUP_APP) throw new Error('RoutineLog 백업 파일이 아니에요');
  if (typeof j.version !== 'number' || j.version > BACKUP_VERSION) throw new Error('더 새로운 버전의 백업이에요. 앱을 업데이트해 주세요');
  if (!Array.isArray(j.routines) || !Array.isArray(j.times) || !Array.isArray(j.logs)) throw new Error('백업 내용이 올바르지 않아요');
  if (j.routines.length > 2000 || j.times.length > 20000 || j.logs.length > 500000) throw new Error('백업이 너무 커요');

  const ids = new Set<string>();
  const routines: Routine[] = j.routines.map((x, i) => {
    if (!isObj(x)) throw new Error(`루틴 ${i + 1} 이 올바르지 않아요`);
    const id = str(x.id, '루틴 id', 80);
    if (ids.has(id)) throw new Error('루틴 id 가 중복돼요');
    ids.add(id);
    const kind = x.kind;
    if (kind !== 'medication' && kind !== 'supplement' && kind !== 'habit') throw new Error('루틴 종류가 올바르지 않아요');
    const schedule = x.schedule;
    if (schedule !== 'daily' && schedule !== 'weekdays' && schedule !== 'interval' && schedule !== 'weekly_count') throw new Error('루틴 스케줄이 올바르지 않아요');
    const ns = x.notify_style ?? null;
    if (ns !== null && ns !== 'sound' && ns !== 'vibrate' && ns !== 'silent') throw new Error('알림 방식이 올바르지 않아요');
    if (!isDate(x.start_date) || (x.end_date != null && !isDate(x.end_date))) throw new Error('루틴 날짜가 올바르지 않아요');
    return {
      id, name: str(x.name, '루틴 이름', 100), kind, detail: optStr(x.detail, '상세', 300), color: optStr(x.color, '색', 20), icon: optStr(x.icon, '아이콘', 16),
      schedule, weekdays: int(x.weekdays ?? 127, '요일', 0, 127), interval_days: optInt(x.interval_days, '간격', 1, 365), weekly_count: optInt(x.weekly_count, '주 횟수', 1, 7),
      start_date: x.start_date, end_date: (x.end_date as string | null | undefined) ?? null, daily_target: int(x.daily_target ?? 1, '하루 목표', 1, 1000), unit: optStr(x.unit, '단위', 20),
      reminder: int(x.reminder ?? 1, '알림', 0, 1), nag_minutes: optInt(x.nag_minutes, '재알림', 1, 720), notify_style: ns,
      archived: int(x.archived ?? 0, '보관', 0, 1), sort: int(x.sort ?? 0, '순서', -1_000_000, 1_000_000), created_at: str(x.created_at, '생성 시각', 40),
    };
  });
  const tids = new Set<string>();
  const times: RoutineTime[] = j.times.map((x, i) => {
    if (!isObj(x)) throw new Error(`시각 ${i + 1} 이 올바르지 않아요`);
    const id = str(x.id, '시각 id', 80);
    if (tids.has(id)) throw new Error('시각 id 가 중복돼요');
    tids.add(id);
    const routine_id = str(x.routine_id, '루틴 id', 80);
    if (!ids.has(routine_id)) throw new Error('존재하지 않는 루틴의 시각이 있어요');
    if (!isTime(x.time)) throw new Error('시각 형식이 올바르지 않아요');
    return { id, routine_id, time: x.time, label: optStr(x.label, '라벨', 30) };
  });
  const lids = new Set<string>();
  const refs = new Set<string>();
  const slots = new Set<string>();
  const logs: Log[] = j.logs.map((x, i) => {
    if (!isObj(x)) throw new Error(`기록 ${i + 1} 이 올바르지 않아요`);
    const id = str(x.id, '기록 id', 80);
    if (lids.has(id)) throw new Error('기록 id 가 중복돼요');
    lids.add(id);
    const routine_id = str(x.routine_id, '루틴 id', 80);
    if (!ids.has(routine_id)) throw new Error('존재하지 않는 루틴의 기록이 있어요');
    if (!isDate(x.date)) throw new Error('기록 날짜가 올바르지 않아요');
    if (x.slot != null && !isTime(x.slot)) throw new Error('기록 시각이 올바르지 않아요');
    if (x.status !== 'done' && x.status !== 'skipped') throw new Error('기록 상태가 올바르지 않아요');
    const source = x.source ?? 'app';
    if (source !== 'app' && source !== 'assistant' && source !== 'notification') throw new Error('기록 경로가 올바르지 않아요');
    const ref = optStr(x.source_ref, '참조', 100);
    if (ref) {
      if (refs.has(ref)) throw new Error('기록 참조가 중복돼요');
      refs.add(ref);
    }
    if (x.slot != null) {
      const k = `${routine_id}|${x.date}|${x.slot}`;
      if (slots.has(k)) throw new Error('같은 루틴·날짜·시각의 기록이 중복돼요');
      slots.add(k);
    }
    if (x.value != null && (typeof x.value !== 'number' || !Number.isFinite(x.value))) throw new Error('기록 값이 올바르지 않아요');
    return {
      id, routine_id, date: x.date, slot: (x.slot as string | null | undefined) ?? null, status: x.status, count: int(x.count ?? 1, '횟수', 0, 100000),
      value: (x.value as number | null | undefined) ?? null, note: optStr(x.note, '메모', 1000), logged_at: str(x.logged_at, '체크 시각', 40), source, source_ref: ref,
    };
  });
  return { app: BACKUP_APP, version: j.version, exportedAt: typeof j.exportedAt === 'string' ? j.exportedAt : '', routines, times, logs };
}
