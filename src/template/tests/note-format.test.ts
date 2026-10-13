import {
  detectNoteFormat,
  noteFormatLabel,
  SW_MANAGED_OPEN,
  ZOTLIT_MANAGED_OPEN,
  SW_ZOTERO_ID,
  LEGACY_ZOTERO_KEY,
  readStableKey,
  hasLegacyKey,
  shouldMigrateKey,
} from '../note-format';

describe('detectNoteFormat()', () => {
  it('reads our region as ScholarWeft', () => {
    expect(
      detectNoteFormat(`---\ntitle: x\n---\n\n${SW_MANAGED_OPEN}\n## Notes\n`, true)
    ).toBe('sw');
  });

  it('reads ZotLit’s region as ZotLit', () => {
    expect(
      detectNoteFormat(`---\ntitle: x\n---\n\n${ZOTLIT_MANAGED_OPEN}\n`, true)
    ).toBe('zotlit');
  });

  it('prefers ours when both regions are present (a converted note)', () => {
    expect(
      detectNoteFormat(`${ZOTLIT_MANAGED_OPEN}\n${SW_MANAGED_OPEN}\n`, true)
    ).toBe('sw');
  });

  it('treats a key with no region as ScholarWeft', () => {
    // Our template omits the region when the item has no annotations, so a
    // keyed note with no region is our own shape — not a blank note.
    expect(detectNoteFormat('---\nzotero-key: ABCD1234\n---\n\n## Notes\n', true)).toBe(
      'sw'
    );
  });

  it('treats no key and no region as unknown', () => {
    expect(detectNoteFormat('# Just a note\n', false)).toBe('unknown');
  });

  it('detects a region even without a key', () => {
    expect(detectNoteFormat(`${SW_MANAGED_OPEN}\n`, false)).toBe('sw');
    expect(detectNoteFormat(`${ZOTLIT_MANAGED_OPEN}\n`, false)).toBe('zotlit');
  });
});

describe('noteFormatLabel()', () => {
  it('names each format for the prompt', () => {
    expect(noteFormatLabel('sw')).toMatch(/ScholarWeft/);
    expect(noteFormatLabel('zotlit')).toMatch(/ZotLit/);
    expect(noteFormatLabel('unknown')).toMatch(/unrecognised/);
  });
});

describe('readStableKey()', () => {
  it('prefers sw-zotero-id', () => {
    expect(readStableKey({ [SW_ZOTERO_ID]: 'AAA111', [LEGACY_ZOTERO_KEY]: 'BBB222' })).toBe(
      'AAA111'
    );
  });

  it('falls back to the legacy zotero-key', () => {
    expect(readStableKey({ [LEGACY_ZOTERO_KEY]: 'BBB222' })).toBe('BBB222');
  });

  it('is undefined when neither is present', () => {
    expect(readStableKey({ title: 'x' })).toBeUndefined();
    expect(readStableKey(undefined)).toBeUndefined();
    expect(readStableKey({ [LEGACY_ZOTERO_KEY]: '' })).toBeUndefined();
  });
});

describe('shouldMigrateKey()', () => {
  const legacy = { [LEGACY_ZOTERO_KEY]: 'EKUBHHNW' };

  it('migrates a legacy note with no region (our shape without annotations)', () => {
    expect(shouldMigrateKey(legacy, '---\nzotero-key: EKUBHHNW\n---\n\n## Notes\n')).toBe(true);
  });

  it('migrates a legacy note carrying OUR region', () => {
    expect(shouldMigrateKey(legacy, `${SW_MANAGED_OPEN}\n## Annotations\n`)).toBe(true);
  });

  it('does NOT migrate a note carrying ZotLit’s region', () => {
    // ZotLit always writes its region, so this note is ZotLit's; the import
    // path asks whether to convert it rather than migrating it here.
    expect(shouldMigrateKey(legacy, `${ZOTLIT_MANAGED_OPEN}\n## Annotations\n`)).toBe(false);
  });

  it('does nothing once the note already has sw-zotero-id', () => {
    expect(
      shouldMigrateKey({ [SW_ZOTERO_ID]: 'EKUBHHNW', [LEGACY_ZOTERO_KEY]: 'EKUBHHNW' }, '')
    ).toBe(false);
  });

  it('does nothing for a note with no legacy key', () => {
    expect(shouldMigrateKey({ title: 'x' }, '')).toBe(false);
  });
});
