import { buildPlan, diffSchedule, parsePlanId, planId } from '../src/lib/notifyPlan';
import { CHANNELS, channelFor, effectiveStyle, isStyle } from '../src/lib/channels';
import { log, routine, time } from './helpers';

const NOW = new Date(2026, 10, 27, 10, 0, 0); // 2026-11-27 10:00 (금)

test('14일, 지난 시각 제외, 가까운 순, id 규칙', () => {
  const r = routine({ kind: 'medication', name: '혈압약' });
  const plan = buildPlan({ routines: [r], times: [time('08:00'), time('21:00')], logs: [], now: NOW });
  // 오늘은 21:00 만, 이후 13일 x 2
  expect(plan).toHaveLength(1 + 13 * 2);
  expect(plan[0].id).toBe('r1:2026-11-27:21:00');
  expect(plan[0].kind).toBe('dose');
  expect(plan[0].title).toBe('💊 혈압약');
  expect(plan[0].body).toBe('오후 9:00');
  const times = plan.map((p) => p.fireAt.getTime());
  expect([...times].sort((a, b) => a - b)).toEqual(times);
  expect(plan[plan.length - 1].date).toBe('2026-12-10');
  expect(parsePlanId(plan[0].id)).toEqual({ routineId: 'r1', date: '2026-11-27', slot: '21:00', nag: false });
  expect(parsePlanId(planId('r1', '2026-11-27', '21:00', true))).toMatchObject({ nag: true });
  expect(parsePlanId('garbage')).toBeNull();
});

test('이미 체크(완료·건너뜀)한 슬롯은 제외, 재알림도 함께', () => {
  const r = routine({ kind: 'medication', nag_minutes: 15 });
  const t = [time('11:00'), time('21:00')];
  const logs = [log({ date: '2026-11-27', slot: '11:00' }), log({ date: '2026-11-27', slot: '21:00', status: 'skipped' })];
  const plan = buildPlan({ routines: [r], times: t, logs, now: NOW, horizonDays: 1 });
  expect(plan).toHaveLength(0);
  const open = buildPlan({ routines: [r], times: t, logs: [], now: NOW, horizonDays: 1 });
  expect(open.map((p) => p.id)).toEqual(['r1:2026-11-27:11:00', 'r1:2026-11-27:11:00:nag', 'r1:2026-11-27:21:00', 'r1:2026-11-27:21:00:nag']);
  expect(open[1].fireAt.getHours()).toBe(11);
  expect(open[1].fireAt.getMinutes()).toBe(15);
  expect(open[1].title).toContain('아직이에요');
});

test('재알림은 알림 시각이 이미 지났어도 재알림 시각이 미래면 포함', () => {
  const r = routine({ kind: 'medication', nag_minutes: 60 });
  const plan = buildPlan({ routines: [r], times: [time('09:30')], logs: [], now: NOW, horizonDays: 1 });
  expect(plan.map((p) => p.kind)).toEqual(['nag']);
});

test('요일 스케줄·종료일·보관·알림 끔 루틴 제외', () => {
  const mwf = routine({ schedule: 'weekdays', weekdays: 1 + 4 + 16 });
  const ended = routine({ id: 'r2', end_date: '2026-11-28' });
  const arch = routine({ id: 'r3', archived: 1 });
  const off = routine({ id: 'r4', reminder: 0 });
  const t = [time('20:00', 'r1'), time('20:00', 'r2'), time('20:00', 'r3'), time('20:00', 'r4')];
  const plan = buildPlan({ routines: [mwf, ended, arch, off], times: t, logs: [], now: NOW, horizonDays: 14 });
  const mine = plan.filter((p) => p.routineId === 'r1').map((p) => p.date);
  expect(mine).toEqual(['2026-11-27', '2026-11-30', '2026-12-02', '2026-12-04', '2026-12-07', '2026-12-09']);
  expect(plan.filter((p) => p.routineId === 'r2').map((p) => p.date)).toEqual(['2026-11-27', '2026-11-28']);
  expect(plan.some((p) => p.routineId === 'r3' || p.routineId === 'r4')).toBe(false);
});

test('시각이 없는 루틴은 알림 계획 없음', () => {
  expect(buildPlan({ routines: [routine()], times: [], logs: [], now: NOW })).toHaveLength(0);
});

test('습관: 오늘 목표를 채웠으면 제외, 주 N회는 이번 주 목표 달성 시 남은 날 제외', () => {
  const water = routine({ kind: 'habit', name: '물', daily_target: 2 });
  const t = [time('15:00')];
  const done = [log({ date: '2026-11-27', count: 2 })];
  const p1 = buildPlan({ routines: [water], times: t, logs: done, now: NOW, horizonDays: 2 });
  expect(p1.map((p) => p.date)).toEqual(['2026-11-28']);
  const wk = routine({ kind: 'habit', schedule: 'weekly_count', weekly_count: 2 });
  const logs = [log({ date: '2026-11-23' }), log({ date: '2026-11-25' })];
  const p2 = buildPlan({ routines: [wk], times: t, logs, now: NOW, horizonDays: 5 });
  // 이번 주(~11/29)는 목표 달성이라 제외, 다음 주(11/30~)부터
  expect(p2.map((p) => p.date)).toEqual(['2026-11-30', '2026-12-01']);
});

test('상한(cap): 가까운 것부터 남긴다', () => {
  const rs = Array.from({ length: 30 }, (_, i) => routine({ id: `r${i}` }));
  const ts = rs.map((r, i) => time(`${String(10 + (i % 12)).padStart(2, '0')}:30`, r.id));
  const plan = buildPlan({ routines: rs, times: ts, logs: [], now: NOW, cap: 50 });
  expect(plan).toHaveLength(50);
  expect(plan[plan.length - 1].fireAt.getTime()).toBeLessThan(new Date(2026, 10, 30).getTime());
  expect(buildPlan({ routines: rs, times: ts, logs: [], now: NOW }).length).toBeLessThanOrEqual(400);
});

test('알림 방식 → 채널: 루틴 값 > 앱 기본값, 재알림도 같은 채널', () => {
  expect(effectiveStyle(null, 'silent')).toBe('silent');
  expect(effectiveStyle('sound', 'silent')).toBe('sound');
  expect(effectiveStyle(null)).toBe('vibrate');
  expect(isStyle('sound')).toBe(true);
  expect(isStyle('loud')).toBe(false);
  expect(channelFor('silent')).toBe('routine-silent');
  const r = routine({ kind: 'medication', nag_minutes: 10, notify_style: 'sound' });
  const r2 = routine({ id: 'r2', kind: 'medication', notify_style: null });
  const plan = buildPlan({ routines: [r, r2], times: [time('23:00', 'r1'), time('23:00', 'r2')], logs: [], now: NOW, horizonDays: 1, defaultStyle: 'silent' });
  expect(plan.filter((p) => p.routineId === 'r1').map((p) => p.channelId)).toEqual(['routine-sound', 'routine-sound']);
  expect(plan.filter((p) => p.routineId === 'r2').map((p) => p.channelId)).toEqual(['routine-silent']);
});

test('채널 정의: 방식별 소리·진동·중요도', () => {
  expect(CHANNELS.sound).toMatchObject({ importance: 'HIGH', sound: 'default' });
  expect(CHANNELS.sound.vibration).not.toBeNull();
  expect(CHANNELS.vibrate).toMatchObject({ importance: 'HIGH', sound: null });
  expect(CHANNELS.vibrate.vibration).not.toBeNull();
  expect(CHANNELS.silent).toMatchObject({ importance: 'LOW', sound: null, vibration: null, visibility: 'public' });
  expect(new Set(Object.values(CHANNELS).map((c) => c.id)).size).toBe(3);
});

test('스케줄 비교: 바뀐 것·없어진 것·새 것만', () => {
  const r = routine({ kind: 'medication', name: '약' });
  const plan = buildPlan({ routines: [r], times: [time('21:00')], logs: [], now: NOW, horizonDays: 3 });
  const existing = plan.map((p) => ({ id: p.id, hash: p.hash }));
  expect(diffSchedule(existing, plan)).toEqual({ cancel: [], add: [] });
  const changed = buildPlan({ routines: [{ ...r, name: '약2' }], times: [time('21:00')], logs: [], now: NOW, horizonDays: 3 });
  const d = diffSchedule(existing, changed);
  expect(d.cancel.sort()).toEqual(existing.map((e) => e.id).sort());
  expect(d.add).toHaveLength(3);
  const stale = [...existing, { id: 'r9:2026-11-27:21:00', hash: 'x' }];
  expect(diffSchedule(stale, plan).cancel).toEqual(['r9:2026-11-27:21:00']);
  expect(diffSchedule([], plan).add).toHaveLength(3);
  // 방식(채널)만 바뀌어도 다시 예약
  const sound = buildPlan({ routines: [{ ...r, notify_style: 'sound' }], times: [time('21:00')], logs: [], now: NOW, horizonDays: 3 });
  expect(diffSchedule(existing, sound).add).toHaveLength(3);
});
