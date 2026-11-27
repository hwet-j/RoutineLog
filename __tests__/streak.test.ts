import { streaks } from '../src/lib/streak';
import { log, routine, time } from './helpers';

const daily = (dates: string[], extra = {}) => dates.map((date) => log({ date, ...extra }));

test('연속 일수: 오늘 미완료는 끊지 않고, 오늘 완료면 +1', () => {
  const r = routine({ start_date: '2026-11-20' });
  const logs = daily(['2026-11-24', '2026-11-25', '2026-11-26']);
  expect(streaks(r, [], logs, '2026-11-27')).toEqual({ current: 3, longest: 3, unit: 'day' });
  expect(streaks(r, [], [...logs, ...daily(['2026-11-27'])], '2026-11-27').current).toBe(4);
});

test('어제를 빼먹으면 끊김, 최장 기록은 유지', () => {
  const r = routine({ start_date: '2026-11-01' });
  const logs = daily(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-25']);
  const s = streaks(r, [], logs, '2026-11-27');
  expect(s.current).toBe(0);
  expect(s.longest).toBe(5);
  expect(streaks(r, [], logs, '2026-11-26').current).toBe(1); // 11/25 만 한 상태에서 오늘이 11/26 이면 진행 중
});

test('해당일이 아닌 날(휴식일)은 streak 를 끊지 않음: 월수금', () => {
  const r = routine({ schedule: 'weekdays', weekdays: 1 + 4 + 16, start_date: '2026-11-02' });
  const logs = daily(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11']);
  expect(streaks(r, [], logs, '2026-11-12')).toEqual({ current: 5, longest: 5, unit: 'day' });
  // 금요일(11/13) 지나서 안 하면 끊김
  expect(streaks(r, [], logs, '2026-11-14').current).toBe(0);
});

test('복약은 모든 슬롯이 done 이어야 그날 완료, 건너뜀은 완료가 아님', () => {
  const r = routine({ kind: 'medication', start_date: '2026-11-24' });
  const t = [time('08:00'), time('21:00')];
  const logs = [
    log({ date: '2026-11-24', slot: '08:00' }), log({ date: '2026-11-24', slot: '21:00' }),
    log({ date: '2026-11-25', slot: '08:00' }), // 저녁 누락
    log({ date: '2026-11-26', slot: '08:00' }), log({ date: '2026-11-26', slot: '21:00' }),
  ];
  expect(streaks(r, t, logs, '2026-11-27')).toEqual({ current: 1, longest: 1, unit: 'day' });
  const skipped = [...logs, log({ date: '2026-11-25', slot: '21:00', status: 'skipped' })];
  expect(streaks(r, t, skipped, '2026-11-27').current).toBe(1);
});

test('습관 목표 횟수 미달은 미완료', () => {
  const r = routine({ kind: 'habit', daily_target: 2, start_date: '2026-11-25' });
  const logs = [log({ date: '2026-11-25', count: 2 }), log({ date: '2026-11-26', count: 1 })];
  expect(streaks(r, [], logs, '2026-11-27').current).toBe(0);
});

test('주 N회 습관: 연속 주, 이번 주 미달성은 진행 중', () => {
  const r = routine({ kind: 'habit', schedule: 'weekly_count', weekly_count: 3, start_date: '2026-11-02' });
  const wk = (a: string[]) => a.map((date) => log({ date }));
  const logs = [...wk(['2026-11-02', '2026-11-04', '2026-11-06']), ...wk(['2026-11-09', '2026-11-10', '2026-11-12']), ...wk(['2026-11-16', '2026-11-17'])];
  // 11/16 주는 2회뿐 → 끊김, 11/23 주는 진행 중
  expect(streaks(r, [], [...logs, ...wk(['2026-11-23'])], '2026-11-27')).toEqual({ current: 0, longest: 2, unit: 'week' });
  const ok = [...logs, ...wk(['2026-11-18']), ...wk(['2026-11-23', '2026-11-24', '2026-11-25'])];
  expect(streaks(r, [], ok, '2026-11-27')).toEqual({ current: 4, longest: 4, unit: 'week' });
});

test('시작일 이전 기록·다른 루틴 기록은 무시', () => {
  const r = routine({ start_date: '2026-11-26' });
  const logs = [...daily(['2026-11-20', '2026-11-21']), log({ date: '2026-11-26', routine_id: 'other' }), ...daily(['2026-11-26', '2026-11-27'])];
  expect(streaks(r, [], logs, '2026-11-27').current).toBe(2);
});

test('종료일이 지난 루틴', () => {
  const r = routine({ start_date: '2026-11-01', end_date: '2026-11-05' });
  const logs = daily(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  expect(streaks(r, [], logs, '2026-11-27')).toEqual({ current: 5, longest: 5, unit: 'day' });
});
