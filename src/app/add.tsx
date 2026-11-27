import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

/** routinelog://add?name=&kind=&times=09:00,21:00&days=1111100&detail= → 값이 채워진 새 루틴 폼 (저장은 사용자가) */
export default function AddLink() {
  const p = useLocalSearchParams<{ name?: string; kind?: string; times?: string; days?: string; detail?: string }>();
  return <Redirect href={{ pathname: '/routine/[id]', params: { id: 'new', ...p } }} />;
}
