import type { Log, Routine, RoutineTime } from '../src/lib/types';

export const routine = (p: Partial<Routine> = {}): Routine => ({
  id: 'r1', name: '비타민D', kind: 'supplement', detail: null, color: null, icon: null, schedule: 'daily', weekdays: 127, interval_days: null,
  weekly_count: null, start_date: '2026-01-01', end_date: null, daily_target: 1, unit: null, reminder: 1, nag_minutes: null, notify_style: null,
  archived: 0, sort: 0, created_at: '2026-01-01T00:00:00.000Z', ...p,
});
export const time = (time: string, routine_id = 'r1', label: string | null = null): RoutineTime => ({ id: `t-${routine_id}-${time}`, routine_id, time, label });
let n = 0;
export const log = (p: Partial<Log> & Pick<Log, 'date'>): Log => ({
  id: `l${++n}`, routine_id: 'r1', slot: null, status: 'done', count: 1, value: null, note: null,
  logged_at: `${p.date}T12:00:00.000Z`, source: 'app', source_ref: null, ...p,
});
