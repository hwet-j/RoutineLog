import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bar, Heatmap, Legend } from '../../components/Heat';
import { Button, Card, Empty, SectionLabel } from '../../components/ui';
import { WEEKDAY_KO, addDays, weekStart } from '../../lib/dates';
import { scheduleText } from '../../lib/schedule';
import { adherence, heatmap, weekdayPattern, weeklyValueTotals } from '../../lib/stats';
import { streaks } from '../../lib/streak';
import { KIND_ICON, KIND_LABEL } from '../../lib/types';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 12, color: t.sub, fontWeight: '700' }}>{label}</Text>
      <Text style={{ fontSize: 24, fontWeight: '800', color: t.text }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 12, color: t.faint }}>{sub}</Text> : null}
    </View>
  );
}

export default function RoutineStats() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { routineById, times, logs, today, nowTime } = useRoutines();
  const r = routineById.get(id);
  if (!r) return <View style={{ flex: 1, backgroundColor: t.bg }}><Stack.Screen options={{ title: '루틴 통계' }} /><Empty icon="help-circle-outline" title="루틴을 찾을 수 없어요" /></View>;

  const ts = times.filter((x) => x.routine_id === r.id);
  const s = streaks(r, ts, logs, today);
  const unit = s.unit === 'day' ? '일' : '주';
  const wk = adherence(r, ts, logs, weekStart(today), today, today, nowTime);
  const mo = adherence(r, ts, logs, `${today.slice(0, 8)}01`, today, today, nowTime);
  const d30 = adherence(r, ts, logs, addDays(today, -29), today, today, nowTime);
  const pattern = weekdayPattern(r, ts, logs, today, nowTime, 12);
  const heat = heatmap(r, ts, logs, today, nowTime, 12);
  const vals = weeklyValueTotals(logs, r.id, today, 8);
  const maxVal = Math.max(...vals.map((v) => v.total), 0);
  const notes = logs.filter((l) => l.routine_id === r.id && l.note).slice(0, 5);
  const med = r.kind !== 'habit';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 10 }}>
      <Stack.Screen options={{ title: r.name }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 34 }}>{r.icon || KIND_ICON[r.kind]}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>{r.name}</Text>
          <Text style={{ fontSize: 13, color: t.sub }}>{KIND_LABEL[r.kind]} · {scheduleText(r, times)}</Text>
        </View>
      </View>

      <Card style={{ flexDirection: 'row', gap: 12 }}>
        <Stat label="현재 연속" value={`${s.current}${unit}`} sub={s.unit === 'week' ? `주 ${r.weekly_count}회 달성` : '쉬는 날은 이어져요'} />
        <Stat label="최장 연속" value={`${s.longest}${unit}`} />
      </Card>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Stat label="이번 주" value={pct(wk.rate)} sub={wk.scheduled ? `${wk.done}/${wk.scheduled - wk.skipped}` : undefined} />
          <Stat label="이번 달" value={pct(mo.rate)} sub={mo.scheduled ? `${mo.done}/${mo.scheduled - mo.skipped}` : undefined} />
          <Stat label="최근 30일" value={pct(d30.rate)} />
        </View>
        {med && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: t.text }}>복약 순응도 (30일)</Text>
            <Bar ratio={d30.rate ?? 0} />
            <Text style={{ fontSize: 12, color: t.sub, lineHeight: 18 }}>
              지킨 {d30.done} · 놓침 {d30.missed} · 건너뜀 {d30.skipped}
              {d30.lateRate !== null ? `\n정해진 시각보다 1시간 넘게 늦게 먹은 비율 ${pct(d30.lateRate)} (${d30.late}/${d30.timed})` : ''}
            </Text>
          </View>
        )}
      </Card>

      {r.schedule !== 'weekly_count' && (
        <>
          <SectionLabel>요일별 달성 (최근 12주)</SectionLabel>
          <Card style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130 }}>
            {pattern.map((p, i) => {
              const ratio = p.due ? p.done / p.due : 0;
              return (
                <View key={i} style={{ alignItems: 'center', gap: 4, flex: 1 }}>
                  <Text style={{ fontSize: 11, color: t.sub }}>{p.due ? `${Math.round(ratio * 100)}` : '–'}</Text>
                  <View style={{ width: 20, height: Math.max(4, ratio * 70), borderRadius: 6, backgroundColor: p.due ? t.heat2 : t.heat0 }} />
                  <Text style={{ fontSize: 12, color: t.text, fontWeight: '700' }}>{WEEKDAY_KO[i]}</Text>
                </View>
              );
            })}
          </Card>
        </>
      )}

      <SectionLabel>최근 12주</SectionLabel>
      <Card style={{ gap: 10, alignItems: 'flex-start' }}>
        <Heatmap cols={heat} />
        <Legend />
      </Card>

      {maxVal > 0 && (
        <>
          <SectionLabel>주간 합계 {r.unit ? `(${r.unit})` : ''}</SectionLabel>
          <Card style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 140 }}>
            {vals.map((v) => (
              <View key={v.weekStart} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 10, color: t.sub }}>{v.total || ''}</Text>
                <View style={{ width: '70%', height: Math.max(3, (v.total / maxVal) * 80), borderRadius: 5, backgroundColor: t.heat2 }} />
                <Text style={{ fontSize: 10, color: t.faint }}>{v.weekStart.slice(5)}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {notes.length > 0 && (
        <>
          <SectionLabel>최근 메모</SectionLabel>
          <Card style={{ gap: 10 }}>
            {notes.map((l) => (
              <View key={l.id} style={{ gap: 2 }}>
                <Text style={{ fontSize: 12, color: t.faint }}>{l.date}</Text>
                <Text style={{ fontSize: 15, color: t.text, lineHeight: 21 }}>{l.note}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      <View style={{ gap: 10, marginTop: 8 }}>
        <Button title="기록 직접 추가" kind="soft" icon="create-outline" onPress={() => router.push({ pathname: '/log/[id]', params: { id: 'new', routine: r.id } })} />
        <Button title="루틴 설정" kind="soft" icon="settings-outline" onPress={() => router.push({ pathname: '/routine/[id]', params: { id: r.id } })} />
      </View>
    </ScrollView>
  );
}
