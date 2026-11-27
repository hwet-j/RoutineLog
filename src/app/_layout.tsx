import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACTION_DONE } from '../notify';
import { RoutineProvider, useRoutines } from '../store';
import { useTheme } from '../theme';

// 앱이 열려 있을 때도 알림을 보여 준다 (소리는 '소리' 방식 채널일 때만)
Notifications.setNotificationHandler({
  handleNotification: async (n) => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: (n.request.content.data as { style?: string } | null)?.style === 'routine-sound',
    shouldSetBadge: false,
  }),
});

/** 체크/삭제 직후 6초간 보이는 안내 바 (되돌리기) */
function NoticeBar() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { notice, clearNotice } = useRoutines();
  if (!notice) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 76 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.dark ? '#E7E4F1' : '#1E1B2E', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ flex: 1, color: t.dark ? '#1E1B2E' : '#fff', fontWeight: '600' }} numberOfLines={2}>{notice.text}</Text>
        {notice.action && (
          <Pressable onPress={async () => { const a = notice.action; clearNotice(); await a?.run(); }} accessibilityRole="button" accessibilityLabel={notice.action.label} hitSlop={8}>
            <Text style={{ color: t.dark ? '#6D28D9' : '#C4B5FD', fontWeight: '800' }}>{notice.action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** 알림을 눌렀을 때: 오늘 화면의 그 카드로, "했어요" 버튼이면 바로 체크 */
function NotificationBridge() {
  const { ready, routineById, checkSlot } = useRoutines();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || !ready) return;
    const key = `${response.notification.request.identifier}|${response.actionIdentifier}|${response.notification.date}`;
    if (handled.current === key) return;
    const d = response.notification.request.content.data as { type?: string; routineId?: string; date?: string; slot?: string } | null;
    if (d?.type !== 'routine' || !d.routineId || !d.date || !d.slot) return;
    handled.current = key;
    const r = routineById.get(d.routineId);
    if (response.actionIdentifier === ACTION_DONE && r) {
      void checkSlot(r, d.date, d.slot, 'done', { source: 'notification' });
      router.navigate({ pathname: '/', params: { date: d.date } });
    } else {
      router.navigate({ pathname: '/', params: { date: d.date, highlight: `${d.routineId}:${d.date}:${d.slot}` } });
    }
  }, [response, ready, routineById, checkSlot]);
  return null;
}

function Shell() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerShadowVisible: false, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="routine/[id]" options={{ title: '루틴', presentation: 'modal' }} />
        <Stack.Screen name="log/[id]" options={{ title: '기록', presentation: 'modal' }} />
        <Stack.Screen name="routine-stats/[id]" options={{ title: '루틴 통계' }} />
        <Stack.Screen name="settings/backup" options={{ title: '백업 · 내보내기' }} />
        <Stack.Screen name="add" options={{ headerShown: false }} />
        <Stack.Screen name="log/index" options={{ headerShown: false }} />
        <Stack.Screen name="today" options={{ headerShown: false }} />
      </Stack>
      <NoticeBar />
      <NotificationBridge />
    </>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <RoutineProvider>
        <Shell />
      </RoutineProvider>
    </SafeAreaProvider>
  );
}
