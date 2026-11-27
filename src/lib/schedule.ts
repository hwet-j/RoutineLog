import { addDays, at, dayDiff, toMin, weekdayBit, weekStart } from './dates';
import type { Log, Routine, RoutineTime } from './types';

export const ALL_DAYS = 127;
export const bitsToDays = (bits: number): number[] => [0, 1, 2, 3, 4, 5, 6].filter((i) => bits & (1 << i));
export const daysToBits = (days: number[]) => days.reduce((b, i) => b | (1 << i), 0);

/** 그 날짜에 루틴이 "해당"되는지. weekly_count(주 N회)는 요일을 정하지 않아 기간 안의 모든 날이 후보(optional) */
export function isActiveOn(r: Routine, date: string): boolean {
  if (date < r.start_date) return false;
  if (r.end_date && date > r.end_date) return false;
  return true;
}

export function isDueOn(r: Routine, date: string): boolean {
  if (!isActiveOn(r, date)) return false;
  switch (r.schedule) {
    case 'daily':
      return true;
    case 'weekdays':
      return (r.weekdays & weekdayBit(date)) !== 0;
    case 'interval': {
      const n = r.interval_days && r.interval_days > 0 ? r.interval_days : 1;
      return dayDiff(r.start_date, date) % n === 0;
    }
    case 'weekly_count':
      return true;
  }
}

export type SlotStatus = 'done' | 'skipped' | 'pending' | 'overdue';

export interface PlanEntry {
  routine: Routine;
  /** 복약·시각 있는 루틴의 슬롯. 시각이 없으면 null */
  slot: string | null;
  label: string | null;
  /** 습관의 하루 횟수 목표 (복약 슬롯은 1) */
  target: number;
  /** 오늘 체크한 횟수(done 로그의 count 합) */
  count: number;
  status: SlotStatus;
  logs: Log[];
  /** weekly_count 루틴: 후보일(요일 무관) */
  optional: boolean;
}

const sortKey = (e: PlanEntry) => (e.slot ? toMin(e.slot) : 24 * 60 + 1);

/**
 * 하루 계획: 그 날 해야 할 슬롯/횟수와 상태.
 * - 복약·영양제: 시각마다 슬롯 하나(시각이 하나도 없으면 시각 없는 슬롯 하나). 하루 1건만 체크 가능
 * - 습관: 시각이 있으면 각 시각이 알림 시각일 뿐 슬롯이 아니고, 하루 daily_target 횟수를 채우면 done
 * - overdue: 지난 날의 미체크, 또는 오늘 슬롯 시각이 지난 미체크
 * - weekly_count(주 N회) 습관: 하루 단위로는 "오늘 했는지"만 보고, optional 로 표시
 */
export function dayPlan(routines: Routine[], times: RoutineTime[], logs: Log[], date: string, today: string, nowHHMM: string): PlanEntry[] {
  const out: PlanEntry[] = [];
  for (const r of routines) {
    if (!isDueOn(r, date)) continue;
    const rl = logs.filter((l) => l.routine_id === r.id && l.date === date);
    const ts = times.filter((t) => t.routine_id === r.id).sort((a, b) => a.time.localeCompare(b.time));
    const past = date < today;
    if (r.kind === 'habit') {
      const doneCount = rl.filter((l) => l.status === 'done').reduce((s, l) => s + l.count, 0);
      const skipped = rl.some((l) => l.status === 'skipped') && doneCount === 0;
      const target = r.schedule === 'weekly_count' ? 1 : Math.max(1, r.daily_target);
      const firstTime = ts[0]?.time ?? null;
      const status: SlotStatus = doneCount >= target ? 'done' : skipped ? 'skipped' : past || (date === today && firstTime !== null && toMin(nowHHMM) >= toMin(firstTime)) ? 'overdue' : 'pending';
      out.push({ routine: r, slot: firstTime, label: ts[0]?.label ?? null, target, count: doneCount, status, logs: rl, optional: r.schedule === 'weekly_count' });
      continue;
    }
    const slots: { slot: string | null; label: string | null }[] = ts.length ? ts.map((t) => ({ slot: t.time, label: t.label })) : [{ slot: null, label: null }];
    for (const s of slots) {
      const l = rl.filter((x) => (x.slot ?? null) === s.slot);
      const done = l.find((x) => x.status === 'done');
      const skip = l.find((x) => x.status === 'skipped');
      const status: SlotStatus = done ? 'done' : skip ? 'skipped' : past || (date === today && s.slot !== null && toMin(nowHHMM) >= toMin(s.slot)) ? 'overdue' : 'pending';
      out.push({ routine: r, slot: s.slot, label: s.label, target: 1, count: done ? 1 : 0, status, logs: l, optional: false });
    }
  }
  return out.sort((a, b) => sortKey(a) - sortKey(b) || a.routine.sort - b.routine.sort || a.routine.name.localeCompare(b.routine.name, 'ko'));
}

export interface Progress {
  total: number;
  done: number;
  skipped: number;
  /** 0~1. 건너뛴 항목은 분모에서 뺀다. 분모가 0 이면 1 */
  ratio: number;
}
export function progress(plan: PlanEntry[]): Progress {
  const required = plan.filter((e) => !e.optional);
  const skipped = required.filter((e) => e.status === 'skipped').length;
  const done = required.filter((e) => e.status === 'done').length;
  const total = required.length;
  const denom = total - skipped;
  return { total, done, skipped, ratio: denom <= 0 ? 1 : done / denom };
}

/** weekly_count: date 가 속한 주(월~일)에 done 이 있었던 서로 다른 날 수 */
export function weekDoneDays(r: Routine, logs: Log[], date: string): number {
  const ws = weekStart(date), we = addDays(ws, 6);
  const days = new Set<string>();
  for (const l of logs) if (l.routine_id === r.id && l.status === 'done' && l.date >= ws && l.date <= we) days.add(l.date);
  return days.size;
}

/** 아직 먹지 않은 복약 슬롯 중 비서가 `slot` 을 생략했을 때 고를 슬롯: 지난 것 중 현재에 가장 가까운 것 → 없으면 가장 이른 미체크 */
export function pickSlot(slots: string[], doneSlots: Set<string>, nowHHMM: string): string | null {
  const pending = slots.filter((s) => !doneSlots.has(s)).sort();
  if (!pending.length) return null;
  const now = toMin(nowHHMM);
  const past = pending.filter((s) => toMin(s) <= now);
  return past.length ? past[past.length - 1] : pending[0];
}

export const slotInstant = (date: string, slot: string) => at(date, slot);

const KO = ['월', '화', '수', '목', '금', '토', '일'];
/** 루틴 목록용 한 줄 요약: "매일 · 오전 8:00, 오후 9:00" */
export function scheduleText(r: Routine, times: RoutineTime[]): string {
  const when =
    r.schedule === 'daily' ? '매일'
    : r.schedule === 'weekdays' ? (r.weekdays === 127 ? '매일' : r.weekdays === 31 ? '평일' : r.weekdays === 96 ? '주말' : bitsToDays(r.weekdays).map((i) => KO[i]).join('·'))
    : r.schedule === 'interval' ? `${r.interval_days ?? 1}일마다`
    : `주 ${r.weekly_count ?? 1}회`;
  const tm = times.filter((x) => x.routine_id === r.id).map((x) => x.time).sort();
  const tail = r.kind === 'habit' && r.schedule !== 'weekly_count' && r.daily_target > 1 ? `하루 ${r.daily_target}번` : tm.length ? tm.join(', ') : '';
  return tail ? `${when} · ${tail}` : when;
}
