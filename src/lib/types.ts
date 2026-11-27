export type Kind = 'medication' | 'supplement' | 'habit';
export type Schedule = 'daily' | 'weekdays' | 'interval' | 'weekly_count';
export type NotifyStyle = 'sound' | 'vibrate' | 'silent';
export type LogStatus = 'done' | 'skipped';
export type LogSource = 'app' | 'assistant' | 'notification';

export interface Routine {
  id: string;
  name: string;
  kind: Kind;
  detail: string | null;
  color: string | null;
  icon: string | null;
  schedule: Schedule;
  /** 월=1 화=2 수=4 목=8 금=16 토=32 일=64 */
  weekdays: number;
  interval_days: number | null;
  weekly_count: number | null;
  start_date: string;
  end_date: string | null;
  daily_target: number;
  unit: string | null;
  reminder: number;
  nag_minutes: number | null;
  /** null = 앱 기본값을 따른다 */
  notify_style: NotifyStyle | null;
  archived: number;
  sort: number;
  created_at: string;
}

export interface RoutineTime {
  id: string;
  routine_id: string;
  /** 'HH:MM' */
  time: string;
  label: string | null;
}

export interface Log {
  id: string;
  routine_id: string;
  date: string;
  slot: string | null;
  status: LogStatus;
  count: number;
  value: number | null;
  note: string | null;
  logged_at: string;
  source: LogSource;
  source_ref: string | null;
}

export interface Snapshot {
  routines: Routine[];
  times: RoutineTime[];
  logs: Log[];
}

export const KIND_LABEL: Record<Kind, string> = { medication: '복약', supplement: '영양제', habit: '습관' };
export const KIND_ICON: Record<Kind, string> = { medication: '💊', supplement: '🌿', habit: '✅' };
export const STYLE_LABEL: Record<NotifyStyle, string> = { sound: '소리', vibrate: '진동', silent: '조용히' };
