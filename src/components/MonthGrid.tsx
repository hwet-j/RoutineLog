import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { WEEKDAY_KO, addDays, daysInMonth, weekdayIndex } from '../lib/dates';
import { R, useTheme } from '../theme';

/** 월 달력: 날짜마다 0~1 달성 비율(null=해당 없음)을 색 농도로. 날짜를 누르면 선택 */
export function MonthGrid({ month, ratio, selected, today, onSelect, onMonth }: {
  /** 'YYYY-MM' */
  month: string;
  ratio: (date: string) => number | null;
  selected: string | null;
  today: string;
  onSelect: (date: string | null) => void;
  onMonth: (delta: number) => void;
}) {
  const t = useTheme();
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lead = weekdayIndex(first);
  const n = daysInMonth(y, m);
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  const color = (r: number | null, future: boolean) => (r === null || future ? t.heat0 : r >= 1 ? t.heat3 : r >= 0.5 ? t.heat2 : r > 0 ? t.heat1 : t.dark ? '#5B2A33' : '#FECACA');
  return (
    <View style={{ backgroundColor: t.card, borderRadius: R.lg, padding: 12, gap: 8, boxShadow: t.shadow }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => onMonth(-1)} hitSlop={10} accessibilityLabel="이전 달" style={{ padding: 4 }}><Ionicons name="chevron-back" size={22} color={t.text} /></Pressable>
        <Text style={{ fontSize: 16, fontWeight: '800', color: t.text }}>{y}년 {m}월</Text>
        <Pressable onPress={() => onMonth(1)} hitSlop={10} accessibilityLabel="다음 달" style={{ padding: 4 }}><Ionicons name="chevron-forward" size={22} color={t.text} /></Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>{WEEKDAY_KO.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: t.faint }}>{d}</Text>)}</View>
      {Array.from({ length: cells.length / 7 }, (_, w) => (
        <View key={w} style={{ flexDirection: 'row', gap: 4 }}>
          {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={{ flex: 1, height: 36 }} />;
            const future = d > today;
            const sel = selected === d;
            return (
              <Pressable key={d} onPress={() => onSelect(sel ? null : d)} accessibilityRole="button" accessibilityLabel={`${d} ${sel ? '선택됨' : ''}`}
                style={{ flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: color(ratio(d), future), borderWidth: sel ? 2 : d === today ? 1.5 : 0, borderColor: sel ? t.text : t.primary }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: (ratio(d) ?? 0) >= 0.5 && !future ? '#fff' : t.text }}>{+d.slice(8)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
