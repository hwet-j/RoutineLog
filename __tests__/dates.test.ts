import { addDays, at, dayDiff, fmtDateKo, fmtTimeKo, isDate, isTime, logicalToday, toMin, fromMin, weekdayBit, weekdayIndex, weekStart, ymd } from '../src/lib/dates';

test('날짜 검증', () => {
  expect(isDate('2026-02-28')).toBe(true);
  expect(isDate('2026-02-30')).toBe(false);
  expect(isDate('2026-2-3')).toBe(false);
  expect(isDate(20260101)).toBe(false);
  expect(isTime('00:00')).toBe(true);
  expect(isTime('24:00')).toBe(false);
  expect(isTime('9:30')).toBe(false);
});

test('addDays / dayDiff 는 월·연·윤년·DST 경계에서도 달력 날짜 기준', () => {
  expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // 미국 DST 시작일
  expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // 미국 DST 종료일
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(dayDiff('2026-03-07', '2026-03-09')).toBe(2);
  expect(dayDiff('2026-11-01', '2026-10-25')).toBe(-7);
});

test('요일: 월=0, 비트 월=1 … 일=64, 주 시작은 월요일', () => {
  expect(weekdayIndex('2026-11-23')).toBe(0); // 월
  expect(weekdayIndex('2026-11-29')).toBe(6); // 일
  expect(weekdayBit('2026-11-23')).toBe(1);
  expect(weekdayBit('2026-11-27')).toBe(16); // 금
  expect(weekdayBit('2026-11-29')).toBe(64);
  expect(weekStart('2026-11-29')).toBe('2026-11-23');
  expect(weekStart('2026-11-23')).toBe('2026-11-23');
  expect(weekStart('2026-01-01')).toBe('2025-12-29');
});

test('하루 시작 시각 보정', () => {
  const n = (h: number, m: number) => new Date(2026, 10, 27, h, m);
  expect(logicalToday(n(2, 30), '04:00')).toBe('2026-11-26');
  expect(logicalToday(n(4, 0), '04:00')).toBe('2026-11-27');
  expect(logicalToday(n(2, 30))).toBe('2026-11-27');
  expect(logicalToday(n(23, 59), '04:00')).toBe('2026-11-27');
});

test('시각 변환·표기', () => {
  expect(toMin('08:30')).toBe(510);
  expect(fromMin(510)).toBe('08:30');
  expect(fromMin(24 * 60 + 5)).toBe('00:05');
  expect(fmtTimeKo('00:10')).toBe('오전 12:10');
  expect(fmtTimeKo('12:30')).toBe('오후 12:30');
  expect(fmtTimeKo('21:05')).toBe('오후 9:05');
  expect(fmtDateKo('2026-11-27')).toBe('11월 27일 (금)');
  expect(ymd(at('2026-11-27', '08:05'))).toBe('2026-11-27');
  expect(at('2026-11-27', '08:05').getHours()).toBe(8);
});
