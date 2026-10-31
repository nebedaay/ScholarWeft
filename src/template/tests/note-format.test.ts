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
  bodyStartLine,
  captureCursorAnchor,
  resolveCursorAnchor,
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

describe('cursor anchors', () => {
  const before = ['---', 'title: x', '---', '', 'First line', 'Second line', 'Third line'].join(
    '\n'
  );
  const after = [
    '---',
    'title: x',
    'added: y',
    'tags:',
    '  - a',
    '---',
    '',
    'First line',
    'Second line',
    'Third line',
  ].join('\n');

  it('finds the first body line after YAML', () => {
    expect(bodyStartLine(before)).toBe(3);
    expect(bodyStartLine('First line\nSecond')).toBe(0);
    expect(bodyStartLine('---\ntitle: x\n')).toBe(0);
  });

  it('captures a body cursor but not one in the YAML block', () => {
    expect(captureCursorAnchor(before, 5, 6, 'Second line')).toMatchObject({
      lineText: 'Second line',
      column: 6,
      bodyLine: 2,
    });
    expect(captureCursorAnchor(before, 1, 2, 'title: x')).toBeNull();
  });

  it('follows the line text when the YAML grows', () => {
    const anchor = captureCursorAnchor(before, 5, 6, 'Second line')!;
    expect(resolveCursorAnchor(after, anchor)).toEqual({ line: 8, ch: 6 });
  });

  it('follows the line text when lines are inserted above it', () => {
    const anchor = captureCursorAnchor(before, 5, 6, 'Second line')!;
    const shifted = ['---', 'title: x', '---', '', 'First line', '', 'Inserted', 'Second line'].join(
      '\n'
    );
    expect(resolveCursorAnchor(shifted, anchor)).toEqual({ line: 7, ch: 6 });
  });


  it('restores a cursor at the start of a paragraph', () => {
    const anchor = captureCursorAnchor(before, 4, 0, 'First line')!;
    expect(resolveCursorAnchor(after, anchor)).toEqual({ line: 7, ch: 0 });
  });

  it('uses the surrounding text when a line text repeats', () => {
    const repeated = ['---', 'title: x', '---', 'Same', 'middle', 'Same', 'tail'].join('\n');
    const anchor = captureCursorAnchor(repeated, 5, 2, 'Same')!;
    const shifted = ['---', 'title: x', 'extra: y', '---', 'Same', 'middle', 'Same', 'tail'].join(
      '\n'
    );
    // The line text alone would be ambiguous; the "middle\nSa" context picks
    // the second occurrence.
    expect(resolveCursorAnchor(shifted, anchor)).toEqual({ line: 6, ch: 2 });
  });

  it('falls back to the body-relative line and clamps the column', () => {
    const anchor = {
      before: '',
      after: '',
      lineText: 'never appears',
      column: 30,
      bodyLine: 1,
    };
    expect(resolveCursorAnchor(after, anchor)).toEqual({ line: 7, ch: 10 });
    expect(resolveCursorAnchor('', anchor)).toEqual({ line: 0, ch: 0 });
  });
});
