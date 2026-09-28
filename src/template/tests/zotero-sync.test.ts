import {
  collectChangedItemKeys,
  emptySyncState,
  stableKeyFor,
} from '../zotero-sync';

const noLookup = async () => null;

describe('collectChangedItemKeys()', () => {
  it('maps an annotation change to its top-level item via the attachment map', async () => {
    const state = { versions: {}, attachments: { ATT1: 'ITEM1' } };
    const r = await collectChangedItemKeys(state, [], [{ key: 'ANN1', parentItem: 'ATT1' }], noLookup);
    expect([...r.changedItemKeys]).toEqual(['ITEM1']);
  });

  it('resolves an unknown attachment via lookupParent and remembers it', async () => {
    const r = await collectChangedItemKeys(
      emptySyncState(),
      [],
      [{ key: 'ANN1', parentItem: 'ATT9' }],
      async (k) => (k === 'ATT9' ? 'ITEM9' : null)
    );
    expect([...r.changedItemKeys]).toEqual(['ITEM9']);
    expect(r.state.attachments.ATT9).toBe('ITEM9');
  });

  it('treats an attachment change as changing its item', async () => {
    const r = await collectChangedItemKeys(
      emptySyncState(),
      [{ key: 'ATT1', parentItem: 'ITEM1' }],
      [],
      noLookup
    );
    expect([...r.changedItemKeys]).toEqual(['ITEM1']);
    expect(r.state.attachments.ATT1).toBe('ITEM1');
  });

  it('drops a detached attachment and ignores unresolved annotations', async () => {
    const r = await collectChangedItemKeys(
      { versions: {}, attachments: { ATT1: 'ITEM1' } },
      [{ key: 'ATT1', parentItem: '' }],
      [{ key: 'ANN', parentItem: 'ATTX' }],
      async () => null
    );
    expect(r.state.attachments.ATT1).toBeUndefined();
    expect(r.changedItemKeys.size).toBe(0);
  });

  it('stableKeyFor uses KEY for My Library and KEYgGROUP for groups', () => {
    expect(stableKeyFor('ABC', 1)).toBe('ABC');
    expect(stableKeyFor('ABC', 42)).toBe('ABCg42');
  });
});
