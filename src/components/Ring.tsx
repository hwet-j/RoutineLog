import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '../theme';

/** 진행 링 (0~1). 가운데에 큰 글자와 작은 글자 */
export function Ring({ ratio, size = 96, stroke = 10, main, sub, color }: { ratio: number; size?: number; stroke?: number; main: string; sub?: string; color?: string }) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, ratio));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${main} ${sub ?? ''}`}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.heat0} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color ?? (v >= 1 ? t.ok : t.primary)} strokeWidth={stroke} fill="none" strokeDasharray={`${c * v} ${c}`} strokeLinecap="round" />
      </Svg>
      <Text style={{ fontSize: size * 0.24, fontWeight: '800', color: t.text }}>{main}</Text>
      {sub ? <Text style={{ fontSize: size * 0.13, color: t.sub, marginTop: -2 }}>{sub}</Text> : null}
    </View>
  );
}
