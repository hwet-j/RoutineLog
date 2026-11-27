import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card } from '../../components/ui';
import { deleteCorruptFile, getDb, listCorruptFiles } from '../../db';
import { allLogs, restoreBackup, wipeAll } from '../../db/repo';
import { makeBackup, parseBackup } from '../../lib/backup';
import { logsCsv } from '../../lib/csv';
import { ymd } from '../../lib/dates';
import { useRoutines } from '../../store';
import { useTheme } from '../../theme';

async function shareText(name: string, text: string, mime: string) {
  const f = new File(Paths.cache, name);
  f.create({ overwrite: true });
  f.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유할 수 없어요');
  await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: name });
}

export default function BackupScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { routines, times, mutate, refresh } = useRoutines();
  const [busy, setBusy] = useState(false);
  const stamp = ymd(new Date());
  const [corrupt, setCorrupt] = useState<{ name: string; bytes: number }[]>([]);
  useEffect(() => {
    listCorruptFiles().then(setCorrupt).catch(() => {});
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('실패했어요', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  // 화면에는 최근 400일만 올려 두므로, 내보낼 때는 DB 의 전체 기록을 읽는다
  const exportJson = () => run(async () => shareText(`routinelog-backup-${stamp}.json`, JSON.stringify(makeBackup({ routines, times, logs: await allLogs(await getDb()) })), 'application/json'));
  const exportCsv = () => run(async () => shareText(`routinelog-${stamp}.csv`, logsCsv(routines, await allLogs(await getDb())), 'text/csv'));

  const restore = () => run(async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const b = parseBackup(await new File(r.assets[0].uri).text());
    Alert.alert('이 백업으로 복원할까요?', `루틴 ${b.routines.length} · 기록 ${b.logs.length}건\n\n지금 기기의 모든 루틴과 기록이 이 백업으로 교체돼요. (실패하면 전부 원래대로 돌아가요)`, [
      { text: '취소', style: 'cancel' },
      { text: '복원', style: 'destructive', onPress: () => run(async () => { await mutate((db) => restoreBackup(db, b)); Alert.alert('복원했어요'); }) },
    ]);
  });

  const wipe = () => Alert.alert('모든 데이터를 지울까요?', '루틴과 기록이 모두 삭제돼요. 되돌릴 수 없으니 먼저 백업해 두세요.', [
    { text: '취소', style: 'cancel' },
    { text: '지우기', style: 'destructive', onPress: () => run(async () => { await mutate((db) => wipeAll(db)); await refresh(); }) },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>백업 (JSON)</Text>
        <Text style={{ color: t.sub, lineHeight: 19 }}>모든 루틴·복용 시각·기록(메모 포함)을 파일 하나로 내보내요. 다른 폰으로 옮기거나 안전하게 보관할 때 쓰세요.</Text>
        <Button title="백업 파일 내보내기" icon="share-outline" onPress={exportJson} disabled={busy} />
        <Button title="백업에서 복원" kind="soft" icon="download-outline" onPress={restore} disabled={busy} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>CSV (엑셀·구글시트)</Text>
        <Text style={{ color: t.sub, lineHeight: 19 }}>모든 기록을 날짜순 표로 내보내요. 한글이 깨지지 않도록 UTF-8(BOM)로 만들어요.</Text>
        <Button title="CSV 내보내기" kind="soft" icon="document-text-outline" onPress={exportCsv} disabled={busy} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Text style={{ color: t.sub, lineHeight: 19 }}>루틴 {routines.length}개가 저장돼 있어요.</Text>
        <Button title="모든 데이터 지우기" kind="danger" onPress={wipe} disabled={busy} />
      </Card>
      {corrupt.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>손상되어 보존된 데이터 파일</Text>
          <Text style={{ color: t.sub, lineHeight: 19 }}>앱이 열 수 없던 이전 데이터 파일이에요. 지우지 않고 보관해 뒀어요. 필요 없으면 삭제하세요.</Text>
          {corrupt.map((f) => (
            <Button
              key={f.name}
              title={`삭제 · ${f.name.replace('routinelog.db.corrupt-', '')} (${Math.max(1, Math.round(f.bytes / 1024))}KB)`}
              icon="trash-outline"
              onPress={() => Alert.alert('이 파일을 삭제할까요?', '되돌릴 수 없어요.', [
                { text: '취소', style: 'cancel' },
                { text: '삭제', style: 'destructive', onPress: () => run(async () => { await deleteCorruptFile(f.name); setCorrupt(await listCorruptFiles()); }) },
              ])}
              disabled={busy}
            />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
