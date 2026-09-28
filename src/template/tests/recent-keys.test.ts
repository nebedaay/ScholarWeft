import {
  LAST_SEARCH_WINDOW_MS,
  RECENT_KEYS_LIMIT,
  getLastSearch,
  getRecentKeys,
  isLastSearchFresh,
  normalizeKey,
  orderByRecency,
  prefixMatches,
  recordLastSearch,
  recordRecentKey,
  touchRecentKey,
  type LastSearchMap,
  type RecentKeysMap,
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

describe('per-note last query', () => {
  const now = 1_000_000;

  it('records and reads back per note', () => {
    const m = recordLastSearch({}, 'A.md', { query: 'social_theory', doubleAt: false }, now);
    expect(getLastSearch(m, 'A.md', now + 1000)?.query).toBe('social_theory');
    expect(getLastSearch(m, 'B.md', now)).toBeNull();
  });

  it('keeps one note\'s entry when another note is queried', () => {
    let m: LastSearchMap = {};
    m = recordLastSearch(m, 'A.md', { query: 'a', doubleAt: false }, now);
    m = recordLastSearch(m, 'B.md', { query: 'b', doubleAt: true }, now + 1000);
    expect(getLastSearch(m, 'A.md', now + 2000)?.query).toBe('a');
    expect(getLastSearch(m, 'B.md', now + 2000)?.doubleAt).toBe(true);
  });

  it('expires after the window', () => {
    const m = recordLastSearch({}, 'A.md', { query: 'a', doubleAt: false }, now);
    expect(isLastSearchFresh(m['A.md'], now + LAST_SEARCH_WINDOW_MS - 1)).toBe(true);
    expect(getLastSearch(m, 'A.md', now + LAST_SEARCH_WINDOW_MS)).toBeNull();
  });

  it('prunes expired entries and caps the map', () => {
    let m: LastSearchMap = {};
    for (let i = 0; i < 30; i++) {
      m = recordLastSearch(m, `N${i}.md`, { query: `q${i}`, doubleAt: false }, now + i);
    }
    expect(Object.keys(m).length).toBeLessThanOrEqual(20);
    expect(getLastSearch(m, 'N29.md', now + 30)?.query).toBe('q29');
  });

  it('does not record an empty query', () => {
    const m = recordLastSearch({}, 'A.md', { query: '', doubleAt: false }, now);
    expect(getLastSearch(m, 'A.md', now)).toBeNull();
  });
});

describe('per-note recent keys', () => {
  it('isolates notes from each other', () => {
    let m: RecentKeysMap = {};
    m = recordRecentKey(m, 'A.md', 'x');
    m = recordRecentKey(m, 'B.md', 'y');
    m = recordRecentKey(m, 'A.md', 'z');
    expect(getRecentKeys(m, 'A.md')).toEqual(['z', 'x']);
    expect(getRecentKeys(m, 'B.md')).toEqual(['y']);
    expect(getRecentKeys(m, 'C.md')).toEqual([]);
  });

  it('caps the number of remembered notes (LRU dropped first)', () => {
    let m: RecentKeysMap = {};
    for (let i = 0; i < 60; i++) m = recordRecentKey(m, `N${i}.md`, 'k');
    expect(Object.keys(m).length).toBeLessThanOrEqual(50);
    expect(getRecentKeys(m, 'N59.md')).toEqual(['k']);
    expect(getRecentKeys(m, 'N0.md')).toEqual([]);
  });

  it('no-ops without a note path', () => {
    expect(Object.keys(recordRecentKey({}, '', 'x'))).toEqual([]);
  });
});
