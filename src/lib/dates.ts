/** 날짜는 모두 'YYYY-MM-DD' 문자열(기기 현지 날짜)로 다룬다. Date 객체의 시간대 변환에 기대지 않는다. */
const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const monthKey = (date: string) => date.slice(0, 7);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 날짜 문자열 → UTC 자정 ms (일 수 계산용, DST 영향 없음) */
const utc = (s: string) => {
  const m = DATE_RE.exec(s)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
};
export const dayDiff = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000);
export const addDays = (s: string, n: number) => {
  const d = new Date(utc(s) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
/** 월=0 … 일=6 */
export const weekdayIndex = (s: string) => (new Date(utc(s)).getUTCDay() + 6) % 7;
/** 월=1 화=2 수=4 … 일=64 */
export const weekdayBit = (s: string) => 1 << weekdayIndex(s);
/** 그 날이 속한 주의 월요일 */
export const weekStart = (s: string) => addDays(s, -weekdayIndex(s));
export const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

export const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일'];
export const weekdayKo = (s: string) => WEEKDAY_KO[weekdayIndex(s)];

/** 'HH:MM' → 분 */
export const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const fromMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/**
 * "하루 시작 시각" 보정: 새벽 4시 전에 한 체크를 전날로 칠 수 있다(야근·야식 습관용).
 * dayStart = 'HH:MM' (기본 '00:00' 이면 보정 없음)
 */
export function logicalToday(now: Date, dayStart = '00:00'): string {
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = ymd(now);
  return mins < toMin(dayStart) ? addDays(today, -1) : today;
}

/** 로컬 날짜+시각 → Date (DST 로 존재하지 않는 시각은 기기가 보정) */
export const at = (date: string, time: string) => {
  const m = DATE_RE.exec(date)!;
  return new Date(+m[1], +m[2] - 1, +m[3], +time.slice(0, 2), +time.slice(3, 5), 0, 0);
};

export const fmtDateKo = (s: string) => {
  const m = DATE_RE.exec(s)!;
  return `${+m[2]}월 ${+m[3]}일 (${weekdayKo(s)})`;
};
export const fmtTimeKo = (t: string) => {
  const h = +t.slice(0, 2);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${t.slice(3, 5)}`;
};

/**
 * "논리적 지금": 하루 시작 시각 이전이면 전날로 치고, 시각은 24시간을 넘겨 표기한다(예: 새벽 2시 → 오늘='어제', time='26:00').
 * dayPlan 등 시각 비교(toMin)가 그대로 동작한다.
 */
export function logicalNow(now: Date, dayStart = '00:00'): { today: string; time: string } {
  const today = logicalToday(now, dayStart);
  const shifted = today !== ymd(now);
  const h = now.getHours() + (shifted ? 24 : 0);
  return { today, time: `${pad(h)}:${pad(now.getMinutes())}` };
}
