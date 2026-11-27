import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';

import { CHANNELS, channelFor } from './lib/channels';
import { buildPlan, diffSchedule, parsePlanId, type PlanItem } from './lib/notifyPlan';
import type { NotifyStyle, Snapshot } from './lib/types';

export const CATEGORY = 'routine-dose';
export const ACTION_DONE = 'done';

const IMPORTANCE = { HIGH: AndroidImportance.HIGH, LOW: AndroidImportance.LOW } as const;

/** Android 채널을 멱등으로 만든다 (이미 있으면 소리/진동은 시스템이 유지: 사용자가 시스템 설정에서 바꾼 값 존중) */
export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  for (const c of Object.values(CHANNELS)) {
    await Notifications.setNotificationChannelAsync(c.id, {
      name: c.name,
      description: c.description,
      importance: IMPORTANCE[c.importance],
      sound: c.sound,
      vibrationPattern: c.vibration ?? undefined,
      enableVibrate: c.vibration !== null,
      lockscreenVisibility: c.visibility === 'public' ? AndroidNotificationVisibility.PUBLIC : AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
    });
  }
  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: ACTION_DONE, buttonTitle: '했어요', options: { opensAppToForeground: true } },
  ]);
}

export type PermState = 'granted' | 'denied' | 'undetermined';
export async function permissionState(): Promise<PermState> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}
export async function requestPermission(): Promise<boolean> {
  await ensureChannels();
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

const isOurs = (n: Notifications.NotificationRequest) => (n.content.data as { type?: string } | null)?.type === 'routine';

/** 계획과 이미 예약된 알림을 비교해 바뀐 것만 취소·추가한다. 권한이 없으면 아무것도 하지 않는다 */
export async function reschedule(snap: Snapshot, opts: { defaultStyle: NotifyStyle; exact: boolean; now?: Date }): Promise<{ added: number; cancelled: number }> {
  if (Platform.OS === 'web') return { added: 0, cancelled: 0 };
  if (!(await Notifications.getPermissionsAsync()).granted) return { added: 0, cancelled: 0 };
  await ensureChannels();
  const plan = buildPlan({ ...snap, now: opts.now ?? new Date(), defaultStyle: opts.defaultStyle });
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter(isOurs);
  const existing = scheduled.map((n) => ({ id: n.identifier, hash: (n.content.data as { hash?: string }).hash }));
  const d = diffSchedule(existing, plan);
  for (const id of d.cancel) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  for (const p of d.add) await schedule(p, opts.exact);
  return { added: d.add.length, cancelled: d.cancel.length };
}

async function schedule(p: PlanItem, exact: boolean) {
  await Notifications.scheduleNotificationAsync({
    identifier: p.id,
    content: {
      title: p.title, body: p.body, categoryIdentifier: CATEGORY, sound: p.channelId === channelFor('sound') ? 'default' : false,
      data: { type: 'routine', routineId: p.routineId, date: p.date, slot: p.slot, kind: p.kind, hash: p.hash, style: p.channelId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt, channelId: p.channelId, ...(exact ? { delivery: 'alarmClock' as const } : {}) },
  });
}

/** 체크한 슬롯의 남은 알림(본 알림이 아직 안 울렸다면 그것, 재알림)을 취소 */
export async function cancelSlot(routineId: string, date: string, slot: string) {
  const base = `${routineId}:${date}:${slot}`;
  await Notifications.cancelScheduledNotificationAsync(base).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`${base}:nag`).catch(() => {});
  // 이미 울린 알림이 알림창에 남아 있으면 치운다
  await Notifications.dismissNotificationAsync(base).catch(() => {});
  await Notifications.dismissNotificationAsync(`${base}:nag`).catch(() => {});
}

/** 선택한 방식으로 몇 초 뒤 테스트 알림 */
export async function sendTest(style: NotifyStyle) {
  await ensureChannels();
  const c = CHANNELS[style];
  await Notifications.scheduleNotificationAsync({
    content: { title: '💊 테스트 알림', body: `${c.name} 방식으로 이렇게 알려 드려요`, sound: style === 'sound' ? 'default' : false, data: { type: 'test', style: c.id } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: c.id },
  });
}

export { parsePlanId };
