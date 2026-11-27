import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '../../theme';

type Icon = keyof typeof Ionicons.glyphMap;
const tab = (title: string, on: Icon, off: Icon) => ({
  title,
  tabBarIcon: ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => <Ionicons name={focused ? on : off} size={size} color={color as string} />,
});

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.faint, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line }, tabBarLabelStyle: { fontWeight: '700', fontSize: 11 } }}>
      <Tabs.Screen name="index" options={tab('오늘', 'checkmark-circle', 'checkmark-circle-outline')} />
      <Tabs.Screen name="history" options={tab('기록', 'book', 'book-outline')} />
      <Tabs.Screen name="routines" options={tab('루틴', 'repeat', 'repeat-outline')} />
      <Tabs.Screen name="stats" options={tab('통계', 'stats-chart', 'stats-chart-outline')} />
      <Tabs.Screen name="settings" options={tab('설정', 'settings', 'settings-outline')} />
    </Tabs>
  );
}
