import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { WEEKDAY_KO } from '../lib/dates';
import type { HeatCell } from '../lib/stats';
import { useTheme, type Theme } from '../theme';

export function heatColor(t: Theme, c: Pick<HeatCell, 'state' | 'ratio'>): string {
  switch (c.state) {
    case 'done': return t.heat3;
    case 'partial': return c.ratio > 0.5 ? t.heat2 : t.heat1;
    case 'missed': return t.dark ? '#5B2A33' : '#FECACA';
    case 'skipped': return t.dark ? '#3A3550' : '#D8D4E6';
    default: return t.heat0;
  }
}

/** 12주 히트맵 (열=주, 행=월~일). 미래 칸은 흐리게 */
export function Heatmap({ cols, size = 18 }: { cols: HeatCell[][]; size?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel="최근 12주 달성 히트맵">
      <View style={{ gap: 4 }}>
        {WEEKDAY_KO.map((d) => (
          <View key={d} style={{ height: size, justifyContent: 'center' }}>
            <Text style={{ fontSize: 10, color: t.faint }}>{d}</Text>
          </View>
        ))}
      </View>
      {cols.map((col, i) => (
        <View key={i} style={{ gap: 4 }}>
          {col.map((c) => (
            <View key={c.date} style={{ width: size, height: size, borderRadius: 5, backgroundColor: heatColor(t, c), opacity: c.state === 'future' ? 0.25 : 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** 막대 하나 (0~1) */
export function Bar({ ratio, color, height = 8 }: { ratio: number; color?: string; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.heat0, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`, height, borderRadius: height, backgroundColor: color ?? t.primary }} />
    </View>
  );
}

export function Legend() {
  const t = useTheme();
  const item = (label: string, color: string) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: t.sub }}>{label}</Text>
    </View>
  );
  return <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>{[item('완료', t.heat3), item('일부', t.heat1), item('놓침', t.dark ? '#5B2A33' : '#FECACA'), item('없음', t.heat0)]}</View>;
}

export const Pressy = Pressable;
