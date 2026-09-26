import {
  detectNoteFormat,
  noteFormatLabel,
  SW_MANAGED_OPEN,
  ZOTLIT_MANAGED_OPEN,
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
