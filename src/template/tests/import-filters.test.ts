import {
  countPassing,
  defaultFilters,
  flagsFromChildren,
  flagsFromPresence,
  passesImportFilters,
  typeGroupOf,
  type ImportFilters,
} from '../import-filters';

const flags = (o: Partial<ReturnType<typeof flagsFromChildren>>) => ({
  hasNotes: false,
  hasAttachment: false,
  hasAnnotations: false,
  hasLitNote: false,
  typeGroup: 'other' as const,
  collections: [] as string[],
  ...o,
});

describe('defaultFilters()', () => {
  it('starts with only "without a literature note" checked', () => {
    expect(defaultFilters()).toEqual({
      hasNotes: false,
      hasAttachment: false,
      hasAnnotations: false,
      withoutLitNote: true,
      types: [],
      excludeCollections: [],
    });
  });
});

describe('typeGroupOf()', () => {
  it('maps the named CSL types to their groups', () => {
    expect(typeGroupOf('book')).toBe('book');
    expect(typeGroupOf('article-journal')).toBe('article');
    expect(typeGroupOf('chapter')).toBe('chapter');
    expect(typeGroupOf('article-newspaper')).toBe('news');
    expect(typeGroupOf('article-magazine')).toBe('news');
    expect(typeGroupOf('webpage')).toBe('webpage');
  });

  it('puts everything else in "other"', () => {
    expect(typeGroupOf('thesis')).toBe('other');
    expect(typeGroupOf('report')).toBe('other');
    expect(typeGroupOf(undefined)).toBe('other');
  });
});

describe('passesImportFilters()', () => {
  const base = defaultFilters();

  it('with only the default, keeps items lacking a note', () => {
    expect(passesImportFilters(flags({ hasLitNote: false }), base)).toBe(true);
    expect(passesImportFilters(flags({ hasLitNote: true }), base)).toBe(false);
  });

  it('unchecking "without a note" stops excluding existing notes', () => {
    const f: ImportFilters = { ...base, withoutLitNote: false };
    expect(passesImportFilters(flags({ hasLitNote: true }), f)).toBe(true);
  });

  it('ANDs the positive filters', () => {
    const f: ImportFilters = { ...base, hasAnnotations: true, hasAttachment: true };
    expect(passesImportFilters(flags({ hasAnnotations: true, hasAttachment: true }), f)).toBe(true);
    expect(passesImportFilters(flags({ hasAnnotations: true, hasAttachment: false }), f)).toBe(false);
    expect(passesImportFilters(flags({ hasAnnotations: false, hasAttachment: true }), f)).toBe(false);
  });

  it('each positive filter is a no-op when disabled', () => {
    const f: ImportFilters = { ...base, hasNotes: true };
    expect(passesImportFilters(flags({ hasNotes: false }), f)).toBe(false);
    expect(passesImportFilters(flags({ hasNotes: false }), { ...base, hasNotes: false })).toBe(true);
  });

  it('shows every type when no type is checked', () => {
    for (const g of ['book', 'article', 'chapter', 'news', 'webpage', 'other'] as const) {
      expect(passesImportFilters(flags({ typeGroup: g }), base)).toBe(true);
    }
  });

  it('restricts to the checked type groups', () => {
    const f: ImportFilters = { ...base, types: ['book', 'chapter'] };
    expect(passesImportFilters(flags({ typeGroup: 'book' }), f)).toBe(true);
    expect(passesImportFilters(flags({ typeGroup: 'chapter' }), f)).toBe(true);
    expect(passesImportFilters(flags({ typeGroup: 'article' }), f)).toBe(false);
    expect(passesImportFilters(flags({ typeGroup: 'other' }), f)).toBe(false);
  });

  it('shows items in a collection when nothing is switched off', () => {
    expect(passesImportFilters(flags({ collections: ['1:aa'] }), base)).toBe(true);
  });

  it('hides an item once EVERY collection it is in is switched off', () => {
    const f: ImportFilters = { ...base, excludeCollections: ['1:aa'] };
    expect(passesImportFilters(flags({ collections: ['1:aa'] }), f)).toBe(false);
    // Still in another, still-on collection → shown.
    expect(passesImportFilters(flags({ collections: ['1:aa', '1:bb'] }), f)).toBe(true);
  });

  it('an uncategorised item follows its LIBRARY node', () => {
    // With no collection, the library is its membership token.
    expect(passesImportFilters(flags({ collections: ['lib:1'] }), base)).toBe(true);
    const libOff: ImportFilters = { ...base, excludeCollections: ['lib:1'] };
    expect(passesImportFilters(flags({ collections: ['lib:1'] }), libOff)).toBe(false);
  });

  it('switching a library off does not hide its collection items', () => {
    // Library off + collection on → the collection's items are shown (this is
    // what lets one collection be isolated inside a switched-off library).
    const isolate: ImportFilters = { ...base, excludeCollections: ['lib:1'] };
    expect(passesImportFilters(flags({ collections: ['1:aa'] }), isolate)).toBe(true);
  });

  it('scopes excluded collections to their library', () => {
    const f: ImportFilters = { ...base, excludeCollections: ['1:aa'] };
    // Same key, different library → not excluded.
    expect(passesImportFilters(flags({ collections: ['2:aa'] }), f)).toBe(true);
  });
});

describe('flagsFromChildren()', () => {
  it('detects pdf and html as attachments; other types do not count', () => {
    expect(flagsFromChildren({ attachments: [{ contentType: 'application/pdf' }] }, false).hasAttachment).toBe(true);
    expect(flagsFromChildren({ attachments: [{ contentType: 'text/html' }] }, false).hasAttachment).toBe(true);
    expect(flagsFromChildren({ attachments: [{ contentType: 'image/png' }] }, false).hasAttachment).toBe(false);
    expect(flagsFromChildren({}, false).hasAttachment).toBe(false);
  });

  it('detects notes and annotations', () => {
    expect(flagsFromChildren({ notes: [1] }, false).hasNotes).toBe(true);
    expect(flagsFromChildren({ annotations: [1] }, false).hasAnnotations).toBe(true);
    expect(flagsFromChildren(null, false)).toMatchObject({ hasNotes: false, hasAnnotations: false });
  });

  it('carries the literature-note flag through', () => {
    expect(flagsFromChildren({}, true).hasLitNote).toBe(true);
  });

  it('derives the type group from the entry type', () => {
    expect(flagsFromChildren({}, false, 'book').typeGroup).toBe('book');
    expect(flagsFromChildren({}, false, 'thesis').typeGroup).toBe('other');
    expect(flagsFromChildren({}, false).typeGroup).toBe('other');
  });
});

describe('flagsFromPresence()', () => {
  it('reads the library-wide presence signature', () => {
    expect(flagsFromPresence({ n: 1, a: 1, an: 1 }, false)).toMatchObject({
      hasNotes: true,
      hasAttachment: true,
      hasAnnotations: true,
    });
    expect(flagsFromPresence({}, false)).toMatchObject({
      hasNotes: false,
      hasAttachment: false,
      hasAnnotations: false,
    });
    expect(flagsFromPresence(undefined, true)).toMatchObject({
      hasNotes: false,
      hasLitNote: true,
    });
  });
});

describe('countPassing()', () => {
  it('counts items satisfying the filters', () => {
    const items = [flags({ hasLitNote: false }), flags({ hasLitNote: true }), flags({})];
    expect(countPassing(items, (x) => x, defaultFilters())).toBe(2);
  });
});
