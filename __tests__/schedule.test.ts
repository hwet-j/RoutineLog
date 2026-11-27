import { bitsToDays, dayPlan, daysToBits, isDueOn, pickSlot, progress, scheduleText, weekDoneDays } from '../src/lib/schedule';
import { log, routine, time } from './helpers';

test('daily / 시작·종료일', () => {
  const r = routine({ start_date: '2026-11-10', end_date: '2026-11-20' });
  expect(isDueOn(r, '2026-11-09')).toBe(false);
  expect(isDueOn(r, '2026-11-10')).toBe(true);
  expect(isDueOn(r, '2026-11-20')).toBe(true);
  expect(isDueOn(r, '2026-11-21')).toBe(false);
});

test('weekdays 비트마스크 (월·수·금)', () => {
  const bits = daysToBits([0, 2, 4]);
  expect(bits).toBe(1 + 4 + 16);
  expect(bitsToDays(bits)).toEqual([0, 2, 4]);
  const r = routine({ schedule: 'weekdays', weekdays: bits });
  expect(isDueOn(r, '2026-11-23')).toBe(true); // 월
  expect(isDueOn(r, '2026-11-24')).toBe(false); // 화
  expect(isDueOn(r, '2026-11-27')).toBe(true); // 금
  expect(isDueOn(r, '2026-11-29')).toBe(false); // 일
});

test('interval: 시작일 기준 N일마다 (월 경계 포함)', () => {
  const r = routine({ schedule: 'interval', interval_days: 3, start_date: '2026-11-28' });
  expect(isDueOn(r, '2026-11-28')).toBe(true);
  expect(isDueOn(r, '2026-11-29')).toBe(false);
  expect(isDueOn(r, '2026-12-01')).toBe(true);
  expect(isDueOn(r, '2026-12-04')).toBe(true);
  expect(isDueOn(r, '2026-11-25')).toBe(false); // 시작 전
});

test('복약 슬롯: 시각마다 하나, 완료/건너뜀/대기/지남', () => {
  const r = routine({ kind: 'medication' });
  const times = [time('08:00'), time('13:00'), time('21:00')];
  const logs = [log({ date: '2026-11-27', slot: '08:00' }), log({ date: '2026-11-27', slot: '13:00', status: 'skipped' })];
  const plan = dayPlan([r], times, logs, '2026-11-27', '2026-11-27', '14:00');
  expect(plan.map((e) => [e.slot, e.status])).toEqual([['08:00', 'done'], ['13:00', 'skipped'], ['21:00', 'pending']]);
  const late = dayPlan([r], times, [], '2026-11-27', '2026-11-27', '13:00');
  expect(late.map((e) => e.status)).toEqual(['overdue', 'overdue', 'pending']);
  const past = dayPlan([r], times, [], '2026-11-26', '2026-11-27', '00:00');
  expect(past.every((e) => e.status === 'overdue')).toBe(true);
  const future = dayPlan([r], times, [], '2026-11-28', '2026-11-27', '23:59');
  expect(future.every((e) => e.status === 'pending')).toBe(true);
});

test('시각 없는 복약은 시각 없는 슬롯 하나', () => {
  const plan = dayPlan([routine({ kind: 'medication' })], [], [], '2026-11-27', '2026-11-27', '23:00');
  expect(plan).toHaveLength(1);
  expect(plan[0].slot).toBeNull();
  expect(plan[0].status).toBe('pending');
});

test('습관: 하루 목표 횟수(물 8잔)와 done 판정', () => {
  const r = routine({ kind: 'habit', name: '물', daily_target: 8, unit: '잔' });
  const logs = [log({ date: '2026-11-27', count: 3 }), log({ date: '2026-11-27', count: 4 })];
  const p1 = dayPlan([r], [], logs, '2026-11-27', '2026-11-27', '20:00');
  expect(p1[0]).toMatchObject({ count: 7, target: 8, status: 'pending' });
  const p2 = dayPlan([r], [], [...logs, log({ date: '2026-11-27', count: 1 })], '2026-11-27', '2026-11-27', '20:00');
  expect(p2[0].status).toBe('done');
});

test('습관: 알림 시각이 지났는데 목표 미달이면 overdue, 건너뜀', () => {
  const r = routine({ kind: 'habit', name: '운동' });
  const t = [time('19:00')];
  expect(dayPlan([r], t, [], '2026-11-27', '2026-11-27', '18:59')[0].status).toBe('pending');
  expect(dayPlan([r], t, [], '2026-11-27', '2026-11-27', '19:00')[0].status).toBe('overdue');
  expect(dayPlan([r], t, [log({ date: '2026-11-27', status: 'skipped' })], '2026-11-27', '2026-11-27', '20:00')[0].status).toBe('skipped');
});

test('진행률: 건너뜀은 분모에서 제외, 주 N회 후보는 제외', () => {
  const r1 = routine({ id: 'a', kind: 'medication' });
  const r2 = routine({ id: 'b', kind: 'medication' });
  const r3 = routine({ id: 'c', kind: 'habit', schedule: 'weekly_count', weekly_count: 3 });
  const times = [time('08:00', 'a'), time('08:00', 'b')];
  const logs = [log({ routine_id: 'a', date: '2026-11-27', slot: '08:00' }), log({ routine_id: 'b', date: '2026-11-27', slot: '08:00', status: 'skipped' })];
  const p = progress(dayPlan([r1, r2, r3], times, logs, '2026-11-27', '2026-11-27', '12:00'));
  expect(p).toEqual({ total: 2, done: 1, skipped: 1, ratio: 1 });
  expect(progress([]).ratio).toBe(1);
});

test('주 N회: 그 주(월~일)에 done 이 있는 서로 다른 날 수', () => {
  const r = routine({ kind: 'habit', schedule: 'weekly_count', weekly_count: 3 });
  const logs = [log({ date: '2026-11-23' }), log({ date: '2026-11-23' }), log({ date: '2026-11-25' }), log({ date: '2026-11-22' }), log({ date: '2026-11-30' })];
  expect(weekDoneDays(r, logs, '2026-11-27')).toBe(2);
  expect(weekDoneDays(r, logs, '2026-11-22')).toBe(1);
});

test('비서가 슬롯을 생략했을 때 고르는 슬롯', () => {
  const slots = ['08:00', '13:00', '21:00'];
  expect(pickSlot(slots, new Set(), '14:00')).toBe('13:00');
  expect(pickSlot(slots, new Set(['13:00']), '14:00')).toBe('08:00');
  expect(pickSlot(slots, new Set(), '06:00')).toBe('08:00');
  expect(pickSlot(slots, new Set(slots), '14:00')).toBeNull();
});

test('루틴 한 줄 요약', () => {
  expect(scheduleText(routine(), [time('08:00'), time('21:00')])).toBe('매일 · 08:00, 21:00');
  expect(scheduleText(routine({ schedule: 'weekdays', weekdays: 31 }), [])).toBe('평일');
  expect(scheduleText(routine({ schedule: 'weekdays', weekdays: 96 }), [])).toBe('주말');
  expect(scheduleText(routine({ schedule: 'weekdays', weekdays: 1 + 4 + 16 }), [time('09:00')])).toBe('월·수·금 · 09:00');
  expect(scheduleText(routine({ schedule: 'interval', interval_days: 3 }), [])).toBe('3일마다');
  expect(scheduleText(routine({ kind: 'habit', schedule: 'weekly_count', weekly_count: 3 }), [])).toBe('주 3회');
  expect(scheduleText(routine({ kind: 'habit', daily_target: 8 }), [time('10:00')])).toBe('매일 · 하루 8번');
});
