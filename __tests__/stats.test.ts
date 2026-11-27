import { adherence, cell, dayRatio, heatmap, isLate, weekdayPattern, weeklyValueTotals } from '../src/lib/stats';
import { at } from '../src/lib/dates';
import { log, routine, time } from './helpers';

const R = routine({ kind: 'medication', start_date: '2026-11-20' });
const T = [time('08:00'), time('21:00')];

test('이행률: 지킨 슬롯/전체, 건너뜀은 분모 제외, 아직 안 온 슬롯 제외', () => {
  const logs = [
    log({ date: '2026-11-25', slot: '08:00' }), log({ date: '2026-11-25', slot: '21:00' }),
    log({ date: '2026-11-26', slot: '08:00' }), log({ date: '2026-11-26', slot: '21:00', status: 'skipped' }),
    log({ date: '2026-11-27', slot: '08:00' }),
  ];
  // 11/25~11/27, 오늘 11/27 12:00 → 오늘 21:00 슬롯은 아직
  const a = adherence(R, T, logs, '2026-11-25', '2026-11-27', '2026-11-27', '12:00');
  expect(a).toMatchObject({ scheduled: 5, done: 4, skipped: 1, missed: 0 });
  expect(a.rate).toBe(1);
  const b = adherence(R, T, logs, '2026-11-25', '2026-11-27', '2026-11-27', '22:00');
  expect(b).toMatchObject({ scheduled: 6, done: 4, skipped: 1, missed: 1 });
  expect(b.rate).toBeCloseTo(4 / 5);
});

test('늦게 먹은 비율: 슬롯 +60분 이후 체크', () => {
  const ok = new Date(at('2026-11-27', '08:00').getTime() + 30 * 60_000).toISOString();
  const lateAt = new Date(at('2026-11-27', '21:00').getTime() + 90 * 60_000).toISOString();
  const logs = [log({ date: '2026-11-27', slot: '08:00', logged_at: ok }), log({ date: '2026-11-27', slot: '21:00', logged_at: lateAt })];
  const a = adherence(R, T, logs, '2026-11-27', '2026-11-27', '2026-11-27', '23:00');
  expect(a.timed).toBe(2);
  expect(a.late).toBe(1);
  expect(a.lateRate).toBe(0.5);
  expect(isLate('2026-11-27', '08:00', at('2026-11-28', '07:00').toISOString())).toBe(true);
  expect(isLate('2026-11-27', '08:00', 'garbage')).toBe(false);
});

test('이행률: 대상이 없으면 rate null', () => {
  expect(adherence(R, T, [], '2026-11-01', '2026-11-10', '2026-11-27', '12:00').rate).toBeNull();
});

test('주 N회 이행률은 끝난 주만 센다', () => {
  const r = routine({ kind: 'habit', schedule: 'weekly_count', weekly_count: 2, start_date: '2026-11-02' });
  const logs = [log({ date: '2026-11-03' }), log({ date: '2026-11-05' }), log({ date: '2026-11-10' })];
  const a = adherence(r, [], logs, '2026-11-02', '2026-11-27', '2026-11-27', '12:00');
  // 11/2주(2회 달성), 11/9주(1회 미달), 11/16주(0 미달), 11/23주는 아직 안 끝남
  expect(a).toMatchObject({ scheduled: 3, done: 1, missed: 2 });
});

test('요일별 패턴', () => {
  const r = routine({ kind: 'habit', start_date: '2026-10-01' });
  const logs = ['2026-11-23', '2026-11-24'].map((date) => log({ date }));
  const p = weekdayPattern(r, [], logs, '2026-11-26', '12:00', 1);
  expect(p[0]).toEqual({ due: 1, done: 1 }); // 월 11/23
  expect(p[2]).toEqual({ due: 1, done: 0 }); // 수 11/25
  expect(p[4]).toEqual({ due: 1, done: 0 }); // 금 11/20 (창의 첫날, 안 함)
  expect(p[3]).toEqual({ due: 0, done: 0 }); // 목 11/26: 오늘은 아직 끝나지 않아(시각 없는 습관) 판정에서 제외
});

test('히트맵: 12주 x 7일, 미래·해당 없음·완료·놓침·일부', () => {
  const r = routine({ kind: 'medication', start_date: '2026-11-16' });
  const t = [time('08:00'), time('21:00')];
  const logs = [log({ date: '2026-11-23', slot: '08:00' }), log({ date: '2026-11-23', slot: '21:00' }), log({ date: '2026-11-24', slot: '08:00' })];
  const h = heatmap(r, t, logs, '2026-11-27', '12:00', 12);
  expect(h).toHaveLength(12);
  expect(h.every((c) => c.length === 7)).toBe(true);
  const last = h[11];
  expect(last[0]).toMatchObject({ date: '2026-11-23', state: 'done' });
  expect(last[1]).toMatchObject({ date: '2026-11-24', state: 'partial' });
  expect(last[2]).toMatchObject({ date: '2026-11-25', state: 'missed' });
  expect(last[4]).toMatchObject({ date: '2026-11-27', state: 'missed' }); // 오늘 08:00 슬롯이 이미 지남
  expect(last[5].state).toBe('future');
  expect(h[0][0].state).toBe('none'); // 시작 전
});

test('셀: 습관 횟수 부분 달성, 건너뜀만 있는 날', () => {
  const r = routine({ kind: 'habit', daily_target: 4, start_date: '2026-11-01' });
  const mine = [log({ date: '2026-11-20', count: 2 }), log({ date: '2026-11-21', status: 'skipped' })];
  const c = cell(r, [], mine, '2026-11-20', '2026-11-27', '12:00');
  expect(c.state).toBe('partial');
  expect(c.ratio).toBe(0.5);
  expect(cell(r, [], mine, '2026-11-21', '2026-11-27', '12:00').state).toBe('skipped');
  expect(cell(r, [], mine, '2026-11-22', '2026-11-27', '12:00').state).toBe('missed');
});

test('하루 전체 달성 비율', () => {
  const a = routine({ id: 'a', kind: 'medication', start_date: '2026-11-01' });
  const b = routine({ id: 'b', kind: 'habit', start_date: '2026-11-01' });
  const logs = [log({ routine_id: 'a', date: '2026-11-26', slot: '08:00' })];
  const times = [time('08:00', 'a')];
  expect(dayRatio([a, b], times, logs, '2026-11-26', '2026-11-27', '12:00')).toBe(0.5);
  expect(dayRatio([], [], [], '2026-11-26', '2026-11-27', '12:00')).toBeNull();
  expect(dayRatio([routine({ archived: 1 })], [], [], '2026-11-26', '2026-11-27', '12:00')).toBeNull();
});

test('값 주간 합계', () => {
  const logs = [
    log({ date: '2026-11-23', value: 5 }), log({ date: '2026-11-25', value: 3.25 }), log({ date: '2026-11-16', value: 4 }),
    log({ date: '2026-11-24', value: null }), log({ date: '2026-11-26', value: 9, routine_id: 'x' }), log({ date: '2026-11-24', value: 2, status: 'skipped' }),
  ];
  const w = weeklyValueTotals(logs, 'r1', '2026-11-27', 3);
  expect(w.map((x) => x.weekStart)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
  expect(w.map((x) => x.total)).toEqual([0, 4, 8.25]);
  expect(w[2].count).toBe(2);
});
