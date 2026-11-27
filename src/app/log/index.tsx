import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { useRoutines } from '../../store';
import { matchByName } from '../../lib/match';

/** routinelog://log?routine=<id|이름>&date=YYYY-MM-DD → 값이 채워진 기록 추가 화면 (저장은 사용자가) */
export default function LogLink() {
  const p = useLocalSearchParams<{ routine?: string; date?: string; slot?: string }>();
  const { ready, routines } = useRoutines();
  if (!ready) return null;
  const m = p.routine ? matchByName(routines, p.routine) : null;
  return <Redirect href={{ pathname: '/log/[id]', params: { id: 'new', ...(m?.kind === 'ok' ? { routine: m.item.id } : {}), ...(p.date ? { date: p.date } : {}), ...(p.slot ? { slot: p.slot } : {}) } }} />;
}
