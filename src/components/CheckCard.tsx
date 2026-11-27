import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { fmtTimeKo } from '../lib/dates';
import type { PlanEntry } from '../lib/schedule';
import { KIND_ICON } from '../lib/types';
import { R, useTheme } from '../theme';

const kindColor = (t: ReturnType<typeof useTheme>, k: string) => (k === 'medication' ? t.med : k === 'supplement' ? t.sup : t.habit);

/** 오늘 화면의 카드 한 장: 복약/영양제는 큰 체크 버튼, 습관은 +/− 와 진행바 */
export function CheckCard({ e, highlight, weekDone, onToggle, onPlus, onMinus, onLong, onOpen }: {
  e: PlanEntry;
  highlight?: boolean;
  /** 주 N회 습관의 이번 주 달성 일수 */
  weekDone?: number;
  onToggle: () => void;
  onPlus: () => void;
  onMinus: () => void;
  onLong: () => void;
  onOpen: () => void;
}) {
  const t = useTheme();
  const r = e.routine;
  const color = r.color ?? kindColor(t, r.kind);
  const done = e.status === 'done';
  const overdue = e.status === 'overdue';
  const skipped = e.status === 'skipped';
  const isCounter = r.kind === 'habit' && r.schedule !== 'weekly_count' && e.target > 1;
  const tag = done ? null : overdue ? { text: '놓쳤어요', c: t.miss } : skipped ? { text: '건너뜀', c: t.faint } : null;

  return (
    <Pressable onPress={onOpen} onLongPress={onLong} delayLongPress={350} accessibilityRole="button" accessibilityLabel={`${r.name} ${done ? '완료' : e.status === 'overdue' ? '놓침' : '대기'}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: R.lg, padding: 14, boxShadow: t.shadow, borderWidth: highlight ? 2 : 0, borderColor: t.primary, opacity: done ? 0.72 : 1 }}>
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 22 }}>{r.icon || KIND_ICON[r.kind]}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: t.text, textDecorationLine: done ? 'line-through' : 'none' }}>{r.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {e.slot ? <Text style={{ fontSize: 13, color: t.sub, fontWeight: '600' }}>{e.label ? `${e.label} ` : ''}{fmtTimeKo(e.slot)}</Text> : null}
          {r.detail ? <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub, flexShrink: 1 }}>{e.slot ? '· ' : ''}{r.detail}</Text> : null}
          {tag ? <Text style={{ fontSize: 12, fontWeight: '800', color: tag.c }}>{tag.text}</Text> : null}
        </View>
        {r.kind === 'habit' && r.schedule === 'weekly_count' ? (
          <Text style={{ fontSize: 12, color: t.sub }}>이번 주 {weekDone ?? 0}/{r.weekly_count ?? 1}일</Text>
        ) : null}
        {isCounter ? (
          <View style={{ height: 6, borderRadius: 6, backgroundColor: t.heat0, overflow: 'hidden', marginTop: 4 }}>
            <View style={{ width: `${Math.min(100, (e.count / e.target) * 100)}%`, height: 6, backgroundColor: done ? t.ok : color }} />
          </View>
        ) : null}
      </View>
      {isCounter ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={onMinus} hitSlop={6} accessibilityLabel="하나 줄이기" style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.input, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="remove" size={20} color={t.text} />
          </Pressable>
          <Text style={{ minWidth: 40, textAlign: 'center', fontSize: 15, fontWeight: '800', color: t.text }}>{e.count}/{e.target}{r.unit ? '' : ''}</Text>
          <Pressable onPress={onPlus} hitSlop={6} accessibilityLabel="하나 늘리기" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: done ? t.ok : color, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onToggle} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={done ? '체크 취소' : '체크'}
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? t.ok : 'transparent', borderWidth: done ? 0 : 2.5, borderColor: overdue ? t.miss : skipped ? t.faint : color }}>
          {done ? <Ionicons name="checkmark" size={28} color="#fff" /> : skipped ? <Ionicons name="remove" size={22} color={t.faint} /> : null}
        </Pressable>
      )}
    </Pressable>
  );
}
