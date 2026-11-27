import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckCard } from '../../components/CheckCard';
import { Ring } from '../../components/Ring';
import { Button, Chip, Empty } from '../../components/ui';
import { addDays, fmtDateKo, isDate } from '../../lib/dates';
import { dayPlan, progress, weekDoneDays, type PlanEntry } from '../../lib/schedule';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

const entryKey = (e: PlanEntry, date: string) => `${e.routine.id}:${date}:${e.slot ?? ''}`;

export default function TodayScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ date?: string; highlight?: string }>();
  const { ready, routines, times, logs, today, nowTime, checkSlot, uncheckSlot, habitAdd, habitRemove } = useRoutines();
  const [date, setDate] = useState<string>(() => (isDate(p.date) ? p.date : today));
  const [hl, setHl] = useState<string | null>(null);

  // 알림을 눌러 들어오면 그 날짜·카드를 강조 (4초)
  useEffect(() => {
    if (isDate(p.date)) setDate(p.date);
    if (typeof p.highlight === 'string' && p.highlight) {
      setHl(p.highlight);
      const h = setTimeout(() => setHl(null), 4000);
      return () => clearTimeout(h);
    }
  }, [p.date, p.highlight]);

  const active = useMemo(() => routines.filter((r) => !r.archived), [routines]);
  const plan = useMemo(() => dayPlan(active, times, logs, date, today, nowTime), [active, times, logs, date, today, nowTime]);
  const prog = progress(plan);
  const isToday = date === today;
  const remaining = prog.total - prog.done - prog.skipped;

  const toggle = (e: PlanEntry) => {
    const r = e.routine;
    if (r.kind === 'habit') {
      // 주 N회 습관: 오늘 했어요 / 취소
      const done = e.logs.find((l) => l.status === 'done');
      if (done) void uncheckSlot(r, done);
      else void habitAdd(r, date);
      return;
    }
    const done = e.logs.find((l) => l.status === 'done');
    if (done) void uncheckSlot(r, done);
    else void checkSlot(r, date, e.slot);
  };

  const longMenu = (e: PlanEntry) => {
    const r = e.routine;
    const hasLog = e.logs[0];
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (r.kind !== 'habit' && e.status !== 'done') {
      buttons.push(e.status === 'skipped' ? { text: '건너뜀 취소', onPress: () => hasLog && void uncheckSlot(r, hasLog) } : { text: '오늘은 건너뛰기', onPress: () => void checkSlot(r, date, e.slot, 'skipped') });
    }
    buttons.push({ text: r.kind === 'habit' ? '메모·값 함께 기록' : '메모 남기기', onPress: () => router.push({ pathname: '/log/[id]', params: { id: 'new', routine: r.id, date, ...(e.slot ? { slot: e.slot } : {}) } }) });
    if (hasLog) buttons.push({ text: '기록 보기·수정', onPress: () => router.push({ pathname: '/log/[id]', params: { id: hasLog.id } }) });
    buttons.push({ text: '루틴 설정', onPress: () => router.push({ pathname: '/routine/[id]', params: { id: r.id } }) });
    buttons.push({ text: '닫기', style: 'cancel' });
    Alert.alert(r.name, e.slot ? `${date} ${e.slot}` : date, buttons);
  };

  if (!ready) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: insets.bottom + 110, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Pressable onPress={() => setDate(addDays(date, -1))} hitSlop={10} accessibilityLabel="전날" style={{ padding: 6 }}>
            <Ionicons name="chevron-back" size={24} color={t.text} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>{fmtDateKo(date)}</Text>
            <Text style={{ fontSize: 12, color: t.sub }}>{isToday ? '오늘' : date < today ? '지난 날 · 빠뜨린 체크를 채울 수 있어요' : '앞으로의 날'}</Text>
          </View>
          <Pressable onPress={() => setDate(addDays(date, 1))} hitSlop={10} accessibilityLabel="다음 날" style={{ padding: 6 }}>
            <Ionicons name="chevron-forward" size={24} color={t.text} />
          </Pressable>
        </View>
        {!isToday && (
          <View style={{ alignSelf: 'center' }}>
            <Chip label="오늘로" onPress={() => setDate(today)} on />
          </View>
        )}

        {routines.length === 0 ? (
          <View style={{ gap: 16 }}>
            <Empty icon="medkit-outline" title="아직 루틴이 없어요" text={'복용하는 약·영양제나\n꾸준히 하고 싶은 습관을 추가해 보세요.'} />
            <Button title="첫 루틴 추가" icon="add" onPress={() => router.push({ pathname: '/routine/[id]', params: { id: 'new' } })} />
          </View>
        ) : plan.length === 0 ? (
          <Empty icon="cafe-outline" title="이 날은 쉬는 날이에요" text="해야 할 루틴이 없어요. 루틴 탭에서 스케줄을 확인할 수 있어요." />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, backgroundColor: t.card, borderRadius: 20, padding: 16, boxShadow: t.shadow }}>
              <Ring ratio={prog.ratio} main={`${prog.done}/${prog.total - prog.skipped}`} sub="완료" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>
                  {prog.total - prog.skipped === 0 ? '오늘은 건너뛰었어요' : remaining <= 0 ? '모두 완료했어요 🎉' : isToday ? `${remaining}개 남았어요` : `${remaining}개 비어 있어요`}
                </Text>
                <Text style={{ fontSize: 13, color: t.sub, lineHeight: 19 }}>
                  {plan.some((e) => e.status === 'overdue') ? `놓친 것 ${plan.filter((e) => e.status === 'overdue').length}개 — 지금 체크하면 늦게 한 시각으로 기록돼요` : '카드를 길게 누르면 건너뛰기·메모를 할 수 있어요'}
                </Text>
              </View>
            </View>
            {plan.map((e) => (
              <CheckCard
                key={entryKey(e, date)}
                e={e}
                highlight={hl === entryKey(e, date)}
                weekDone={e.routine.schedule === 'weekly_count' ? weekDoneDays(e.routine, logs, date) : undefined}
                onToggle={() => toggle(e)}
                onPlus={() => void habitAdd(e.routine, date)}
                onMinus={() => void habitRemove(e.routine, date)}
                onLong={() => longMenu(e)}
                onOpen={() => router.push({ pathname: '/routine-stats/[id]', params: { id: e.routine.id } })}
              />
            ))}
          </>
        )}
      </ScrollView>
      <Pressable
        onPress={() => router.push({ pathname: '/log/[id]', params: { id: 'new', date } })} accessibilityRole="button" accessibilityLabel="기록 직접 추가"
        style={{ position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
        <Ionicons name="create-outline" size={26} color={t.dark ? '#14102A' : '#fff'} />
      </Pressable>
    </View>
  );
}
