import {
  literatureNoteFolderFor,
  sanitizeLibraryFolderName,
} from '../lit-folder';

describe('sanitizeLibraryFolderName()', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeLibraryFolderName('Andrea Lickacz readings', 5)).toBe(
      'Andrea Lickacz readings'
    );
  });

  it('replaces filesystem-hostile characters', () => {
    expect(sanitizeLibraryFolderName('A/B:C*D?', 5)).toBe('A-B-C-D-');
    expect(sanitizeLibraryFolderName('[[x/y]]', 5)).toBe('--x-y--');
  });

  it('collapses whitespace and trims leading dots', () => {
    expect(sanitizeLibraryFolderName('  spaced   name  ', 5)).toBe('spaced name');
    expect(sanitizeLibraryFolderName('../etc', 5)).toBe('-etc');
  });

  it('falls back to Group N for an unusable name', () => {
    expect(sanitizeLibraryFolderName('', 42)).toBe('Group 42');
    expect(sanitizeLibraryFolderName('///', 42)).toBe('Group 42');
  });
});

describe('literatureNoteFolderFor()', () => {
  const base = 'Literature Notes';

  it('leaves My Library in the base folder', () => {
    expect(literatureNoteFolderFor({ base })).toBe(base);
    expect(literatureNoteFolderFor({ base, groupID: 1 })).toBe(base);
    expect(literatureNoteFolderFor({ base, groupID: null })).toBe(base);
  });

  it('gives each group library its own subfolder', () => {
    expect(
      literatureNoteFolderFor({ base, groupID: 6667607, groupName: 'Readings' })
    ).toBe('Literature Notes/Readings');
  });

  it('handles a blank base (vault root)', () => {
    expect(
      literatureNoteFolderFor({ base: '', groupID: 7, groupName: 'G' })
    ).toBe('G');
  });

  it('trims a trailing slash on the base', () => {
    expect(
      literatureNoteFolderFor({ base: 'Notes/', groupID: 7, groupName: 'G' })
    ).toBe('Notes/G');
  });
});
