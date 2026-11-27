import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TimeField, DateField } from '../../components/Pickers';
import { Button, Card, Chip, Field, Row, SectionLabel, Toggle } from '../../components/ui';
import { duplicateRoutine, insertRoutine, updateRoutine, type RoutineInput, type TimeInput } from '../../db/repo';
import { channelFor } from '../../lib/channels';
import { WEEKDAY_KO, addDays, isTime } from '../../lib/dates';
import { daysToBits, bitsToDays } from '../../lib/schedule';
import { KIND_ICON, KIND_LABEL, STYLE_LABEL, type Kind, type NotifyStyle, type Schedule } from '../../lib/types';
import { permissionState, requestPermission } from '../../notify';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

const COLORS = ['#2563EB', '#16A34A', '#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#CA8A04', '#64748B'];
const PRESETS: { label: string; time: string }[] = [
  { label: '아침', time: '08:00' }, { label: '점심', time: '12:30' }, { label: '저녁', time: '19:00' }, { label: '취침 전', time: '22:30' },
];
const NAGS: (number | null)[] = [null, 5, 10, 15, 30, 60];

function Stepper({ value, min, max, onChange, suffix }: { value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Chip label="−" onPress={() => onChange(Math.max(min, value - 1))} />
      <Text style={{ minWidth: 56, textAlign: 'center', fontSize: 18, fontWeight: '800', color: t.text }}>{value}{suffix ?? ''}</Text>
      <Chip label="＋" onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  );
}

export default function RoutineForm() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ id: string; name?: string; kind?: string; times?: string; days?: string; detail?: string }>();
  const { routines, times: allTimes, today, settings, mutate, removeRoutine, archive } = useRoutines();
  const existing = p.id !== 'new' ? routines.find((r) => r.id === p.id) : undefined;
  const existingTimes = existing ? allTimes.filter((x) => x.routine_id === existing.id) : [];

  // 딥링크(routinelog://add?...)로 넘어온 값으로 미리 채운다. 저장은 사용자가 직접 누른다
  const preKind: Kind = p.kind === 'medication' || p.kind === 'supplement' || p.kind === 'habit' ? p.kind : 'supplement';
  const preTimes = (p.times ?? '').split(',').map((s) => s.trim()).filter(isTime).slice(0, 8);
  const preDays = /^[01]{7}$/.test(p.days ?? '') ? daysToBits([...(p.days as string)].map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0)) : null;

  const [name, setName] = useState(existing?.name ?? (p.name ?? '').slice(0, 100));
  const [kind, setKind] = useState<Kind>(existing?.kind ?? preKind);
  const [detail, setDetail] = useState(existing?.detail ?? (p.detail ?? '').slice(0, 300));
  const [icon, setIcon] = useState(existing?.icon ?? '');
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [schedule, setSchedule] = useState<Schedule>(existing?.schedule ?? (preDays !== null && preDays !== 127 ? 'weekdays' : 'daily'));
  const [days, setDays] = useState<number[]>(bitsToDays(existing?.weekdays ?? preDays ?? 127));
  const [interval, setIntervalDays] = useState(existing?.interval_days ?? 2);
  const [weekly, setWeekly] = useState(existing?.weekly_count ?? 3);
  const [tms, setTms] = useState<TimeInput[]>(existing ? existingTimes.map((x) => ({ time: x.time, label: x.label })) : preTimes.map((time) => ({ time, label: PRESETS.find((q) => q.time === time)?.label ?? null })));
  const [start, setStart] = useState(existing?.start_date ?? today);
  const [end, setEnd] = useState<string | null>(existing?.end_date ?? null);
  const [target, setTarget] = useState(existing?.daily_target ?? 1);
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [reminder, setReminder] = useState(existing ? !!existing.reminder : true);
  const [nag, setNag] = useState<number | null>(existing ? existing.nag_minutes : settings.nagDefault);
  const [style, setStyle] = useState<NotifyStyle | null>(existing?.notify_style ?? null);
  const [saving, setSaving] = useState(false);

  const addTime = (time: string, label: string | null) => setTms((c) => (c.some((x) => x.time === time) ? c : [...c, { time, label }].sort((a, b) => a.time.localeCompare(b.time))));

  const save = async () => {
    if (!name.trim()) return Alert.alert('이름을 입력해 주세요');
    if (schedule === 'weekdays' && days.length === 0) return Alert.alert('요일을 하나 이상 골라 주세요');
    if (end && end < start) return Alert.alert('종료일이 시작일보다 빨라요');
    if (kind !== 'habit' && reminder && tms.length === 0) {
      const go = await new Promise<boolean>((res) => Alert.alert('복용 시각이 없어요', '시각을 넣어야 알림이 와요. 시각 없이 저장할까요?', [{ text: '시각 추가', onPress: () => res(false) }, { text: '그대로 저장', onPress: () => res(true) }]));
      if (!go) return;
    }
    setSaving(true);
    try {
      const input: RoutineInput = {
        name: name.trim(), kind, detail: detail.trim() || null, color, icon: icon.trim() || null, schedule,
        weekdays: schedule === 'weekdays' ? daysToBits(days) : 127,
        interval_days: schedule === 'interval' ? interval : null, weekly_count: schedule === 'weekly_count' ? weekly : null,
        start_date: start, end_date: end, daily_target: kind === 'habit' && schedule !== 'weekly_count' ? target : 1, unit: unit.trim() || null,
        reminder: reminder ? 1 : 0, nag_minutes: reminder ? nag : null, notify_style: style,
      };
      await mutate(async (db) => {
        if (existing) await updateRoutine(db, existing.id, input, tms);
        else await insertRoutine(db, input, tms);
      });
      if (reminder && tms.length) {
        const st = await permissionState();
        if (st === 'undetermined') await requestPermission();
        else if (st === 'denied') Alert.alert('알림 권한이 꺼져 있어요', '설정에서 알림을 허용해야 시간에 맞춰 알려 드릴 수 있어요.', [{ text: '나중에' }, { text: '설정 열기', onPress: () => void Linking.openSettings() }]);
      }
      router.back();
    } catch (e) {
      Alert.alert('저장하지 못했어요', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const accent = color ?? (kind === 'medication' ? t.med : kind === 'supplement' ? t.sup : t.habit);
  const chipRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? '루틴 수정' : '새 루틴' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 6 }} keyboardShouldPersistTaps="handled">
        <View style={chipRow}>
          {(['medication', 'supplement', 'habit'] as Kind[]).map((k) => <Chip key={k} label={`${KIND_ICON[k]} ${KIND_LABEL[k]}`} on={kind === k} onPress={() => setKind(k)} />)}
        </View>
        <SectionLabel>기본 정보</SectionLabel>
        <Card style={{ gap: 14 }}>
          <Field label="이름" value={name} onChangeText={setName} placeholder={kind === 'habit' ? '예: 영어 공부, 러닝' : '예: 비타민D, 혈압약'} maxLength={100} autoFocus={!existing && !p.name} />
          <Field label={kind === 'habit' ? '목표·설명 (선택)' : '복용량·복용 방법 (선택)'} value={detail} onChangeText={setDetail} placeholder={kind === 'habit' ? '예: 하루 30분' : '예: 1정, 식후'} maxLength={300} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 90 }}><Field label="아이콘" value={icon} onChangeText={(s) => setIcon([...s].slice(0, 2).join(''))} placeholder={KIND_ICON[kind]} /></View>
            {kind === 'habit' && schedule !== 'weekly_count' ? <View style={{ flex: 1 }}><Field label="단위 (선택)" value={unit} onChangeText={setUnit} placeholder="분, km, 쪽, 잔…" maxLength={20} /></View> : null}
          </View>
          <View style={chipRow}>
            {COLORS.map((c) => (
              <Pressable key={c} accessibilityRole="button" accessibilityLabel={`색 ${c}`} onPress={() => setColor(color === c ? null : c)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: t.text }} />
            ))}
          </View>
        </Card>

        <SectionLabel>반복</SectionLabel>
        <Card style={{ gap: 14 }}>
          <View style={chipRow}>
            {([['daily', '매일'], ['weekdays', '요일 선택'], ['interval', 'N일마다'], ['weekly_count', '주 N회']] as [Schedule, string][]).map(([k, l]) => (
              <Chip key={k} label={l} on={schedule === k} onPress={() => setSchedule(k)} color={accent} />
            ))}
          </View>
          {schedule === 'weekdays' && (
            <View style={chipRow}>
              {WEEKDAY_KO.map((d, i) => <Chip key={d} label={d} small on={days.includes(i)} onPress={() => setDays((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort()))} color={accent} />)}
            </View>
          )}
          {schedule === 'interval' && (
            <View style={{ gap: 6 }}><Text style={{ color: t.sub, fontSize: 13 }}>시작일부터 몇 일마다 할까요?</Text><Stepper value={interval} min={2} max={90} onChange={setIntervalDays} suffix="일마다" /></View>
          )}
          {schedule === 'weekly_count' && (
            <View style={{ gap: 6 }}><Text style={{ color: t.sub, fontSize: 13 }}>요일은 상관없이 일주일에 몇 번 하면 달성일까요?</Text><Stepper value={weekly} min={1} max={7} onChange={setWeekly} suffix="회" /></View>
          )}
          {kind === 'habit' && schedule !== 'weekly_count' && (
            <View style={{ gap: 6 }}><Text style={{ color: t.sub, fontSize: 13 }}>하루 목표 횟수 (물 8잔처럼 여러 번일 때)</Text><Stepper value={target} min={1} max={50} onChange={setTarget} suffix="번" /></View>
          )}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><DateField label="시작일" value={start} onChange={setStart} /></View>
            <View style={{ flex: 1 }}>{end ? <DateField label="종료일" value={end} onChange={setEnd} /> : <Chip label="종료일 없음 (눌러서 설정)" onPress={() => setEnd(addDays(start, 29))} />}</View>
          </View>
          {end ? <Chip label="종료일 지우기" small onPress={() => setEnd(null)} /> : null}
        </Card>

        <SectionLabel>{kind === 'habit' ? '알림 시각 (선택)' : '복용 시각'}</SectionLabel>
        <Card style={{ gap: 12 }}>
          {tms.map((x, i) => (
            <View key={x.time} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}><TimeField value={x.time} onChange={(v) => setTms((c) => c.map((y, j) => (j === i ? { ...y, time: v } : y)).sort((a, b) => a.time.localeCompare(b.time)))} /></View>
              <View style={{ flex: 1 }}><Field value={x.label ?? ''} onChangeText={(v) => setTms((c) => c.map((y, j) => (j === i ? { ...y, label: v.trim() || null } : y)))} placeholder="이름 (아침…)" maxLength={30} /></View>
              <Chip label="삭제" small onPress={() => setTms((c) => c.filter((_, j) => j !== i))} />
            </View>
          ))}
          <Text style={{ color: t.sub, fontSize: 13 }}>빠르게 추가</Text>
          <View style={chipRow}>
            {PRESETS.map((q) => <Chip key={q.time} label={`${q.label} ${q.time}`} small onPress={() => addTime(q.time, q.label)} />)}
          </View>
          <TimeField label="직접 시각 추가" value="09:00" onChange={(v) => addTime(v, null)} />
        </Card>

        <SectionLabel>알림</SectionLabel>
        <Card style={{ gap: 4 }}>
          <Row icon="notifications-outline" label="알림 받기" right={<Toggle value={reminder} onChange={setReminder} />} last={!reminder} />
          {reminder && (
            <View style={{ gap: 14, paddingTop: 10 }}>
              <View style={{ gap: 8 }}>
                <Text style={{ color: t.sub, fontSize: 13, fontWeight: '700' }}>알림 방식</Text>
                <View style={chipRow}>
                  <Chip label={`기본값 (${STYLE_LABEL[settings.notifyStyle]})`} small on={style === null} onPress={() => setStyle(null)} />
                  {(['sound', 'vibrate', 'silent'] as NotifyStyle[]).map((s) => <Chip key={s} label={STYLE_LABEL[s]} small on={style === s} onPress={() => setStyle(s)} />)}
                </View>
                <Text style={{ color: t.faint, fontSize: 12, lineHeight: 17 }}>소리: 소리+진동 · 진동: 소리 없이 진동만 · 조용히: 알림창에만 표시. 알림이 기대와 다르면 시스템 알림 설정에서 「{channelFor(style ?? settings.notifyStyle)}」 채널을 확인해 보세요.</Text>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ color: t.sub, fontSize: 13, fontWeight: '700' }}>안 했으면 다시 알림</Text>
                <View style={chipRow}>{NAGS.map((n) => <Chip key={String(n)} label={n === null ? '없음' : `${n}분 뒤`} small on={nag === n} onPress={() => setNag(n)} />)}</View>
              </View>
            </View>
          )}
        </Card>

        <View style={{ gap: 10, marginTop: 16 }}>
          <Button title={saving ? '저장 중…' : '저장'} onPress={save} disabled={saving} />
          {existing && (
            <>
              <Button title="복제" kind="soft" icon="copy-outline" onPress={async () => { await mutate((db) => duplicateRoutine(db, existing, existingTimes)); router.back(); }} />
              <Button title={existing.archived ? '다시 사용' : '보관 (알림 멈춤, 기록 유지)'} kind="soft" onPress={async () => { await archive(existing, !existing.archived); router.back(); }} />
              <Button title="삭제" kind="danger" onPress={() => Alert.alert('루틴을 삭제할까요?', '이 루틴의 모든 기록도 함께 지워져요.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: async () => { await removeRoutine(existing); router.dismissTo('/'); } }])} />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
