import * as Haptics from 'expo-haptics';
import type { SQLiteDatabase } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { getDb } from './db';
import { deleteLog, deleteRoutine, insertRoutine, kvGet, kvSet, loadAll, restoreLog, setArchived, upsertLog, type LogInput } from './db/repo';
import { DEFAULT_STYLE, isStyle } from './lib/channels';
import { logicalNow, ymd } from './lib/dates';
import type { Log, NotifyStyle, Routine, RoutineTime, Snapshot } from './lib/types';
import { cancelSlot, ensureChannels, reschedule } from './notify';

export interface Settings {
  /** 'HH:MM' 이 시각 전의 체크는 전날로 친다 */
  dayStart: string;
  notifyStyle: NotifyStyle;
  /** 새 루틴의 기본 재알림(분), null 이면 없음 */
  nagDefault: number | null;
  /** 알람 방식(정확한 시각). 상태바에 알람 아이콘이 보일 수 있다 */
  exactAlarm: boolean;
}
const DEFAULTS: Settings = { dayStart: '00:00', notifyStyle: DEFAULT_STYLE, nagDefault: null, exactAlarm: false };

export interface Notice {
  text: string;
  action?: { label: string; run: () => Promise<void> };
}

interface Ctx extends Snapshot {
  ready: boolean;
  error: string | null;
  settings: Settings;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  /** 하루 시작 시각을 반영한 오늘(YYYY-MM-DD)과 시각('HH:MM', 새벽은 24 이상) */
  today: string;
  nowTime: string;
  now: Date;
  routineById: Map<string, Routine>;
  timesOf(routineId: string): RoutineTime[];
  mutate<T>(fn: (db: SQLiteDatabase) => Promise<T>): Promise<T>;
  refresh(): Promise<void>;
  /** 복약 슬롯 체크(완료/건너뜀). 되돌리기 안내를 띄운다 */
  checkSlot(r: Routine, date: string, slot: string | null, status?: 'done' | 'skipped', opts?: { loggedAt?: string; note?: string | null; source?: Log['source'] }): Promise<void>;
  uncheckSlot(r: Routine, log: Log): Promise<void>;
  /** 습관 횟수 +1 / −1 */
  habitAdd(r: Routine, date: string, extra?: { value?: number | null; note?: string | null }): Promise<void>;
  habitRemove(r: Routine, date: string): Promise<void>;
  removeLog(l: Log): Promise<void>;
  removeRoutine(r: Routine): Promise<void>;
  archive(r: Routine, v: boolean): Promise<void>;
  notice: Notice | null;
  showNotice(n: Notice): void;
  clearNotice(): void;
}

const EMPTY: Snapshot = { routines: [], times: [], logs: [] };
const C = createContext<Ctx>(null as never);
export const useRoutines = () => useContext(C);

export function RoutineProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { today, time: nowTime } = useMemo(() => logicalNow(now, settings.dayStart), [now, settings.dayStart]);

  const load = useCallback(async () => {
    const db = await getDb();
    const [dayStart, style, nag, exact] = await Promise.all([kvGet(db, 'day_start'), kvGet(db, 'notify_style_default'), kvGet(db, 'nag_default'), kvGet(db, 'exact_alarm')]);
    const s: Settings = {
      dayStart: dayStart && /^\d{2}:\d{2}$/.test(dayStart) ? dayStart : DEFAULTS.dayStart,
      notifyStyle: isStyle(style) ? style : DEFAULTS.notifyStyle,
      nagDefault: nag && Number(nag) > 0 ? Number(nag) : null,
      exactAlarm: exact === '1',
    };
    setSettings(s);
    const n = new Date();
    setNow(n);
    setSnap(await loadAll(db, ymd(n)));
  }, []);

  const sync = useCallback(async () => {
    try {
      await ensureChannels();
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, [load]);

  useEffect(() => {
    void sync();
    // 비서가 앱 밖에서 기록을 넣을 수 있으므로 포그라운드로 돌아올 때마다 다시 읽는다
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    // 시각 경과(놓침 표시, 날짜 변경)를 위해 30초마다 시계를 갱신
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, [sync]);

  // 알림 재예약 (데이터/설정이 바뀔 때, 약간 모아서)
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;
    const h = setTimeout(() => {
      void reschedule(snap, { defaultStyle: settings.notifyStyle, exact: settings.exactAlarm }).catch(() => {});
    }, 800);
    return () => clearTimeout(h);
  }, [ready, snap, settings.notifyStyle, settings.exactAlarm]);

  const refresh = useCallback(async () => {
    const db = await getDb();
    setSnap(await loadAll(db, ymd(new Date())));
  }, []);

  const mutate = useCallback(async <T,>(fn: (db: SQLiteDatabase) => Promise<T>): Promise<T> => {
    const db = await getDb();
    const r = await fn(db);
    setSnap(await loadAll(db, ymd(new Date())));
    return r;
  }, []);

  const setSetting = useCallback(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const db = await getDb();
    const map: Record<keyof Settings, string> = { dayStart: 'day_start', notifyStyle: 'notify_style_default', nagDefault: 'nag_default', exactAlarm: 'exact_alarm' };
    await kvSet(db, map[key], typeof value === 'boolean' ? (value ? '1' : '0') : value === null ? '' : String(value));
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const clearNotice = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }, []);
  const showNotice = useCallback((n: Notice) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(n);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  const checkSlot = useCallback<Ctx['checkSlot']>(async (r, date, slot, status = 'done', opts) => {
    const prev = snap.logs.find((l) => l.routine_id === r.id && l.date === date && (l.slot ?? null) === slot && r.kind !== 'habit');
    const input: LogInput = { routine_id: r.id, date, slot, status, note: opts?.note ?? prev?.note ?? null, source: opts?.source ?? 'app', logged_at: opts?.loggedAt, replaceExisting: r.kind !== 'habit' };
    const id = await mutate((db) => upsertLog(db, input));
    if (slot) void cancelSlot(r.id, date, slot);
    void tap();
    showNotice({
      text: `${status === 'done' ? '✓ 체크했어요' : '건너뛰었어요'} · ${r.name}${slot ? ` ${slot}` : ''}`,
      action: { label: '되돌리기', run: async () => { await mutate((db) => (prev ? restoreLog(db, prev) : deleteLog(db, id))); } },
    });
  }, [snap.logs, mutate, showNotice]);

  const uncheckSlot = useCallback<Ctx['uncheckSlot']>(async (r, log) => {
    await mutate((db) => deleteLog(db, log.id));
    void tap();
    showNotice({ text: `체크를 취소했어요 · ${r.name}`, action: { label: '되돌리기', run: async () => { await mutate((db) => restoreLog(db, log)); } } });
  }, [mutate, showNotice]);

  const habitAdd = useCallback<Ctx['habitAdd']>(async (r, date, extra) => {
    const id = await mutate((db) => upsertLog(db, { routine_id: r.id, date, slot: null, status: 'done', count: 1, value: extra?.value ?? null, note: extra?.note ?? null }));
    void tap();
    showNotice({ text: `+1 · ${r.name}`, action: { label: '되돌리기', run: async () => { await mutate((db) => deleteLog(db, id)); } } });
  }, [mutate, showNotice]);

  const habitRemove = useCallback<Ctx['habitRemove']>(async (r, date) => {
    const mine = snap.logs.filter((l) => l.routine_id === r.id && l.date === date && l.status === 'done').sort((a, b) => b.logged_at.localeCompare(a.logged_at));
    const last = mine[0];
    if (!last) return;
    await mutate((db) => deleteLog(db, last.id));
    void tap();
    showNotice({ text: `−1 · ${r.name}`, action: { label: '되돌리기', run: async () => { await mutate((db) => restoreLog(db, last)); } } });
  }, [snap.logs, mutate, showNotice]);

  const removeLog = useCallback<Ctx['removeLog']>(async (l) => {
    await mutate((db) => deleteLog(db, l.id));
    showNotice({ text: '기록을 삭제했어요', action: { label: '되돌리기', run: async () => { await mutate((db) => restoreLog(db, l)); } } });
  }, [mutate, showNotice]);

  const removeRoutine = useCallback<Ctx['removeRoutine']>(async (r) => {
    const times = snap.times.filter((t) => t.routine_id === r.id);
    const logs = snap.logs.filter((l) => l.routine_id === r.id);
    await mutate((db) => deleteRoutine(db, r.id));
    showNotice({
      text: `루틴을 삭제했어요 · ${r.name}`,
      action: {
        label: '되돌리기',
        run: async () => {
          await mutate(async (db) => {
            const { id: _i, created_at: _c, ...rest } = r;
            const newId = await insertRoutine(db, rest, times.map((t) => ({ time: t.time, label: t.label })), new Date(r.created_at));
            // 원래 id 로 되돌린다 (기록이 이 id 를 가리키므로)
            await db.runAsync('UPDATE routines SET id = ? WHERE id = ?', r.id, newId);
            await db.runAsync('UPDATE routine_times SET routine_id = ? WHERE routine_id = ?', r.id, newId);
            for (const l of logs) await restoreLog(db, l);
          });
        },
      },
    });
  }, [snap.times, snap.logs, mutate, showNotice]);

  const archive = useCallback<Ctx['archive']>(async (r, v) => {
    await mutate((db) => setArchived(db, r.id, v));
    showNotice({ text: v ? `보관했어요 · ${r.name}` : `다시 사용해요 · ${r.name}`, action: { label: '되돌리기', run: async () => { await mutate((db) => setArchived(db, r.id, !v)); } } });
  }, [mutate, showNotice]);

  const value = useMemo<Ctx>(() => ({
    ...snap, ready, error, settings, setSetting, today, nowTime, now,
    routineById: new Map(snap.routines.map((r) => [r.id, r])),
    timesOf: (id: string) => snap.times.filter((t) => t.routine_id === id),
    mutate, refresh, checkSlot, uncheckSlot, habitAdd, habitRemove, removeLog, removeRoutine, archive, notice, showNotice, clearNotice,
  }), [snap, ready, error, settings, setSetting, today, nowTime, now, mutate, refresh, checkSlot, uncheckSlot, habitAdd, habitRemove, removeLog, removeRoutine, archive, notice, showNotice, clearNotice]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
