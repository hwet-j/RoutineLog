import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { at, fmtDateKo, fmtTimeKo, hhmm, ymd } from '../lib/dates';
import { R, useTheme } from '../theme';

function Box({ label, value, onPress }: { label?: string; value: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label ?? ''} ${value}`}
      style={{ backgroundColor: t.input, borderRadius: R.md, paddingHorizontal: 14, height: 48, justifyContent: 'center' }}>
      {label ? <Text style={{ fontSize: 11, color: t.sub, fontWeight: '700' }}>{label}</Text> : null}
      <Text style={{ fontSize: 16, color: t.text, fontWeight: '700' }}>{value}</Text>
    </Pressable>
  );
}

/** 시각 선택 ('HH:MM') */
export function TimeField({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Box label={label} value={fmtTimeKo(value)} onPress={() => setOpen(true)} />
      {open && (
        <DateTimePicker
          value={at('2026-01-01', value)}
          mode="time"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onValueChange={(_, d) => { setOpen(false); onChange(hhmm(d)); }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}

/** 날짜 선택 ('YYYY-MM-DD') */
export function DateField({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Box label={label} value={fmtDateKo(value)} onPress={() => setOpen(true)} />
      {open && (
        <DateTimePicker
          value={at(value, '12:00')}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onValueChange={(_, d) => { setOpen(false); onChange(ymd(d)); }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}
