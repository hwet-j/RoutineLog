import { addDays, at, dayDiff, toMin, weekdayIndex, weekStart } from './dates';
import { dayPlan, isDueOn, progress, weekDoneDays, type PlanEntry } from './schedule';
import type { Log, Routine, RoutineTime } from './types';

const LATE_MIN = 60;

export interface Adherence {
  /** 판정 대상(아직 안 온 슬롯 제외, 건너뜀 포함) */
  scheduled: number;
  done: number;
  skipped: number;
  missed: number;
  /** 시각이 있는 완료 중 정해진 시각보다 60분 넘게 늦게 체크한 수 */
  late: number;
  timed: number;
  /** 지킨 비율 0~1 (건너뜀은 분모에서 뺌). 대상이 없으면 null */
  rate: number | null;
  lateRate: number | null;
}

const entryDone = (e: PlanEntry) => e.status === 'done';

/** 늦게 체크했는지: 로그의 실제 체크 시각이 슬롯 시각 +60분 이후 (다른 날 보충도 늦은 것) */
export function isLate(date: string, slot: string, loggedAt: string): boolean {
  const t = Date.parse(loggedAt);
  if (Number.isNaN(t)) return false;
  return t - at(date, slot).getTime() > LATE_MIN * 60_000;
}

/** [from, to] 구간의 이행률. today/now 이전(또는 지금 시각이 지난 슬롯)만 센다 */
export function adherence(r: Routine, times: RoutineTime[], logs: Log[], from: string, to: string, today: string, nowHHMM: string): Adherence {
  const mine = logs.filter((l) => l.routine_id === r.id);
  let scheduled = 0, done = 0, skipped = 0, missed = 0, late = 0, timed = 0;
  if (r.schedule === 'weekly_count') {
    const target = Math.max(1, r.weekly_count ?? 1);
    for (let ws = weekStart(from); ws <= to; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6);
      if (we > today) break; // 끝나지 않은 주는 제외
      if (we < r.start_date || (r.end_date && ws > r.end_date)) continue;
      scheduled++;
      if (weekDoneDays(r, mine, ws) >= target) done++;
      else missed++;
    }
    return { scheduled, done, skipped, missed, late, timed, rate: scheduled ? done / scheduled : null, lateRate: null };
  }
  const end = to < today ? to : today;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (!isDueOn(r, d)) continue;
    const plan = dayPlan([r], times, mine.filter((l) => l.date === d), d, today, nowHHMM);
    for (const e of plan) {
      if (e.status === 'pending') continue;
      scheduled++;
      if (e.status === 'done') {
        done++;
        if (e.slot && r.kind !== 'habit') {
          const l = e.logs.find((x) => x.status === 'done');
          if (l) {
            timed++;
            if (isLate(d, e.slot, l.logged_at)) late++;
          }
        }
      } else if (e.status === 'skipped') skipped++;
      else missed++;
    }
  }
  const denom = scheduled - skipped;
  return { scheduled, done, skipped, missed, late, timed, rate: denom > 0 ? done / denom : null, lateRate: timed > 0 ? late / timed : null };
}

/** 요일별 달성 (월~일): 최근 weeks 주 */
export function weekdayPattern(r: Routine, times: RoutineTime[], logs: Log[], today: string, nowHHMM: string, weeks = 12) {
  const out = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
  const mine = logs.filter((l) => l.routine_id === r.id);
  const from = addDays(today, -weeks * 7 + 1);
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (!isDueOn(r, d) || r.schedule === 'weekly_count') continue;
    const plan = dayPlan([r], times, mine.filter((l) => l.date === d), d, today, nowHHMM).filter((e) => e.status !== 'pending' && e.status !== 'skipped');
    if (!plan.length) continue;
    const i = weekdayIndex(d);
    out[i].due++;
    if (plan.every(entryDone)) out[i].done++;
  }
  return out;
}

export type HeatState = 'done' | 'partial' | 'missed' | 'skipped' | 'none' | 'future';
export interface HeatCell {
  date: string;
  state: HeatState;
  /** 0~1 달성 비율 (partial 색 농도용) */
  ratio: number;
}

/** 월요일 시작 주 단위 히트맵. 마지막 주는 오늘이 속한 주(일요일까지, 미래 칸은 future) */
export function heatmap(r: Routine, times: RoutineTime[], logs: Log[], today: string, nowHHMM: string, weeks = 12): HeatCell[][] {
  const mine = logs.filter((l) => l.routine_id === r.id);
  const first = addDays(weekStart(today), -(weeks - 1) * 7);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(first, w * 7 + i);
      col.push(cell(r, times, mine, date, today, nowHHMM));
    }
    cols.push(col);
  }
  return cols;
}

export function cell(r: Routine, times: RoutineTime[], mine: Log[], date: string, today: string, nowHHMM: string): HeatCell {
  if (date > today) return { date, state: 'future', ratio: 0 };
  if (r.schedule === 'weekly_count') {
    const did = mine.some((l) => l.date === date && l.status === 'done');
    return { date, state: did ? 'done' : 'none', ratio: did ? 1 : 0 };
  }
  if (!isDueOn(r, date)) {
    // 해당일이 아닌데 한 기록이 있으면 보여 준다
    const did = mine.some((l) => l.date === date && l.status === 'done');
    return { date, state: did ? 'done' : 'none', ratio: did ? 1 : 0 };
  }
  const plan = dayPlan([r], times, mine.filter((l) => l.date === date), date, today, nowHHMM);
  if (!plan.length) return { date, state: 'none', ratio: 0 };
  const doneN = plan.filter(entryDone).length;
  const skippedAll = plan.every((e) => e.status === 'skipped');
  // 습관은 횟수 비율도 반영
  const ratio = plan.reduce((s, e) => s + (e.status === 'done' ? 1 : Math.min(1, e.count / Math.max(1, e.target))), 0) / plan.length;
  if (doneN === plan.length) return { date, state: 'done', ratio: 1 };
  if (skippedAll) return { date, state: 'skipped', ratio: 0 };
  if (date === today && plan.every((e) => e.status === 'pending' || e.status === 'done')) return { date, state: doneN > 0 ? 'partial' : 'none', ratio };
  if (ratio > 0) return { date, state: 'partial', ratio };
  return { date, state: 'missed', ratio: 0 };
}

/** 하루 전체 달성 비율 (모든 루틴, 기록 화면의 월 히트맵) */
export function dayRatio(routines: Routine[], times: RoutineTime[], logs: Log[], date: string, today: string, nowHHMM: string): number | null {
  const plan = dayPlan(routines.filter((r) => !r.archived), times, logs.filter((l) => l.date === date), date, today, nowHHMM);
  const p = progress(plan);
  if (!p.total) return null;
  return p.ratio;
}

/** 값(km, 쪽, 분 …) 주간 합계. 최근 weeks 주, 월요일 시작 */
export function weeklyValueTotals(logs: Log[], routineId: string, today: string, weeks = 8): { weekStart: string; total: number; count: number }[] {
  const first = addDays(weekStart(today), -(weeks - 1) * 7);
  const out = Array.from({ length: weeks }, (_, i) => ({ weekStart: addDays(first, i * 7), total: 0, count: 0 }));
  for (const l of logs) {
    if (l.routine_id !== routineId || l.status !== 'done' || l.value == null) continue;
    const i = Math.floor(dayDiff(first, l.date) / 7);
    if (i >= 0 && i < weeks) {
      out[i].total += l.value;
      out[i].count++;
    }
  }
  return out.map((o) => ({ ...o, total: Math.round(o.total * 100) / 100 }));
}

export const sameOrAfter = (a: string, b: string) => toMin(a) >= toMin(b);
