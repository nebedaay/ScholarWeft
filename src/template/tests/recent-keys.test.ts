import {
  LAST_SEARCH_WINDOW_MS,
  RECENT_KEYS_LIMIT,
  cycleQueries,
  getLastQuery,
  getQueryHistory,
  getRecentKeys,
  isQueryFresh,
  isUsablePopupEntry,
  normalizeKey,
  orderByRecency,
  prefixMatches,
  reconcileKeys,
  recordQuery,
  recordRecentKey,
  resolveRename,
  touchQueryHistory,
  touchRecentKey,
  type QueryHistoryMap,
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

describe('per-note query history', () => {
  const now = 1_000_000;

  it('records and reads back per note, most recent first', () => {
    let m: QueryHistoryMap = {};
    m = recordQuery(m, 'A.md', { query: 'one', doubleAt: false }, now);
    m = recordQuery(m, 'A.md', { query: 'two', doubleAt: true }, now + 1000);
    expect(getQueryHistory(m, 'A.md').map((e) => e.query)).toEqual(['two', 'one']);
    expect(getLastQuery(m, 'A.md', now + 2000)?.query).toBe('two');
    expect(getLastQuery(m, 'B.md', now)).toBeNull();
  });

  it('keeps notes isolated', () => {
    let m: QueryHistoryMap = {};
    m = recordQuery(m, 'A.md', { query: 'a', doubleAt: false }, now);
    m = recordQuery(m, 'B.md', { query: 'b', doubleAt: true }, now + 1000);
    expect(getLastQuery(m, 'A.md', now + 2000)?.query).toBe('a');
    expect(getLastQuery(m, 'B.md', now + 2000)?.doubleAt).toBe(true);
  });

  it('treats the last query as stale after the window', () => {
    const m = recordQuery({}, 'A.md', { query: 'a', doubleAt: false }, now);
    expect(
      isQueryFresh(getQueryHistory(m, 'A.md')[0], now + LAST_SEARCH_WINDOW_MS - 1)
    ).toBe(true);
    expect(getLastQuery(m, 'A.md', now + LAST_SEARCH_WINDOW_MS)).toBeNull();
  });

  it('de-duplicates by query+mode (same text, different mode is distinct)', () => {
    let m: QueryHistoryMap = {};
    m = recordQuery(m, 'A.md', { query: 'x', doubleAt: false }, now);
    m = recordQuery(m, 'A.md', { query: 'y', doubleAt: false }, now + 1);
    m = recordQuery(m, 'A.md', { query: 'x', doubleAt: false }, now + 2);
    expect(getQueryHistory(m, 'A.md').map((e) => e.query)).toEqual(['x', 'y']);
    m = recordQuery(m, 'A.md', { query: 'x', doubleAt: true }, now + 3);
    expect(
      getQueryHistory(m, 'A.md').map((e) => `${e.doubleAt ? '@@' : '@'}${e.query}`)
    ).toEqual(['@@x', '@x', '@y']);
  });

  it('prunes the note count (least-recently-used first)', () => {
    let m: QueryHistoryMap = {};
    for (let i = 0; i < 60; i++) {
      m = recordQuery(m, `N${i}.md`, { query: `q${i}`, doubleAt: false }, now + i);
    }
    expect(Object.keys(m).length).toBeLessThanOrEqual(50);
    expect(getQueryHistory(m, 'N59.md')).toHaveLength(1);
    expect(getQueryHistory(m, 'N0.md')).toHaveLength(0);
  });

  it('does not record an empty query', () => {
    const m = recordQuery({}, 'A.md', { query: '', doubleAt: false }, now);
    expect(getQueryHistory(m, 'A.md')).toHaveLength(0);
  });
});

describe('isUsablePopupEntry()', () => {
  it('keeps entries with a title, author or editor', () => {
    expect(isUsablePopupEntry({ title: 'A Work' })).toBe(true);
    expect(isUsablePopupEntry({ author: [{ family: 'X' }] })).toBe(true);
    expect(isUsablePopupEntry({ editor: [{ family: 'Y' }] })).toBe(true);
  });

  it('drops untitled, unattributed items', () => {
    expect(isUsablePopupEntry({ title: null, author: null })).toBe(false);
    expect(isUsablePopupEntry({ title: '   ', author: [] })).toBe(false);
    expect(isUsablePopupEntry({})).toBe(false);
  });
});

describe('global query history + Tab cycling', () => {
  const now = 2_000_000;
  const e = (query: string, doubleAt = false) => ({ query, doubleAt, at: now });

  it('touchQueryHistory de-dupes by query+mode', () => {
    let list = touchQueryHistory([], e('a'), now);
    list = touchQueryHistory(list, e('b'), now);
    list = touchQueryHistory(list, e('a'), now);
    expect(list.map((x) => x.query)).toEqual(['a', 'b']);
  });

  it('cycleQueries offers note queries then global, de-duplicated', () => {
    const list = cycleQueries([e('note1'), e('shared')], [e('shared'), e('global1')]);
    expect(list.map((x) => x.query)).toEqual(['note1', 'shared', 'global1']);
  });
});

describe('reconcileKeys() — vet caches against the live library', () => {
  const live = new Set(['a', 'b', 'new']);

  it('drops keys that no longer resolve', () => {
    expect(reconcileKeys(['a', 'gone', 'b'], live)).toEqual(['a', 'b']);
  });

  it('remaps a renamed key, keeping its position', () => {
    expect(reconcileKeys(['a', 'old'], live, new Map([['old', 'new']]))).toEqual([
      'a',
      'new',
    ]);
  });

  it('follows rename chains and collapses duplicates', () => {
    expect(
      reconcileKeys(['x', 'y'], live, new Map([['x', 'a'], ['y', 'a']]))
    ).toEqual(['a']);
    expect(
      reconcileKeys(['old2'], live, new Map([['old2', 'old'], ['old', 'new']]))
    ).toEqual(['new']);
  });

  it('resolveRename is bounded against cycles', () => {
    expect(resolveRename('a', new Map([['a', 'b'], ['b', 'a']]))).toBeDefined();
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

  it('orders note recents before global recents (concatenated tiers)', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    // note recents ['c'], global ['b'] → c, b, a
    expect(orderByRecency(entries, ['c', 'b']).map((e) => e.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('no-ops without a note path', () => {
    expect(Object.keys(recordRecentKey({}, '', 'x'))).toEqual([]);
  });
});
