import {
  countPassing,
  defaultFilters,
  flagsFromChildren,
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
      collections: [],
      uncategorized: false,
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

  it('matches ANY selected collection (union, not intersection)', () => {
    const f: ImportFilters = { ...base, collections: ['1:aa', '1:bb'] };
    expect(passesImportFilters(flags({ collections: ['1:aa'] }), f)).toBe(true);
    expect(passesImportFilters(flags({ collections: ['1:cc', '1:bb'] }), f)).toBe(true);
    expect(passesImportFilters(flags({ collections: ['1:cc'] }), f)).toBe(false);
    expect(passesImportFilters(flags({ collections: [] }), f)).toBe(false);
  });

  it('matches collections within the library they belong to', () => {
    const f: ImportFilters = { ...base, collections: ['1:aa'] };
    // Same key, different library → not a match.
    expect(passesImportFilters(flags({ collections: ['2:aa'] }), f)).toBe(false);
  });

  it('Uncategorized keeps only items in no collection', () => {
    const f: ImportFilters = { ...base, uncategorized: true };
    expect(passesImportFilters(flags({ collections: [] }), f)).toBe(true);
    expect(passesImportFilters(flags({ collections: ['1:aa'] }), f)).toBe(false);
  });

  it('Uncategorized widens the collection filter rather than replacing it', () => {
    const f: ImportFilters = { ...base, collections: ['1:aa'], uncategorized: true };
    expect(passesImportFilters(flags({ collections: ['1:aa'] }), f)).toBe(true);
    expect(passesImportFilters(flags({ collections: [] }), f)).toBe(true);
    expect(passesImportFilters(flags({ collections: ['1:zz'] }), f)).toBe(false);
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

describe('countPassing()', () => {
  it('counts items satisfying the filters', () => {
    const items = [flags({ hasLitNote: false }), flags({ hasLitNote: true }), flags({})];
    expect(countPassing(items, (x) => x, defaultFilters())).toBe(2);
  });
});
