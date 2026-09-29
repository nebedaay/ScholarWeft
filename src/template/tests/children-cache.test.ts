import {
  childrenCacheHit,
  emptyChildrenCache,
  pruneChildrenCache,
  readChildren,
  writeChildren,
  type ChildrenCacheData,
} from '../children-cache';

describe('childrenCacheHit()', () => {
  it('misses on an unknown key', () => {
    expect(childrenCacheHit({}, 'K', 5)).toBe(false);
  });

  it('hits only when the version matches', () => {
    const c = writeChildren({}, 'K', 5, { a: 1 }, 1);
    expect(childrenCacheHit(c, 'K', 5)).toBe(true);
    expect(childrenCacheHit(c, 'K', 6)).toBe(false);
  });

  it('a version-0 request does not match a versioned snapshot', () => {
    const c = writeChildren({}, 'K', 7, { a: 1 }, 1);
    expect(childrenCacheHit(c, 'K', 0)).toBe(false);
  });
});

describe('readChildren()/writeChildren()', () => {
  it('round-trips the payload', () => {
    const c = writeChildren({}, 'K', 3, { notes: [1, 2] }, 100);
    expect(readChildren<{ notes: number[] }>(c, 'K')).toEqual({ notes: [1, 2] });
    expect(readChildren(c, 'MISSING')).toBeNull();
  });

  it('evicts the oldest beyond the cap', () => {
    let c: ChildrenCacheData = {};
    for (let i = 0; i < 5; i++) c = writeChildren(c, `K${i}`, 1, i, i, 3);
    expect(Object.keys(c).sort()).toEqual(['K2', 'K3', 'K4']);
  });
});

describe('pruneChildrenCache()', () => {
  it('drops entries whose item is gone', () => {
    let c = writeChildren(emptyChildrenCache(), 'A', 1, 1, 1);
    c = writeChildren(c, 'B', 1, 2, 2);
    const pruned = pruneChildrenCache(c, (k) => k === 'B');
    expect(Object.keys(pruned)).toEqual(['B']);
  });
});
