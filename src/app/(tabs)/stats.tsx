import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bar } from '../../components/Heat';
import { Ring } from '../../components/Ring';
import { Card, Empty, SectionLabel, Title } from '../../components/ui';
import { addDays } from '../../lib/dates';
import { dayPlan, progress } from '../../lib/schedule';
import { adherence } from '../../lib/stats';
import { streaks } from '../../lib/streak';
import { KIND_ICON } from '../../lib/types';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

export default function StatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { routines, times, logs, today, nowTime } = useRoutines();
  const active = routines.filter((r) => !r.archived);

  const rows = useMemo(() => active.map((r) => {
    const ts = times.filter((x) => x.routine_id === r.id);
    return {
      r, s: streaks(r, ts, logs, today),
      w: adherence(r, ts, logs, addDays(today, -6), today, today, nowTime),
      m: adherence(r, ts, logs, addDays(today, -29), today, today, nowTime),
    };
  }), [active, times, logs, today, nowTime]);

  // 이번 주(최근 7일) 하루별 달성 평균
  const week = useMemo(() => {
    const vals: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      const p = progress(dayPlan(active, times, logs.filter((l) => l.date === d), d, today, nowTime));
      if (p.total - p.skipped > 0 && (d < today || p.done > 0)) vals.push(p.ratio);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [active, times, logs, today, nowTime]);

  const best = [...rows].sort((a, b) => b.s.current - a.s.current)[0];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 10 }}>
      <Title sub="꾸준함을 한눈에 확인해요">통계</Title>
      {active.length === 0 ? (
        <Empty icon="stats-chart-outline" title="아직 통계가 없어요" text="루틴을 추가하고 체크하면 연속 달성과 달성률이 쌓여요." />
      ) : (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Ring ratio={week ?? 0} main={week === null ? '–' : `${Math.round(week * 100)}%`} sub="최근 7일" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: t.text }}>{week === null ? '체크하면 달성률이 보여요' : week >= 0.8 ? '아주 꾸준해요 👏' : week >= 0.5 ? '조금만 더 힘내요' : '다시 시작해 봐요'}</Text>
              {best && best.s.current > 0 ? <Text style={{ fontSize: 13, color: t.sub }}>🔥 {best.r.name} {best.s.current}{best.s.unit === 'day' ? '일' : '주'} 연속</Text> : null}
            </View>
          </Card>
          <SectionLabel>루틴별</SectionLabel>
          {rows.map(({ r, s, w, m }) => (
            <Pressable key={r.id} onPress={() => router.push({ pathname: '/routine-stats/[id]', params: { id: r.id } })} accessibilityRole="button" accessibilityLabel={`${r.name} 통계`}
              style={{ backgroundColor: t.card, borderRadius: 18, padding: 14, gap: 8, boxShadow: t.shadow }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 20 }}>{r.icon || KIND_ICON[r.kind]}</Text>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: t.text }} numberOfLines={1}>{r.name}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: s.current > 0 ? t.warn : t.faint }}>🔥 {s.current}{s.unit === 'day' ? '일' : '주'}</Text>
                <Ionicons name="chevron-forward" size={16} color={t.faint} />
              </View>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 12, color: t.sub }}>최근 7일</Text><Text style={{ fontSize: 12, fontWeight: '700', color: t.text }}>{w.rate === null ? '–' : `${Math.round(w.rate * 100)}%`}</Text></View>
                <Bar ratio={w.rate ?? 0} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 12, color: t.sub }}>최근 30일</Text><Text style={{ fontSize: 12, fontWeight: '700', color: t.text }}>{m.rate === null ? '–' : `${Math.round(m.rate * 100)}%`}</Text></View>
                <Bar ratio={m.rate ?? 0} color={t.heat2} />
              </View>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}
