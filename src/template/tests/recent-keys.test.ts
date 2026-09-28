import {
  RECENT_KEYS_LIMIT,
  normalizeKey,
  orderByRecency,
  prefixMatches,
  touchRecentKey,
} from '../recent-keys';

describe('touchRecentKey()', () => {
  it('moves a key to the front and de-duplicates', () => {
    expect(touchRecentKey(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(touchRecentKey(['a', 'b'], 'd')).toEqual(['d', 'a', 'b']);
    expect(touchRecentKey([], 'x')).toEqual(['x']);
    expect(touchRecentKey(['a'], '')).toEqual(['a']);
  });

  it('bounds the list', () => {
    const list = Array.from({ length: RECENT_KEYS_LIMIT }, (_, i) => `k${i}`);
    const next = touchRecentKey(list, 'new');
    expect(next).toHaveLength(RECENT_KEYS_LIMIT);
    expect(next[0]).toBe('new');
  });
});

describe('orderByRecency()', () => {
  const e = (id: string, added?: string) => ({ id, _dateAdded: added });

  it('prefers MRU order, then newest dateAdded, then A–Z', () => {
    const entries = [e('c'), e('a', '2020-01-01'), e('b', '2024-01-01')];
    expect(orderByRecency(entries, ['c']).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(orderByRecency(entries, []).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(orderByRecency([e('b'), e('a')], []).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('prefixMatches()', () => {
  const entries = [{ id: 'Smith2020' }, { id: 'smith1992' }, { id: 'Jones2019' }];

  it('matches case-insensitively, empty matches everything', () => {
    expect(prefixMatches(entries, 'smi').map((x) => x.id)).toEqual([
      'Smith2020',
      'smith1992',
    ]);
    expect(prefixMatches(entries, 'SMI')).toHaveLength(2);
    expect(prefixMatches(entries, '')).toHaveLength(3);
    expect(prefixMatches(entries, 'zzz')).toHaveLength(0);
  });

  it('normalises diacritics', () => {
    expect(normalizeKey('Césaire')).toBe('cesaire');
    expect(prefixMatches([{ id: 'Césaire1939' }], 'cesaire')).toHaveLength(1);
  });
});
