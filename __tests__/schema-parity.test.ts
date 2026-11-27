import fs from 'fs';
import path from 'path';

import { SCHEMA_V1 } from '../src/db/schema';

/**
 * 앱의 DDL(src/db/schema.ts)과 비서 제공자의 Python 참조 스키마(tests/provider/schema.py)가
 * 같은 테이블·컬럼·인덱스를 갖는지 확인한다 (제공자는 앱이 만든 같은 SQLite 파일을 연다).
 */
const norm = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/IF NOT EXISTS /gi, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').replace(/ ?([(),]) ?/g, '$1').trim())
    .filter(Boolean)
    .filter((s) => !/^CREATE INDEX times_routine/.test(s)) // 앱 전용 보조 인덱스
    .sort();

test('앱 스키마 = 제공자 참조 스키마', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', 'tests', 'provider', 'schema.py'), 'utf8');
  const m = /SCHEMA = """([\s\S]*?)"""/.exec(py);
  expect(m).not.toBeNull();
  expect(norm(SCHEMA_V1)).toEqual(norm(m![1]));
});
