export const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export type Match<T> = { kind: 'ok'; item: T } | { kind: 'ambiguous'; candidates: T[] } | { kind: 'none' };

/** id 일치 → 이름 완전일치(공백·대소문자 무시) → 유일한 부분일치. 여러 개면 ambiguous */
export function matchByName<T extends { id: string; name: string }>(list: T[], query: string): Match<T> {
  const q = norm(query);
  if (!q) return { kind: 'none' };
  const byId = list.find((x) => x.id === query);
  if (byId) return { kind: 'ok', item: byId };
  const exact = list.filter((x) => norm(x.name) === q);
  if (exact.length === 1) return { kind: 'ok', item: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };
  const part = list.filter((x) => norm(x.name).includes(q));
  if (part.length === 1) return { kind: 'ok', item: part[0] };
  if (part.length > 1) return { kind: 'ambiguous', candidates: part };
  return { kind: 'none' };
}
