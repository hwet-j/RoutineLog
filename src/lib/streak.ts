import { addDays, ymd, weekStart } from './dates';
import { dayPlan, isDueOn, weekDoneDays } from './schedule';
import type { Log, Routine, RoutineTime } from './types';

export interface Streak {
  current: number;
  longest: number;
  /** 'day' = 연속 일수, 'week' = 주 N회 습관의 연속 주 수 */
  unit: 'day' | 'week';
}

const MAX_BACK_DAYS = 800;

/** 한 루틴의 한 날이 "완료"인지: 그 날 해야 할 슬롯/횟수가 모두 done (건너뜀은 완료가 아니다) */
function dayComplete(r: Routine, times: RoutineTime[], byDate: Map<string, Log[]>, date: string): boolean {
  const logs = byDate.get(date) ?? [];
  const plan = dayPlan([r], times, logs, date, '9999-12-31', '00:00');
  return plan.length > 0 && plan.every((e) => e.status === 'done');
}

/**
 * 연속 달성.
 * - 해당일이 아닌 날(요일 밖, N일 간격 사이)은 건너뛴다 (휴식일이 streak 를 끊지 않음)
 * - 오늘이 아직 미완료여도 끊지 않는다(진행 중). 오늘 완료면 +1
 * - 건너뜀(skipped)은 완료가 아니라 streak 를 끊는다
 * - weekly_count 습관은 "주 N회 달성한 연속 주"로 센다 (이번 주가 아직 미달성이면 진행 중으로 본다)
 */
export function streaks(r: Routine, times: RoutineTime[], logs: Log[], today: string): Streak {
  const mine = logs.filter((l) => l.routine_id === r.id);
  if (r.schedule === 'weekly_count') {
    const target = Math.max(1, r.weekly_count ?? 1);
    const thisWeek = weekStart(today);
    let ws = weekStart(r.start_date);
    const floor = addDays(thisWeek, -7 * Math.ceil(MAX_BACK_DAYS / 7));
    if (ws < floor) ws = floor;
    let run = 0, longest = 0;
    for (; ws <= thisWeek; ws = addDays(ws, 7)) {
      if (r.end_date && ws > r.end_date) break;
      const ok = weekDoneDays(r, mine, ws) >= target;
      if (ok) {
        run++;
        longest = Math.max(longest, run);
      } else if (ws === thisWeek) {
        // 진행 중인 주: 끊지도 세지도 않는다
      } else run = 0;
    }
    return { current: run, longest, unit: 'week' };
  }
  const byDate = new Map<string, Log[]>();
  for (const l of mine) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  let d = r.start_date;
  const floor = addDays(today, -MAX_BACK_DAYS);
  if (d < floor) d = floor;
  let run = 0, longest = 0;
  for (; d <= today; d = addDays(d, 1)) {
    if (!isDueOn(r, d)) continue;
    const ok = dayComplete(r, times, byDate, d);
    if (ok) {
      run++;
      longest = Math.max(longest, run);
    } else if (d === today) {
      // 오늘 진행 중
    } else run = 0;
  }
  return { current: run, longest, unit: 'day' };
}

export const todayOf = (now: Date) => ymd(now);
