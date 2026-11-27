import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthGrid } from '../../components/MonthGrid';
import { Chip, Empty, Field, Title } from '../../components/ui';
import { getDb } from '../../db';
import { listLogs } from '../../db/repo';
import { addDays, fmtDateKo, fmtTimeKo, hhmm } from '../../lib/dates';
import { cell, dayRatio } from '../../lib/stats';
import { KIND_ICON, type Log } from '../../lib/types';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

const RANGES: { id: '7' | '30' | '90' | 'all'; label: string; days: number | null }[] = [
  { id: '7', label: '7일', days: 7 }, { id: '30', label: '30일', days: 30 }, { id: '90', label: '90일', days: 90 }, { id: 'all', label: '전체', days: null },
];

export default function HistoryScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { routines, times, logs, today, nowTime, routineById } = useRoutines();
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('30');
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [showCal, setShowCal] = useState(false);
  const [rows, setRows] = useState<Log[]>([]);
  const [version, setVersion] = useState(0);

  useFocusEffect(useCallback(() => { setVersion((v) => v + 1); }, []));
  useEffect(() => { const h = setTimeout(() => setDebounced(text.trim()), 250); return () => clearTimeout(h); }, [text]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDb();
      const days = RANGES.find((r) => r.id === range)?.days ?? null;
      const q = day ? { from: day, to: day } : { from: days ? addDays(today, -days + 1) : undefined };
      const res = await listLogs(db, { ...q, routineId: routineId ?? undefined, text: debounced || undefined, limit: 600 });
      if (!cancelled) setRows(res);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [routineId, debounced, range, day, today, logs, version]);

  const sections = useMemo(() => {
    const out: { date: string; data: Log[] }[] = [];
    for (const l of rows) {
      const last = out[out.length - 1];
      if (last && last.date === l.date) last.data.push(l);
      else out.push({ date: l.date, data: [l] });
    }
    return out;
  }, [rows]);

  const sel = routineId ? routineById.get(routineId) : undefined;
  const ratio = (d: string) => {
    if (sel) {
      const c = cell(sel, times, logs.filter((l) => l.routine_id === sel.id), d, today, nowTime);
      return c.state === 'none' || c.state === 'future' ? null : c.ratio;
    }
    return dayRatio(routines, times, logs, d, today, nowTime);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SectionList
        sections={sections}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: insets.bottom + 100, gap: 8 }}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <Title sub="체크한 기록과 메모를 일지처럼 모아 봐요">기록</Title>
            <Field value={text} onChangeText={setText} placeholder="메모·루틴 이름으로 검색" returnKeyType="search" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="전체 루틴" small on={routineId === null} onPress={() => setRoutineId(null)} />
              {routines.filter((r) => !r.archived).map((r) => <Chip key={r.id} label={`${r.icon || KIND_ICON[r.kind]} ${r.name}`} small on={routineId === r.id} onPress={() => setRoutineId(routineId === r.id ? null : r.id)} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {RANGES.map((r) => <Chip key={r.id} label={r.label} small on={!day && range === r.id} onPress={() => { setDay(null); setRange(r.id); }} />)}
              <Chip label={showCal ? '달력 접기' : '달력'} small on={showCal} onPress={() => setShowCal((v) => !v)} />
              {day ? <Chip label={`${day.slice(5)} ✕`} small on onPress={() => setDay(null)} /> : null}
            </View>
            {showCal && (
              <MonthGrid month={month} ratio={ratio} selected={day} today={today} onSelect={setDay}
                onMonth={(d) => { const [y, m] = month.split('-').map(Number); const n = new Date(y, m - 1 + d, 1); setMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`); }} />
            )}
          </View>
        }
        ListEmptyComponent={<Empty icon="book-outline" title="기록이 없어요" text={routines.length ? '오늘 탭에서 체크하면 여기에 쌓여요.\n오른쪽 아래 버튼으로 직접 기록을 적을 수도 있어요.' : '먼저 루틴을 추가해 보세요.'} />}
        renderSectionHeader={({ section }) => <Text style={{ fontSize: 13, fontWeight: '800', color: t.sub, marginTop: 14, marginBottom: 2, marginLeft: 4 }}>{fmtDateKo(section.date)}</Text>}
        renderItem={({ item: l }) => {
          const r = routineById.get(l.routine_id);
          const d = new Date(l.logged_at);
          return (
            <Pressable onPress={() => router.push({ pathname: '/log/[id]', params: { id: l.id } })} accessibilityRole="button"
              style={{ backgroundColor: t.card, borderRadius: 16, padding: 14, gap: 4, boxShadow: t.shadow }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 18 }}>{r?.icon || (r ? KIND_ICON[r.kind] : '•')}</Text>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: t.text }} numberOfLines={1}>{r?.name ?? '(삭제된 루틴)'}</Text>
                <Text style={{ fontSize: 12, fontWeight: '800', color: l.status === 'done' ? t.ok : t.faint }}>{l.status === 'done' ? '완료' : '건너뜀'}</Text>
              </View>
              <Text style={{ fontSize: 13, color: t.sub }}>
                {Number.isNaN(d.getTime()) ? '' : `${fmtTimeKo(hhmm(d))} 체크`}{l.slot ? ` · ${fmtTimeKo(l.slot)} 슬롯` : ''}
                {l.count > 1 ? ` · ${l.count}번` : ''}{l.value != null ? ` · ${l.value}${r?.unit ?? ''}` : ''}{l.source === 'assistant' ? ' · 비서' : l.source === 'notification' ? ' · 알림' : ''}
              </Text>
              {l.note ? <Text style={{ fontSize: 15, color: t.text, lineHeight: 21 }}>{l.note}</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
