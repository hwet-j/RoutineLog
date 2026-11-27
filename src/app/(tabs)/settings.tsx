import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TimeField } from '../../components/Pickers';
import { Button, Card, Chip, Row, SectionLabel, Title, Toggle } from '../../components/ui';
import { CHANNELS } from '../../lib/channels';
import { STYLE_LABEL, type NotifyStyle } from '../../lib/types';
import { permissionState, requestPermission, reschedule, sendTest, type PermState } from '../../notify';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

const NAGS: (number | null)[] = [null, 5, 10, 15, 30];

export default function SettingsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const snap = useRoutines();
  const { settings, setSetting } = snap;
  const [perm, setPerm] = useState<PermState>('undetermined');
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setPerm(await permissionState());
    const all = await Notifications.getAllScheduledNotificationsAsync();
    setCount(all.filter((n) => (n.content.data as { type?: string } | null)?.type === 'routine').length);
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const test = async (style: NotifyStyle) => {
    if (!(await requestPermission())) return Alert.alert('알림 권한이 필요해요', '권한을 허용하면 테스트 알림을 보낼 수 있어요.', [{ text: '닫기' }, { text: '설정 열기', onPress: () => void Linking.openSettings() }]);
    await sendTest(style);
    Alert.alert('3초 뒤에 알림이 와요', `${STYLE_LABEL[style]} 방식(${CHANNELS[style].description})을 확인해 보세요.\n홈 화면으로 나가 있어도 돼요.`);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 8 }}>
      <Title>설정</Title>

      <SectionLabel>알림</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Row icon={perm === 'granted' ? 'checkmark-circle' : 'alert-circle'} label={perm === 'granted' ? '알림 허용됨' : perm === 'denied' ? '알림이 꺼져 있어요' : '알림 권한이 필요해요'}
          sub={perm === 'granted' ? (count === null ? '' : `예약된 알림 ${count}개 (앞으로 14일)`) : '시간에 맞춰 알려 드리려면 알림을 허용해야 해요'} last />
        {perm !== 'granted' && (
          <Button title={perm === 'denied' ? '시스템 설정에서 허용' : '알림 허용하기'} onPress={async () => { if (perm === 'denied') void Linking.openSettings(); else { await requestPermission(); await refresh(); } }} />
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>기본 알림 방식</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['sound', 'vibrate', 'silent'] as NotifyStyle[]).map((s) => <Chip key={s} label={STYLE_LABEL[s]} on={settings.notifyStyle === s} onPress={() => void setSetting('notifyStyle', s)} />)}
        </View>
        <Text style={{ fontSize: 13, color: t.sub, lineHeight: 19 }}>{CHANNELS[settings.notifyStyle].description}. 루틴마다 따로 정할 수도 있어요.</Text>
        <Button title={`${STYLE_LABEL[settings.notifyStyle]} 방식으로 테스트 알림`} kind="soft" icon="notifications-outline" onPress={() => void test(settings.notifyStyle)} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['sound', 'vibrate', 'silent'] as NotifyStyle[]).filter((s) => s !== settings.notifyStyle).map((s) => <View key={s} style={{ flex: 1 }}><Button title={`${STYLE_LABEL[s]} 미리 듣기`} kind="soft" onPress={() => void test(s)} /></View>)}
        </View>
        <Text style={{ fontSize: 12, color: t.faint, lineHeight: 17 }}>소리나 진동이 기대와 다르면 시스템 설정 → 알림에서 「루틴 알림」 채널을 확인해 주세요. (시스템에서 바꾼 값이 우선돼요)</Text>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>새 루틴의 기본 재알림</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{NAGS.map((n) => <Chip key={String(n)} small label={n === null ? '없음' : `${n}분 뒤`} on={settings.nagDefault === n} onPress={() => void setSetting('nagDefault', n)} />)}</View>
        <Row icon="alarm-outline" label="정확한 시각에 알림 (알람 방식)" sub="켜면 시간이 더 정확하지만 상태바에 알람 아이콘이 보이고 '다음 알람'에 표시될 수 있어요" last
          right={<Toggle value={settings.exactAlarm} onChange={(v) => void setSetting('exactAlarm', v)} />} />
        <Button title="알림 다시 예약" kind="soft" onPress={async () => { const r = await reschedule(snap, { defaultStyle: settings.notifyStyle, exact: settings.exactAlarm }); await refresh(); Alert.alert('다시 예약했어요', `추가 ${r.added} · 취소 ${r.cancelled}`); }} />
      </Card>

      <SectionLabel>하루</SectionLabel>
      <Card style={{ gap: 10 }}>
        <TimeField label="하루 시작 시각" value={settings.dayStart} onChange={(v) => void setSetting('dayStart', v)} />
        <Text style={{ fontSize: 12, color: t.faint, lineHeight: 17 }}>이 시각 전에 한 체크는 전날 기록으로 쳐요. 야식·야근이 잦다면 새벽 4시쯤으로 바꿔 보세요. 기본은 자정(00:00)이에요.</Text>
      </Card>

      <SectionLabel>데이터</SectionLabel>
      <Card><Row icon="cloud-download-outline" label="백업 · 복원 · CSV 내보내기" sub="모든 루틴과 기록을 파일로" onPress={() => router.push('/settings/backup')} last /></Card>

      <SectionLabel>비서 연동</SectionLabel>
      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, color: t.text, lineHeight: 21 }}>비서 앱에서 「비타민D 먹었어」, 「오늘 영어 공부 했어」라고 말하면 이 앱을 열지 않고 바로 체크돼요. 오늘 안 먹은 약도 물어볼 수 있어요.{'\n'}새 루틴 추가는 비서가 입력 화면만 열어 주고 저장은 직접 눌러요(알림 예약이 앱에서 이뤄져서예요).</Text>
        <Text style={{ fontSize: 12, color: t.faint }}>비서가 체크한 기록은 앱으로 돌아올 때 반영되고, 체크한 슬롯의 남은 알림은 취소돼요.</Text>
      </Card>

      <Text style={{ textAlign: 'center', color: t.faint, fontSize: 12, marginTop: 12 }}>RoutineLog {Constants.expoConfig?.version ?? ''}</Text>
    </ScrollView>
  );
}
