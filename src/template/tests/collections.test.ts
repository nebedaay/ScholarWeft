import {
  buildCollectionNodes,
  collectionToken,
  collectionTokens,
  descendantTokens,
} from '../collections';

describe('buildCollectionNodes()', () => {
  const raw = [
    { key: 'p', name: 'Parent' },
    { key: 'c', name: 'Child', parentCollection: 'p' },
    { key: 'g', name: 'Grandchild', parentCollection: 'c' },
    { key: 'x', name: 'Alpha' },
  ];

  it('builds full "Parent > Child" paths with their depth', () => {
    const byKey = new Map(buildCollectionNodes(raw, 1).map((n) => [n.key, n]));
    expect(byKey.get('p')).toMatchObject({ path: 'Parent', depth: 0 });
    expect(byKey.get('c')).toMatchObject({ path: 'Parent > Child', depth: 1 });
    expect(byKey.get('g')).toMatchObject({
      path: 'Parent > Child > Grandchild',
      depth: 2,
    });
    expect(byKey.get('x')).toMatchObject({ path: 'Alpha', depth: 0 });
  });

  it('sorts by path so nested children follow their parent', () => {
    expect(buildCollectionNodes(raw, 1).map((n) => n.path)).toEqual([
      'Alpha',
      'Parent',
      'Parent > Child',
      'Parent > Child > Grandchild',
    ]);
  });

  it('carries the library id onto every node', () => {
    expect(buildCollectionNodes(raw, 7).every((n) => n.groupID === 7)).toBe(true);
  });

  it('records each node\'s parent key (null when top-level or missing)', () => {
    const byKey = new Map(buildCollectionNodes(raw, 1).map((n) => [n.key, n]));
    expect(byKey.get('p')!.parentKey).toBeNull();
    expect(byKey.get('c')!.parentKey).toBe('p');
    expect(byKey.get('g')!.parentKey).toBe('c');
    const orphan = buildCollectionNodes(
      [{ key: 'a', name: 'A', parentCollection: 'gone' }],
      1
    );
    expect(orphan[0].parentKey).toBeNull();
  });

  it('truncates a path whose parent is missing, without looping', () => {
    const nodes = buildCollectionNodes(
      [{ key: 'a', name: 'A', parentCollection: 'gone' }],
      1
    );
    expect(nodes[0].path).toBe('A');
    expect(nodes[0].depth).toBe(0);
  });

  it('does not loop on a parent cycle', () => {
    const nodes = buildCollectionNodes(
      [
        { key: 'a', name: 'A', parentCollection: 'b' },
        { key: 'b', name: 'B', parentCollection: 'a' },
      ],
      1
    );
    for (const n of nodes) {
      expect(n.path.split(' > ').length).toBeLessThanOrEqual(2);
    }
  });
});

describe('collectionTokens()', () => {
  it('prefixes the library id so keys cannot collide across libraries', () => {
    expect(collectionToken(2, 'aa')).toBe('2:aa');
    expect(collectionTokens(1, ['aa', 'bb'])).toEqual(['1:aa', '1:bb']);
  });

  it('degrades gracefully for missing / junk values', () => {
    expect(collectionTokens(1, undefined)).toEqual([]);
    expect(collectionTokens(1, null)).toEqual([]);
    expect(collectionTokens(1, ['', 'x'])).toEqual(['1:x']);
  });
});

describe('descendantTokens()', () => {
  const raw = [
    { key: 'p', name: 'Parent' },
    { key: 'c', name: 'Child', parentCollection: 'p' },
    { key: 'g', name: 'Grandchild', parentCollection: 'c' },
    { key: 's', name: 'Sibling' },
  ];
  const nodes = buildCollectionNodes(raw, 1);

  it('returns a node and its whole subtree, its own library only', () => {
    expect(new Set(descendantTokens(nodes, 1, 'p'))).toEqual(
      new Set(['1:p', '1:c', '1:g'])
    );
    expect(descendantTokens(nodes, 1, 'g')).toEqual(['1:g']);
    expect(descendantTokens(nodes, 1, 's')).toEqual(['1:s']);
  });

  it('ignores collections from other libraries', () => {
    const other = buildCollectionNodes([{ key: 'x', name: 'X' }], 2);
    expect(descendantTokens([...nodes, ...other], 1, 'p')).not.toContain('2:x');
  });
});
