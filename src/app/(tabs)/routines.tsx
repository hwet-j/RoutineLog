import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Empty, SectionLabel, Title } from '../../components/ui';
import { scheduleText } from '../../lib/schedule';
import { streaks } from '../../lib/streak';
import { KIND_ICON, KIND_LABEL, STYLE_LABEL, type Kind, type Routine } from '../../lib/types';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

export default function RoutinesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { routines, times, logs, today, settings, archive } = useRoutines();
  const [showArchived, setShowArchived] = useState(false);
  const active = routines.filter((r) => !r.archived);
  const archived = routines.filter((r) => r.archived);

  const card = (r: Routine) => {
    const s = streaks(r, times.filter((x) => x.routine_id === r.id), logs, today);
    const color = r.color ?? (r.kind === 'medication' ? t.med : r.kind === 'supplement' ? t.sup : t.habit);
    return (
      <Pressable key={r.id} onPress={() => router.push({ pathname: '/routine/[id]', params: { id: r.id } })} accessibilityRole="button" accessibilityLabel={`${r.name} 수정`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 18, padding: 14, boxShadow: t.shadow, opacity: r.archived ? 0.6 : 1 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22 }}>{r.icon || KIND_ICON[r.kind]}</Text></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: t.text }} numberOfLines={1}>{r.name}</Text>
          <Text style={{ fontSize: 13, color: t.sub }} numberOfLines={1}>{scheduleText(r, times)}{r.detail ? ` · ${r.detail}` : ''}</Text>
          <Text style={{ fontSize: 12, color: t.faint }}>
            {r.reminder ? `🔔 ${STYLE_LABEL[r.notify_style ?? settings.notifyStyle]}${r.nag_minutes ? ` · ${r.nag_minutes}분 뒤 재알림` : ''}` : '🔕 알림 꺼짐'}
            {r.end_date ? ` · ${r.end_date.slice(5)}까지` : ''}
          </Text>
        </View>
        {!r.archived && s.current > 0 ? <Text style={{ fontSize: 13, fontWeight: '800', color: t.warn }}>🔥 {s.current}{s.unit === 'day' ? '일' : '주'}</Text> : null}
        {r.archived ? <Chip small label="다시 사용" onPress={() => void archive(r, false)} /> : <Ionicons name="chevron-forward" size={18} color={t.faint} />}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: insets.bottom + 110, gap: 8 }}>
        <Title sub="복약·영양제·습관을 관리해요">루틴</Title>
        {routines.length === 0 ? (
          <View style={{ gap: 16 }}>
            <Empty icon="medkit-outline" title="루틴을 만들어 보세요" text={'약 먹는 시간, 영양제, 운동·영어 공부 같은\n작은 반복을 정해 두면 알려 드려요.'} />
            <Button title="루틴 추가" icon="add" onPress={() => router.push({ pathname: '/routine/[id]', params: { id: 'new' } })} />
          </View>
        ) : (
          (['medication', 'supplement', 'habit'] as Kind[]).map((k) => {
            const list = active.filter((r) => r.kind === k);
            return list.length ? <View key={k} style={{ gap: 8 }}><SectionLabel>{KIND_ICON[k]} {KIND_LABEL[k]}</SectionLabel>{list.map(card)}</View> : null;
          })
        )}
        {archived.length > 0 && (
          <View style={{ gap: 8 }}>
            <Pressable onPress={() => setShowArchived((v) => !v)} accessibilityRole="button"><SectionLabel>보관함 {archived.length}개 {showArchived ? '▲' : '▼'}</SectionLabel></Pressable>
            {showArchived && archived.map(card)}
          </View>
        )}
      </ScrollView>
      <Pressable onPress={() => router.push({ pathname: '/routine/[id]', params: { id: 'new' } })} accessibilityRole="button" accessibilityLabel="루틴 추가"
        style={{ position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
        <Ionicons name="add" size={32} color={t.dark ? '#14102A' : '#fff'} />
      </Pressable>
    </View>
  );
}
