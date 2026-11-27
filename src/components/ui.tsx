import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { R, useTheme } from '../theme';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: R.lg, padding: 16, boxShadow: t.shadow }, style]}>{children}</View>;
}

export function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: t.text }}>{children}</Text>
      {sub ? <Text style={{ fontSize: 14, color: t.sub, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontSize: 13, fontWeight: '800', color: t.sub, marginTop: 18, marginBottom: 8, marginLeft: 4 }}>{children}</Text>;
}

export function Button({ title, onPress, kind = 'primary', disabled, icon }: { title: string; onPress: () => void; kind?: 'primary' | 'soft' | 'danger'; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.primary : kind === 'soft' ? t.primarySoft : 'transparent';
  const fg = kind === 'primary' ? (t.dark ? '#1A0F3A' : '#fff') : kind === 'soft' ? t.primary : t.danger;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title}
      style={{ height: 50, borderRadius: R.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : 1 }}>
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '800', fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, color, small }: { label: string; on?: boolean; onPress?: () => void; color?: string; small?: boolean }) {
  const t = useTheme();
  const c = color ?? t.primary;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={{ paddingHorizontal: small ? 10 : 14, height: small ? 30 : 38, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c : t.input, borderWidth: 1, borderColor: on ? c : t.line }}>
      <Text style={{ color: on ? (t.dark ? '#14102A' : '#fff') : t.text, fontWeight: '700', fontSize: small ? 12 : 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>{label}</Text> : null}
      <TextInput placeholderTextColor={t.faint} {...props} style={[{ backgroundColor: t.input, color: t.text, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 }, props.style]} />
    </View>
  );
}

export function Row({ icon, label, sub, right, onPress, last }: { icon?: keyof typeof Ionicons.glyphMap; label: string; sub?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 10, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: t.line }}>
      {icon ? <Ionicons name={icon} size={20} color={t.sub} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, color: t.text, fontWeight: '600' }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: t.primary }} />;
}

export function Empty({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 32, gap: 8 }}>
      <Ionicons name={icon} size={44} color={t.faint} />
      <Text style={{ fontSize: 17, fontWeight: '800', color: t.text }}>{title}</Text>
      {text ? <Text style={{ fontSize: 14, color: t.sub, textAlign: 'center', lineHeight: 20 }}>{text}</Text> : null}
    </View>
  );
}
