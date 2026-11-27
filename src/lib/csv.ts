import { hhmm, ymd } from './dates';
import { KIND_LABEL, type Log, type Routine } from './types';

const BOM = '﻿';

/** CSV 한 칸: 쉼표·따옴표·줄바꿈 이스케이프, 엑셀 수식 주입 방지(= + - @ 로 시작하면 앞에 ' 를 붙임) */
export function cell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number')) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function logsCsv(routines: Routine[], logs: Log[]): string {
  const byId = new Map(routines.map((r) => [r.id, r]));
  const head = ['날짜', '체크한 시각', '루틴', '종류', '시각(슬롯)', '상태', '횟수', '값', '단위', '메모', '입력 경로'];
  const rows = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.logged_at.localeCompare(b.logged_at)).map((l) => {
    const r = byId.get(l.routine_id);
    const d = new Date(l.logged_at);
    return [
      l.date, Number.isNaN(d.getTime()) ? '' : `${ymd(d)} ${hhmm(d)}`, r?.name ?? '(삭제된 루틴)', r ? KIND_LABEL[r.kind] : '',
      l.slot ?? '', l.status === 'done' ? '완료' : '건너뜀', l.count, l.value, r?.unit ?? '', l.note, l.source === 'assistant' ? '비서' : l.source === 'notification' ? '알림' : '앱',
    ].map(cell).join(',');
  });
  return BOM + [head.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}
