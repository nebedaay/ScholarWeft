jest.mock(
  'obsidian',
  () => ({ normalizePath: (p: string) => p.replace(/\/+/g, '/') }),
  { virtual: true }
);

import {
  citekeyFromBasename,
  citeOnlyPairs,
  derivedRenameFor,
  findAvailableNotePath,
  foreignNoteAction,
  formatCitekey,
  matchNoteByZoteroKey,
  noteNameMatchesCitekey,
  isZotLitManaged,
  needsKeyBraces,
  planCitekeyReconcile,
  replaceCitekeys,
  scanCitekeys,
  stableKeyGroupID,
  transformBareCitekeys,
  zotLitChoice,
  suffixCandidate,
  type ReconcileNote,
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

describe('isZotLitManaged', () => {
  it('detects ZotLit notes (which are converted) vs ours/plain', () => {
    expect(isZotLitManaged('%%zt-managed%%\n## Annotations')).toBe(true);
    expect(isZotLitManaged('%%sw-managed%%\n## Annotations')).toBe(false);
    expect(isZotLitManaged('## Notes\nplain')).toBe(false);
    expect(isZotLitManaged(null)).toBe(false);
  });
});

describe('zotLitChoice', () => {
  it('remembers a "convert" but not a "leave"', () => {
    expect(zotLitChoice('convert')).toEqual({
      action: 'convert',
      remember: 'convert',
    });
    expect(zotLitChoice('leave')).toEqual({
      action: 'leave',
      remember: null,
    });
  });
});

describe('citekeyFromBasename', () => {
  it('reads a bare @key name', () => {
    expect(citekeyFromBasename('@smith2020')).toBe('smith2020');
  });

  it('rejects derived and hand-named files', () => {
    expect(citekeyFromBasename('@smith2020 - transcription')).toBeNull();
    expect(citekeyFromBasename('My Note')).toBeNull();
  });
});

describe('derivedRenameFor', () => {
  it('renames space-separated derived files', () => {
    expect(
      derivedRenameFor('@old - transcription - v. 2.md', 'old', 'new')
    ).toBe('@new - transcription - v. 2.md');
    expect(derivedRenameFor('@old V. 1 - translation.md', 'old', 'new')).toBe(
      '@new V. 1 - translation.md'
    );
  });

  it('never touches the note itself, images, or suffixed keys', () => {
    // `.` and `_` continue a citekey, and `a` is a different key.
    expect(derivedRenameFor('@old.md', 'old', 'new')).toBeNull();
    expect(derivedRenameFor('@old_p6_AB12XYZ.png', 'old', 'new')).toBeNull();
    expect(derivedRenameFor('@olda - transcription.md', 'old', 'new')).toBeNull();
  });

  it('is a no-op when the key did not change', () => {
    expect(derivedRenameFor('@old - transcription.md', 'old', 'old')).toBeNull();
  });
});

describe('planCitekeyReconcile', () => {
  const resolve = (map: Record<string, string>) => (key: string) =>
    map[key] ?? null;

  const note = (
    path: string,
    basename: string,
    citekey: string | null,
    zoteroKey: string
  ): ReconcileNote => ({ path, basename, citekey, zoteroKey });

  it('plans a filename rename when the note still carries the old key', () => {
    const { renames, unresolved } = planCitekeyReconcile(
      [note('_2 Notes/@old.md', '@old', 'new', 'KEY1')],
      resolve({ KEY1: 'new' })
    );
    expect(unresolved).toHaveLength(0);
    expect(renames).toEqual([
      {
        path: '_2 Notes/@old.md',
        newPath: '_2 Notes/@new.md',
        fromKey: 'old',
        toKey: 'new',
        zoteroKey: 'KEY1',
        rekeyFrontmatter: false,
      },
    ]);
  });

  it('re-keys the frontmatter when only citekey: is stale', () => {
    const { renames } = planCitekeyReconcile(
      [note('_2 Notes/@new.md', '@new', 'old', 'KEY1')],
      resolve({ KEY1: 'new' })
    );
    expect(renames).toEqual([
      {
        path: '_2 Notes/@new.md',
        newPath: '_2 Notes/@new.md',
        fromKey: 'old',
        toKey: 'new',
        zoteroKey: 'KEY1',
        rekeyFrontmatter: true,
      },
    ]);
  });

  it('ignores notes already current and reports unresolved keys', () => {
    const { renames, unresolved } = planCitekeyReconcile(
      [
        note('_2 Notes/@new.md', '@new', 'new', 'KEY1'),
        note('_2 Notes/@gone.md', '@gone', 'gone', 'MISSING'),
      ],
      resolve({ KEY1: 'new' })
    );
    expect(renames).toHaveLength(0);
    expect(unresolved.map((n) => n.zoteroKey)).toEqual(['MISSING']);
  });

  it('respects group keys and hand-named notes', () => {
    const { renames } = planCitekeyReconcile(
      [
        note('_2 Notes/@old.md', '@old', 'old', 'KEY1g42'),
        note('_2 Notes/My Note.md', 'My Note', 'old', 'KEY2'),
      ],
      resolve({ KEY1g42: 'new', KEY2: 'fresh' })
    );
    expect(renames.map((r) => r.newPath)).toEqual([
      '_2 Notes/@new.md',
      '_2 Notes/My Note.md',
    ]);
    expect(renames[1].rekeyFrontmatter).toBe(true);
  });
});

describe('scanCitekeys (Pandoc key grammar)', () => {
  const keys = (t: string) => scanCitekeys(t).map((h) => h.key);

  it('keeps internal punctuation and strips trailing punctuation', () => {
    expect(keys('see @smith2005.')).toEqual(['smith2005']);
    expect(keys('see @smith.important.research.2005')).toEqual([
      'smith.important.research.2005',
    ]);
    expect(keys('@smith-2005')).toEqual(['smith-2005']);
    expect(keys('@smith2005-')).toEqual(['smith2005']);
    expect(keys('@smith2005-2')).toEqual(['smith2005-2']);
  });

  it('matches the whole key, never a prefix or suffix', () => {
    expect(keys('see @smith2005a')).toEqual(['smith2005a']);
    expect(keys('@smith2005_2')).toEqual(['smith2005_2']);
    expect(keys('@smith2005_')).toEqual(['smith2005_']); // _ is a word char
  });

  it('matches in every citation form', () => {
    expect(keys('[[@smith2005]]')).toEqual(['smith2005']);
    expect(keys('[[@smith2005|alias]]')).toEqual(['smith2005']);
    expect(keys('[@smith2005, p. 5]')).toEqual(['smith2005']);
    expect(keys('examined,@smith2005')).toEqual(['smith2005']);
  });

  it('does not match an @ glued to a word (email / handle)', () => {
    expect(keys('john@smith2005.com')).toEqual([]);
    expect(keys('mailto:john@smith2005.com')).toEqual([]);
    expect(keys('2020@smith2005')).toEqual([]);
  });

  it('reads a wikilink target verbatim (it is a filename)', () => {
    expect(keys('[[@smith2005]]')).toEqual(['smith2005']);
    expect(keys('[[@smith2005.]]')).toEqual(['smith2005.']);
    expect(keys('[[@smith2005.|@, p. 2]]')).toEqual(['smith2005.']);
  });

  it('reads Pandoc\'s explicit @{…} form verbatim (trailing punct kept)', () => {
    expect(keys('see @{smith2005.}')).toEqual(['smith2005.']);
    expect(keys('[[@{smith.important.}]]')).toEqual(['smith.important.']);
    expect(keys('@{https://example.com/bib?x=1&y=2}')).toEqual([
      'https://example.com/bib?x=1&y=2',
    ]);
    // The empty forced-suffix marker is not a citekey.
    expect(keys('@smith{}, 99 years later')).toEqual(['smith']);
    expect(scanCitekeys('@{}')).toEqual([]);
  });
});

describe('replaceCitekeys', () => {
  it('replaces the whole key and keeps trailing punctuation', () => {
    expect(replaceCitekeys('see @smith2005.', { smith2005: 'smithNew2020' })).toBe(
      'see @smithNew2020.'
    );
  });

  it('never clobbers a longer key that shares a prefix', () => {
    expect(replaceCitekeys('see @smith2005a', { smith2005: 'x' })).toBe(
      'see @smith2005a'
    );
    expect(
      replaceCitekeys('see @smith.2005', { smith2005: 'x' })
    ).toBe('see @smith.2005');
  });

  it('rewrites linked and bracket citations, leaves emails', () => {
    expect(
      replaceCitekeys('[[@smith2005|@, p. 2]] and [@smith2005]', {
        smith2005: 'smithNew2020',
      })
    ).toBe('[[@smithNew2020|@, p. 2]] and [@smithNew2020]');
    expect(
      replaceCitekeys('mail john@smith2005.com about @smith2005.', {
        smith2005: 'smithNew2020',
      })
    ).toBe('mail john@smith2005.com about @smithNew2020.');
  });

  it('rewrites explicit @{…} keys and keeps the braces', () => {
    expect(replaceCitekeys('see @{smith2005.}', { 'smith2005.': 'jones.2020.' })).toBe(
      'see @{jones.2020.}'
    );
    // Renaming away the trailing punctuation drops the braces (bare is fine).
    expect(replaceCitekeys('see @{smith2005.}', { 'smith2005.': 'jones2020' })).toBe(
      'see @jones2020'
    );
  });

  it('rewrites a wikilink target verbatim, never adding braces', () => {
    expect(
      replaceCitekeys('[[@smith2005.]]', { 'smith2005.': 'jones.2020.' })
    ).toBe('[[@jones.2020.]]');
    expect(
      replaceCitekeys('[[@smith2005.|@, p. 2]]', { 'smith2005.': 'jones2020' })
    ).toBe('[[@jones2020|@, p. 2]]');
  });

  it('adds braces when the NEW key needs them (sentence period kept)', () => {
    expect(replaceCitekeys('see @smith2005.', { smith2005: 'jones.2020.' })).toBe(
      'see @{jones.2020.}.'
    );
  });
});

describe('needsKeyBraces / formatCitekey', () => {
  it('needs braces only when a bare @key would be misread', () => {
    expect(needsKeyBraces('smith2005')).toBe(false);
    expect(needsKeyBraces('smith-2005')).toBe(false);
    expect(needsKeyBraces('smith.important.2005')).toBe(false);
    expect(needsKeyBraces('smith2005.')).toBe(true);
    expect(needsKeyBraces('smith2005-')).toBe(true);
  });

  it('formats with braces exactly when needed', () => {
    expect(formatCitekey('smith2005')).toBe('@smith2005');
    expect(formatCitekey('smith2005.')).toBe('@{smith2005.}');
    expect(formatCitekey('smith2005', true)).toBe('@{smith2005}');
  });
});

describe('citeOnlyPairs', () => {
  it('excludes keys the note pass already covers', () => {
    const pending = new Map([
      ['oldA', 'newA'],
      ['oldB', 'newB'],
      ['same', 'same'],
    ]);
    expect(citeOnlyPairs(pending, new Set(['oldA']))).toEqual([
      { fromKey: 'oldB', toKey: 'newB' },
    ]);
  });
});

describe('transformBareCitekeys (shared converter detection)', () => {
  const conv = (t: string) =>
    transformBareCitekeys(t, (k) => `[[@${k}]]`);

  it('rewrites prose keys with internal punctuation, strips trailing', () => {
    expect(conv('see @smith2005.')).toBe('see [[@smith2005]].');
    expect(conv('see @smith.important.2005, ok')).toBe(
      'see [[@smith.important.2005]], ok'
    );
    expect(conv('see @smith-2005')).toBe('see [[@smith-2005]]');
  });

  it('never rewrites an @ glued to a word, an alias, or an existing citation', () => {
    expect(conv('mail john@smith2005.com')).toBe('mail john@smith2005.com');
    expect(conv('[[@smith2005|alias]]')).toBe('[[@smith2005|alias]]');
    expect(conv('[@smith2005]')).toBe('[@smith2005]');
    expect(conv('[[@x|@ p. 5]]')).toBe('[[@x|@ p. 5]]');
  });

  it('leaves the span untouched when fn returns null', () => {
    expect(transformBareCitekeys('see @smith2005.', () => null)).toBe(
      'see @smith2005.'
    );
  });
});

describe('noteNameMatchesCitekey', () => {
  it('accepts the conventional @citekey filename, with or without a folder', () => {
    expect(noteNameMatchesCitekey('@smith2020.md', 'smith2020')).toBe(true);
    expect(
      noteNameMatchesCitekey('_2 Bibliographic notes/@smith2020.md', 'smith2020')
    ).toBe(true);
  });

  it('rejects a foreign naming scheme or an obsolete citekey', () => {
    expect(noteNameMatchesCitekey('Smith 2020 title.md', 'smith2020')).toBe(false);
    expect(noteNameMatchesCitekey('@old2019.md', 'smith2020')).toBe(false);
    expect(noteNameMatchesCitekey('@smith2020 - transcription.md', 'smith2020')).toBe(
      false
    );
    expect(noteNameMatchesCitekey('@smith2020.md', '')).toBe(false);
  });
});

describe('foreignNoteAction', () => {
  it('maps convert/ifEmpty/new/cancel to what the importer does', () => {
    expect(foreignNoteAction('convert')).toEqual({
      convert: true,
      notesReimport: 'append',
      createNew: false,
    });
    expect(foreignNoteAction('convertIfEmpty')).toEqual({
      convert: true,
      notesReimport: 'ifEmpty',
      createNew: false,
    });
    expect(foreignNoteAction('new')).toEqual({
      convert: false,
      notesReimport: 'ifEmpty',
      createNew: true,
    });
    expect(foreignNoteAction('cancel')).toEqual({
      convert: false,
      notesReimport: 'ifEmpty',
      createNew: false,
    });
  });
});

describe('stableKeyGroupID', () => {
  it('extracts the group id from a `KEYg<groupID>` stable key', () => {
    expect(stableKeyGroupID('EKUBHHNWg42')).toBe(42);
    expect(stableKeyGroupID('ABC123g7')).toBe(7);
  });

  it('returns null for a My Library key', () => {
    expect(stableKeyGroupID('EKUBHHNW')).toBeNull();
    // An uppercase G is part of an ordinary key, not the group suffix.
    expect(stableKeyGroupID('ABCg12X')).toBeNull();
  });
});
