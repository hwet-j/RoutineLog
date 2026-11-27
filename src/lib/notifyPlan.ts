import { channelFor, effectiveStyle } from './channels';
import { addDays, at, fmtTimeKo, ymd } from './dates';
import { isDueOn, weekDoneDays } from './schedule';
import { KIND_ICON, type Log, type NotifyStyle, type Routine, type RoutineTime } from './types';

export interface PlanItem {
  /** `<routine>:<date>:<slot>` (재알림은 뒤에 `:nag`) */
  id: string;
  routineId: string;
  date: string;
  slot: string;
  kind: 'dose' | 'nag';
  fireAt: Date;
  title: string;
  body: string;
  channelId: string;
  /** 내용이 바뀌면 다시 예약하기 위한 지문 */
  hash: string;
}

export const MAX_SCHEDULED = 400;
export const HORIZON_DAYS = 14;
const MIN_LEAD_MS = 5_000;

export const planId = (routineId: string, date: string, slot: string, nag = false) => `${routineId}:${date}:${slot}${nag ? ':nag' : ''}`;
export const parsePlanId = (id: string): { routineId: string; date: string; slot: string; nag: boolean } | null => {
  const m = /^(.+):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})(:nag)?$/.exec(id);
  return m ? { routineId: m[1], date: m[2], slot: m[3], nag: !!m[4] } : null;
};

/**
 * 앞으로 horizonDays 일의 알림 계획.
 * - 오늘부터 시작, 이미 지난 시각·이미 체크(완료/건너뜀)한 슬롯은 제외 (재알림도 함께 제외)
 * - 습관: 그날 목표 횟수를 이미 채웠으면 제외, 주 N회 습관은 이번 주 목표를 채웠으면 남은 날 제외
 * - 가까운 것부터 최대 cap 개
 */
export function buildPlan(opts: {
  routines: Routine[];
  times: RoutineTime[];
  logs: Log[];
  now: Date;
  horizonDays?: number;
  cap?: number;
  defaultStyle?: NotifyStyle;
}): PlanItem[] {
  const { routines, times, logs, now } = opts;
  const horizon = opts.horizonDays ?? HORIZON_DAYS;
  const cap = opts.cap ?? MAX_SCHEDULED;
  const today = ymd(now);
  const out: PlanItem[] = [];
  for (const r of routines) {
    if (r.archived || !r.reminder) continue;
    const ts = times.filter((t) => t.routine_id === r.id).sort((a, b) => a.time.localeCompare(b.time));
    if (!ts.length) continue;
    const mine = logs.filter((l) => l.routine_id === r.id);
    const style = effectiveStyle(r.notify_style, opts.defaultStyle);
    const channelId = channelFor(style);
    for (let i = 0; i < horizon; i++) {
      const date = addDays(today, i);
      if (!isDueOn(r, date)) continue;
      const dayLogs = mine.filter((l) => l.date === date);
      if (r.kind === 'habit') {
        if (r.schedule === 'weekly_count') {
          const target = Math.max(1, r.weekly_count ?? 1);
          if (weekDoneDays(r, mine, date) >= target || dayLogs.some((l) => l.status === 'done')) continue;
        } else {
          const doneCount = dayLogs.filter((l) => l.status === 'done').reduce((s, l) => s + l.count, 0);
          if (doneCount >= Math.max(1, r.daily_target)) continue;
        }
      }
      for (const t of ts) {
        if (r.kind !== 'habit' && dayLogs.some((l) => l.slot === t.time && (l.status === 'done' || l.status === 'skipped'))) continue;
        const fireAt = at(date, t.time);
        const name = `${KIND_ICON[r.kind]} ${r.name}`;
        const detail = r.detail ? ` · ${r.detail}` : '';
        const when = `${t.label ? `${t.label} ` : ''}${fmtTimeKo(t.time)}`;
        if (fireAt.getTime() > now.getTime() + MIN_LEAD_MS) {
          const title = name;
          const body = `${when}${detail}`;
          out.push({ id: planId(r.id, date, t.time), routineId: r.id, date, slot: t.time, kind: 'dose', fireAt, title, body, channelId, hash: `${title}|${body}|${fireAt.getTime()}|${channelId}` });
        }
        if (r.nag_minutes && r.nag_minutes > 0) {
          const nagAt = new Date(fireAt.getTime() + r.nag_minutes * 60_000);
          if (nagAt.getTime() > now.getTime() + MIN_LEAD_MS) {
            const title = `${name} · 아직이에요`;
            const body = `${when}${detail} — 체크하지 않았어요`;
            out.push({ id: planId(r.id, date, t.time, true), routineId: r.id, date, slot: t.time, kind: 'nag', fireAt: nagAt, title, body, channelId, hash: `${title}|${body}|${nagAt.getTime()}|${channelId}` });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id)).slice(0, cap);
}

/** 이미 예약된 알림(우리 id 규칙만)과 계획을 비교해 취소/추가할 것을 구한다 */
export function diffSchedule(existing: { id: string; hash?: string }[], plan: PlanItem[]): { cancel: string[]; add: PlanItem[] } {
  const have = new Map(existing.map((e) => [e.id, e.hash]));
  const want = new Map(plan.map((p) => [p.id, p]));
  const cancel = existing.filter((e) => !want.has(e.id) || want.get(e.id)!.hash !== e.hash).map((e) => e.id);
  const add = plan.filter((p) => !have.has(p.id) || have.get(p.id) !== p.hash);
  return { cancel, add };
}
