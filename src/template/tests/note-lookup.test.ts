jest.mock(
  'obsidian',
  () => ({ normalizePath: (p: string) => p.replace(/\/+/g, '/') }),
  { virtual: true }
);

import {
  findAvailableNotePath,
  matchNoteByZoteroKey,
  shouldUpdateOwnNote,
  suffixCandidate,
} from '../note-lookup';

const candidates = [
  { path: '_2 Bibliographic notes/@old2020.md', zoteroKey: 'EKUBHHNW' },
  { path: '_2 Bibliographic notes/@other2021.md', zoteroKey: 'ZZZZ1111' },
  { path: '_2 Bibliographic notes/sub/@nested2022.md', zoteroKey: 'EKUBHHNW' },
  { path: '_3 Other/@elsewhere.md', zoteroKey: 'EKUBHHNW' },
];

describe('matchNoteByZoteroKey', () => {
  it('finds the note by its stable key, ignoring the filename', () => {
    expect(
      matchNoteByZoteroKey(candidates, '_2 Bibliographic notes', 'EKUBHHNW')
    ).toBe('_2 Bibliographic notes/@old2020.md');
  });

  it('returns the first match in folder order', () => {
    expect(
      matchNoteByZoteroKey(candidates, '', 'EKUBHHNW')
    ).toBe('_2 Bibliographic notes/@old2020.md');
  });

  it('stays inside the folder', () => {
    expect(
      matchNoteByZoteroKey(candidates, '_3 Other', 'EKUBHHNW')
    ).toBe('_3 Other/@elsewhere.md');
    expect(
      matchNoteByZoteroKey(candidates, '_9 Nothing', 'EKUBHHNW')
    ).toBeNull();
  });

  it('returns null for an empty key or no match', () => {
    expect(matchNoteByZoteroKey(candidates, '', '')).toBeNull();
    expect(matchNoteByZoteroKey(candidates, '', 'NOPE0000')).toBeNull();
  });
});

describe('suffixCandidate', () => {
  it('suffixes a, b, … z, aa like the user asked for', () => {
    expect(suffixCandidate('@k', 0)).toBe('@k');
    expect(suffixCandidate('@k', 1)).toBe('@ka');
    expect(suffixCandidate('@k', 2)).toBe('@kb');
    expect(suffixCandidate('@k', 26)).toBe('@kz');
    expect(suffixCandidate('@k', 27)).toBe('@kaa');
  });
});

describe('findAvailableNotePath', () => {
  it('avoids every taken name instead of overwriting', () => {
    const taken = new Set([
      '_2 Bibliographic notes/@k.md',
      '_2 Bibliographic notes/@ka.md',
    ]);
    expect(
      findAvailableNotePath('@k', '_2 Bibliographic notes', taken)
    ).toBe('_2 Bibliographic notes/@kb.md');
  });

  it('uses the plain name when it is free', () => {
    expect(findAvailableNotePath('@k', '', new Set())).toBe('@k.md');
  });
});

describe('shouldUpdateOwnNote', () => {
  it('leaves ZotLit-managed notes alone', () => {
    expect(shouldUpdateOwnNote('%%zt-managed%%\n## Annotations')).toBe(false);
    expect(shouldUpdateOwnNote('%%sw-managed%%\n## Annotations')).toBe(true);
    expect(shouldUpdateOwnNote('## Notes\nplain')).toBe(true);
    expect(shouldUpdateOwnNote(null)).toBe(true);
  });
});
