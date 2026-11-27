import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField, TimeField } from '../../components/Pickers';
import { Button, Card, Chip, Field, SectionLabel } from '../../components/ui';
import { updateLog, upsertLog } from '../../db/repo';
import { at, fmtTimeKo, hhmm, isDate, isTime } from '../../lib/dates';
import { KIND_ICON } from '../../lib/types';
import { cancelSlot } from '../../notify';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

/** 기록 추가/수정. 습관은 횟수·값·메모(어떤 걸 했는지), 복약은 시각(슬롯)·먹은 시각·메모 */
export default function LogForm() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ id: string; routine?: string; date?: string; slot?: string }>();
  const { routines, logs, times, today, mutate, removeLog } = useRoutines();
  const existing = p.id !== 'new' ? logs.find((l) => l.id === p.id) : undefined;
  const live = routines.filter((r) => !r.archived || r.id === existing?.routine_id);

  const [routineId, setRoutineId] = useState(existing?.routine_id ?? (live.find((r) => r.id === p.routine)?.id ?? live[0]?.id ?? ''));
  const [date, setDate] = useState(existing?.date ?? (isDate(p.date) ? p.date : today));
  const [slot, setSlot] = useState<string | null>(existing ? existing.slot : isTime(p.slot) ? p.slot : null);
  const [status, setStatus] = useState<'done' | 'skipped'>(existing?.status ?? 'done');
  const [count, setCount] = useState(existing?.count ?? 1);
  const [value, setValue] = useState(existing?.value != null ? String(existing.value) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [checkedTime, setCheckedTime] = useState(() => {
    if (existing) {
      const d = new Date(existing.logged_at);
      if (!Number.isNaN(d.getTime())) return hhmm(d);
    }
    return hhmm(new Date());
  });
  const [timeTouched, setTimeTouched] = useState(false);

  const r = routines.find((x) => x.id === routineId);
  const slots = r ? times.filter((x) => x.routine_id === r.id).sort((a, b) => a.time.localeCompare(b.time)) : [];
  const isHabit = r?.kind === 'habit';

  const save = async () => {
    if (!r) return Alert.alert('루틴을 선택해 주세요');
    const num = value.trim() === '' ? null : Number(value.replace(/,/g, ''));
    if (num !== null && !Number.isFinite(num)) return Alert.alert('값은 숫자로 입력해 주세요');
    setSaving(true);
    try {
      const loggedAt = timeTouched || !existing ? (timeTouched ? at(date, checkedTime) : new Date()).toISOString() : undefined;
      await mutate(async (db) => {
        if (existing) {
          await updateLog(db, existing.id, { status, count: isHabit ? count : 1, value: num, note: note.trim() || null, date, ...(loggedAt ? { logged_at: loggedAt } : {}) });
        } else {
          await upsertLog(db, { routine_id: r.id, date, slot: isHabit ? null : slot, status, count: isHabit ? count : 1, value: num, note: note.trim() || null, logged_at: loggedAt, source: 'app' });
        }
      });
      if (!isHabit && slot) void cancelSlot(r.id, date, slot);
      router.back();
    } catch (e) {
      Alert.alert('저장하지 못했어요', /UNIQUE/i.test(String(e)) ? '이미 같은 시각의 체크가 있어요' : e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!existing && live.length === 0) {
    return <View style={{ flex: 1, backgroundColor: t.bg, padding: 24 }}><Stack.Screen options={{ title: '기록 추가' }} /><Text style={{ color: t.sub }}>먼저 루틴을 추가해 주세요.</Text></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? '기록 수정' : '기록 추가' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 6 }} keyboardShouldPersistTaps="handled">
        {!existing && (
          <>
            <SectionLabel>루틴</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {live.map((x) => <Chip key={x.id} label={`${x.icon || KIND_ICON[x.kind]} ${x.name}`} on={routineId === x.id} onPress={() => { setRoutineId(x.id); setSlot(null); }} />)}
            </View>
          </>
        )}
        {existing && r ? <Text style={{ fontSize: 20, fontWeight: '800', color: t.text, marginBottom: 6 }}>{r.icon || KIND_ICON[r.kind]} {r.name}</Text> : null}

        <SectionLabel>언제</SectionLabel>
        <Card style={{ gap: 12 }}>
          <DateField label="날짜" value={date} onChange={setDate} />
          {!isHabit && slots.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>복용 시각 (슬롯)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {slots.map((x) => <Chip key={x.id} small label={`${x.label ? `${x.label} ` : ''}${fmtTimeKo(x.time)}`} on={slot === x.time} onPress={() => setSlot(slot === x.time ? null : x.time)} />)}
              </View>
            </View>
          )}
          {!isHabit && <TimeField label={existing ? '실제로 체크한 시각' : '실제로 먹은 시각'} value={checkedTime} onChange={(v) => { setCheckedTime(v); setTimeTouched(true); }} />}
        </Card>

        <SectionLabel>상태</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="완료" on={status === 'done'} onPress={() => setStatus('done')} />
          <Chip label="건너뜀" on={status === 'skipped'} onPress={() => setStatus('skipped')} />
        </View>

        {isHabit && (
          <>
            <SectionLabel>얼마나 했나요</SectionLabel>
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Chip label="−" onPress={() => setCount(Math.max(0, count - 1))} />
                <Text style={{ minWidth: 60, textAlign: 'center', fontSize: 18, fontWeight: '800', color: t.text }}>{count}번</Text>
                <Chip label="＋" onPress={() => setCount(count + 1)} />
              </View>
              <Field label={`값 (선택${r?.unit ? `, ${r.unit}` : ''})`} value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={r?.unit ? `예: 5 (${r.unit})` : '예: 30'} />
            </Card>
          </>
        )}

        <SectionLabel>메모 — 어떤 걸 했는지</SectionLabel>
        <Field value={note} onChangeText={setNote} placeholder={isHabit ? '예: 영어 쉐도잉 30분 · 단어 20개' : '예: 식후에 먹음, 속이 약간 쓰림'} multiline maxLength={1000} style={{ minHeight: 100, textAlignVertical: 'top' }} />

        <View style={{ gap: 10, marginTop: 16 }}>
          <Button title={saving ? '저장 중…' : '저장'} onPress={save} disabled={saving} />
          {existing && <Button title="삭제" kind="danger" onPress={() => Alert.alert('기록을 삭제할까요?', undefined, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: async () => { await removeLog(existing); router.back(); } }])} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
