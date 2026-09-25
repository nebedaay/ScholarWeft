jest.mock(
  'obsidian',
  () => ({ normalizePath: (p: string) => p.replace(/\/+/g, '/') }),
  { virtual: true }
);

import { matchNoteByZoteroKey } from '../note-lookup';

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
