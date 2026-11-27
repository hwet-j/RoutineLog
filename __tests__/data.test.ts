import { makeBackup, parseBackup } from '../src/lib/backup';
import { cell, logsCsv } from '../src/lib/csv';
import { matchByName, norm } from '../src/lib/match';
import { log, routine, time } from './helpers';

test('이름 매칭: id → 완전일치 → 유일한 부분일치 → 모호함', () => {
  const list = [{ id: 'a', name: '비타민 D' }, { id: 'b', name: '비타민 C' }, { id: 'c', name: '오메가3' }];
  expect(matchByName(list, 'b')).toMatchObject({ kind: 'ok', item: { id: 'b' } });
  expect(matchByName(list, '비타민d')).toMatchObject({ kind: 'ok', item: { id: 'a' } });
  expect(matchByName(list, ' 오메가 ')).toMatchObject({ kind: 'ok', item: { id: 'c' } });
  const amb = matchByName(list, '비타민');
  expect(amb.kind).toBe('ambiguous');
  expect(matchByName(list, '없음').kind).toBe('none');
  expect(matchByName(list, '  ').kind).toBe('none');
  expect(norm(' A b ')).toBe('ab');
});

test('CSV 셀: 이스케이프와 수식 주입 방지', () => {
  expect(cell('a,b')).toBe('"a,b"');
  expect(cell('say "hi"')).toBe('"say ""hi"""');
  expect(cell('줄\n바꿈')).toBe('"줄\n바꿈"');
  expect(cell('=SUM(A1)')).toBe("'=SUM(A1)");
  expect(cell('-1+2')).toBe("'-1+2");
  expect(cell(-5)).toBe('-5');
  expect(cell(null)).toBe('');
});

test('CSV: BOM, 헤더, 정렬, 삭제된 루틴', () => {
  const r = routine({ unit: 'km', kind: 'habit', name: '러닝' });
  const csv = logsCsv([r], [log({ date: '2026-11-27', value: 5, note: '한강, 저녁' }), log({ date: '2026-11-26', routine_id: 'gone', status: 'skipped' })]);
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toContain('날짜');
  expect(lines[1]).toContain('(삭제된 루틴)');
  expect(lines[1]).toContain('건너뜀');
  expect(lines[2]).toContain('러닝');
  expect(lines[2]).toContain('"한강, 저녁"');
  expect(lines[2]).toContain('km');
});

const snap = () => ({ routines: [routine({ kind: 'medication' })], times: [time('08:00')], logs: [log({ date: '2026-11-27', slot: '08:00', source_ref: 'req1' })] });

test('백업 왕복', () => {
  const b = makeBackup(snap(), new Date(2026, 10, 27));
  const back = parseBackup(JSON.stringify(b));
  expect(back.routines).toEqual(b.routines);
  expect(back.times).toEqual(b.times);
  expect(back.logs).toEqual(b.logs);
});

test('백업 검증: 깨진 JSON, 다른 앱, 새 버전, 외래키, 중복, 값 오류', () => {
  const ok = JSON.parse(JSON.stringify(makeBackup(snap())));
  const bad = (mut: (b: any) => void) => { const b = JSON.parse(JSON.stringify(ok)); mut(b); return () => parseBackup(JSON.stringify(b)); };
  expect(() => parseBackup('{oops')).toThrow(/JSON/);
  expect(bad((b) => { b.app = 'other'; })).toThrow(/백업 파일이 아니/);
  expect(bad((b) => { b.version = 99; })).toThrow(/새로운 버전/);
  expect(bad((b) => { b.logs[0].routine_id = 'nope'; })).toThrow(/존재하지 않는 루틴/);
  expect(bad((b) => { b.times[0].routine_id = 'nope'; })).toThrow(/존재하지 않는 루틴/);
  expect(bad((b) => { b.routines.push(b.routines[0]); })).toThrow(/중복/);
  expect(bad((b) => { b.logs[0].date = '2026-02-30'; })).toThrow(/날짜/);
  expect(bad((b) => { b.logs[0].status = 'maybe'; })).toThrow(/상태/);
  expect(bad((b) => { b.times[0].time = '25:00'; })).toThrow(/시각/);
  expect(bad((b) => { b.routines[0].kind = 'game'; })).toThrow(/종류/);
  expect(bad((b) => { b.routines[0].notify_style = 'loud'; })).toThrow(/알림 방식/);
  expect(bad((b) => { b.logs.push({ ...b.logs[0], id: 'other', source_ref: 'req2' }); })).toThrow(/중복/);
  expect(bad((b) => { b.logs.push({ ...b.logs[0], id: 'other2', slot: null, source_ref: 'req1' }); })).toThrow(/중복/);
  expect(bad((b) => { b.routines[0].weekdays = 999; })).toThrow(/요일/);
});

test('백업: 기본값 보정(옛 필드 누락)', () => {
  const b = JSON.parse(JSON.stringify(makeBackup(snap())));
  delete b.routines[0].notify_style;
  delete b.routines[0].nag_minutes;
  delete b.logs[0].source;
  const back = parseBackup(JSON.stringify(b));
  expect(back.routines[0].notify_style).toBeNull();
  expect(back.logs[0].source).toBe('app');
});
