/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 이후에 화면을 불러오려고 require 를 쓴다 */
/**
 * 화면 스모크 테스트: 실제 DB(네이티브) 없이 가짜 저장소로 주요 화면이 예외 없이 그려지는지 확인한다.
 * (기기에서 처음 열었을 때 흔한 런타임 오류 — 훅 순서, undefined 접근, 잘못된 import — 를 잡는 용도)
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { log, routine, time } from './helpers';

const R = [
  routine({ id: 'm1', name: '혈압약', kind: 'medication', detail: '1정, 식후', icon: null }),
  routine({ id: 's1', name: '비타민D', kind: 'supplement', nag_minutes: 15, notify_style: 'sound' }),
  routine({ id: 'h1', name: '물 마시기', kind: 'habit', daily_target: 8, unit: '잔' }),
  routine({ id: 'h2', name: '러닝', kind: 'habit', schedule: 'weekly_count', weekly_count: 3, unit: 'km' }),
  routine({ id: 'a1', name: '옛날 약', kind: 'medication', archived: 1 }),
];
const T = [time('08:00', 'm1', '아침'), time('21:00', 'm1', '저녁'), time('09:00', 's1'), time('10:00', 'h1')];
const L = [
  log({ routine_id: 'm1', date: '2026-11-27', slot: '08:00', note: '식후에 먹음' }),
  log({ routine_id: 'h1', date: '2026-11-27', count: 3 }),
  log({ routine_id: 'h2', date: '2026-11-25', value: 5, note: '한강 러닝' }),
  log({ routine_id: 's1', date: '2026-11-26', slot: '09:00', status: 'skipped' }),
];
const mockStore = {
  ready: true, error: null, routines: R, times: T, logs: L,
  settings: { dayStart: '00:00', notifyStyle: 'vibrate', nagDefault: null, exactAlarm: false }, setSetting: jest.fn(),
  today: '2026-11-27', nowTime: '12:00', now: new Date(2026, 10, 27, 12),
  routineById: new Map(R.map((r) => [r.id, r])), timesOf: (id: string) => T.filter((t) => t.routine_id === id),
  mutate: jest.fn(async (fn: (db: unknown) => unknown) => fn({})), refresh: jest.fn(),
  checkSlot: jest.fn(), uncheckSlot: jest.fn(), habitAdd: jest.fn(), habitRemove: jest.fn(), removeLog: jest.fn(), removeRoutine: jest.fn(), archive: jest.fn(),
  notice: null, showNotice: jest.fn(), clearNotice: jest.fn(),
};
let mockParams: Record<string, string> = {};

jest.mock('../src/store', () => ({ useRoutines: () => mockStore, RoutineProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => { require('react').useEffect(cb, []); },
  Stack: { Screen: () => null },
  Tabs: Object.assign(() => null, { Screen: () => null }),
  Redirect: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: '' } }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: async () => [], getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  requestPermissionsAsync: async () => ({ granted: true }), setNotificationChannelAsync: jest.fn(), setNotificationCategoryAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn(), dismissNotificationAsync: jest.fn(),
  AndroidImportance: { HIGH: 4, LOW: 2 }, AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 2 }, SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('../src/db', () => ({ getDb: async () => ({}), getRecovery: () => null, listCorruptFiles: async () => [], deleteCorruptFile: async () => true }));
jest.mock('../src/db/repo', () => ({ listLogs: async () => mockLogs(), allLogs: async () => mockLogs(), duplicateRoutine: jest.fn(), insertRoutine: jest.fn(), updateRoutine: jest.fn(), updateLog: jest.fn(), upsertLog: jest.fn(), restoreBackup: jest.fn(), wipeAll: jest.fn() }));
const mockLogs = () => L;
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const render = async (el: React.ReactElement) => {
  let r!: renderer.ReactTestRenderer;
  await act(async () => { r = renderer.create(el); });
  return r;
};
// 렌더 트리에서 글자만 이어 붙인다 (props 에 순환 참조가 있어 JSON.stringify 는 못 쓴다)
const collect = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(collect).join('') : collect((n as { children?: unknown }).children));
const text = (r: renderer.ReactTestRenderer) => collect(r.toJSON());

// 첫 테스트는 화면과 RN 모듈을 처음 불러오느라 느린 CI 러너에서 5초를 넘길 수 있다
jest.setTimeout(60_000);

beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 12)); });
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => { mockParams = {}; });

test('오늘: 날짜, 진행 링, 카드(복약 슬롯·습관 횟수·주 N회)', async () => {
  const Today = require('../src/app/(tabs)/index').default;
  const s = text(await render(<Today />));
  expect(s).toContain('11월 27일 (금)');
  expect(s).toContain('혈압약');
  expect(s).toContain('비타민D');
  expect(s).toContain('물 마시기');
  expect(s).toContain('3/8');
  expect(s).toContain('이번 주');
  expect(s).not.toContain('옛날 약'); // 보관한 루틴은 제외
});

test('오늘: 알림에서 들어온 강조/날짜 파라미터', async () => {
  mockParams = { date: '2026-11-26', highlight: 'm1:2026-11-26:08:00' };
  const Today = require('../src/app/(tabs)/index').default;
  const s = text(await render(<Today />));
  expect(s).toContain('11월 26일 (목)');
  expect(s).toContain('놓쳤어요');
});

test('기록: 목록·검색·필터', async () => {
  const History = require('../src/app/(tabs)/history').default;
  const s = text(await render(<History />));
  expect(s).toContain('기록');
  expect(s).toContain('식후에 먹음');
  expect(s).toContain('한강 러닝');
  expect(s).toContain('건너뜀');
});

test('루틴 탭: 종류별 그룹, 보관함, 요약', async () => {
  const Routines = require('../src/app/(tabs)/routines').default;
  const s = text(await render(<Routines />));
  expect(s).toContain('복약');
  expect(s).toContain('영양제');
  expect(s).toContain('습관');
  expect(s).toContain('매일 · 08:00, 21:00');
  expect(s).toContain('주 3회');
  expect(s).toContain('보관함 1개');
  expect(s).toContain('소리');
});

test('통계 탭과 루틴 통계', async () => {
  const Stats = require('../src/app/(tabs)/stats').default;
  const s = text(await render(<Stats />));
  expect(s).toContain('통계');
  expect(s).toContain('혈압약');
  mockParams = { id: 'h1' };
  const Detail = require('../src/app/routine-stats/[id]').default;
  const d = text(await render(<Detail />));
  expect(d).toContain('물 마시기');
  expect(d).toContain('현재 연속');
  mockParams = { id: 'm1' };
  expect(text(await render(<Detail />))).toContain('복약 순응도');
  mockParams = { id: 'nope' };
  expect(text(await render(<Detail />))).toContain('찾을 수 없어요');
});

test('설정: 알림 방식·테스트 알림·하루 시작', async () => {
  const Settings = require('../src/app/(tabs)/settings').default;
  const s = text(await render(<Settings />));
  expect(s).toContain('기본 알림 방식');
  expect(s).toContain('소리');
  expect(s).toContain('진동');
  expect(s).toContain('조용히');
  expect(s).toContain('테스트 알림');
  expect(s).toContain('하루 시작 시각');
});

test('루틴 폼: 새 루틴(딥링크 미리채움)과 수정', async () => {
  const Form = require('../src/app/routine/[id]').default;
  mockParams = { id: 'new', name: '오메가3', kind: 'supplement', times: '09:00,21:00', days: '1111100', detail: '1캡슐' };
  const s = text(await render(<Form />));
  expect(s).toContain('알림 방식');
  expect(s).toContain('조용히');
  expect(s).toContain('저장');
  mockParams = { id: 'm1' };
  const e = text(await render(<Form />));
  expect(e).toContain('복제');
  expect(e).toContain('삭제');
});

test('기록 폼: 새 기록(습관)과 수정(복약)', async () => {
  const Log = require('../src/app/log/[id]').default;
  mockParams = { id: 'new', routine: 'h2', date: '2026-11-27' };
  const n = text(await render(<Log />));
  expect(n).toContain('얼마나 했나요');
  expect(n).toContain('메모');
  mockParams = { id: L[0].id };
  const e = text(await render(<Log />));
  expect(e).toContain('혈압약');
  expect(e).toContain('실제로 체크한 시각');
  expect(e).toContain('삭제');
});

test('백업 화면', async () => {
  const Backup = require('../src/app/settings/backup').default;
  const s = text(await render(<Backup />));
  expect(s).toContain('백업 (JSON)');
  expect(s).toContain('CSV');
});
