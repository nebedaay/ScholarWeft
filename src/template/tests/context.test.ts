jest.mock(
  'obsidian',
  () => ({
    htmlToMarkdown: (html: string) =>
      html.replace(/<i>/g, '*').replace(/<\/i>/g, '*'),
  }),
  { virtual: true }
);

import {
  buildNoteContext,
  cslTypeToZoteroItemType,
  formatAuthorsShort,
  toContextDate,
  type CachedEntry,
} from '../context';
import { ZOTERO_TYPE_TO_CSL } from '../../bib/zotero-csl';

// The captured real item the whole feature is diffed against (see HANDOFF.md).
const fixture: CachedEntry = {
  id: 'alsaihBughyatAlmustafid2005',
  type: 'book',
  groupID: 1,
  title: 'Bughyat al-mustafīd li-sharḥ munyat al-murīd',
  author: [{ family: 'Al-Sāʾiḥ', given: 'Muḥammad al-ʿArabī b.' }],
  editor: [{ family: 'ʿUqayyil', given: 'Saʿīd Maḥmūd' }],
  issued: { 'date-parts': [[2005]] },
  publisher: 'Dār al-Jīl',
  'publisher-place': 'Beirut',
  language: 'ar',
  _zoteroKey: 'EKUBHHNW',
  _dateAdded: '2022-02-12T17:19:53Z',
  _dateModified: '2025-01-02T20:35:01Z',
  _extra: '{:original-date:}',
  _version: 0,
};

describe('buildNoteContext() — identity', () => {
  it('maps the captured book item to the contract fields', () => {
    const c = buildNoteContext(fixture);

    expect(c.key).toBe('EKUBHHNW');
    expect(c.indexedKey).toBe('EKUBHHNW');
    expect(c.groupID).toBeNull();
    expect(c.libraryID).toBe(1);
    expect(c.itemType).toBe('book');
    expect(c.citationKey).toBe('alsaihBughyatAlmustafid2005');
    expect(c.citekey).toBe('alsaihBughyatAlmustafid2005');
    expect(c.title).toBe('Bughyat al-mustafīd li-sharḥ munyat al-murīd');
    expect(c.publisher).toBe('Dār al-Jīl');
    expect(c.place).toBe('Beirut');
    expect(c.language).toBe('ar');
  });

  it('builds the Zotero deep link, and no web link for a personal library', () => {
    const c = buildNoteContext(fixture);
    expect(c.backlink).toBe('zotero://select/library/items/EKUBHHNW');
    // The web URL needs the synced user ID, which the cache doesn't carry.
    expect(c.weblink).toBeNull();
  });

  it('scopes keys and links to a group library', () => {
    const c = buildNoteContext({ ...fixture, groupID: 2 });
    expect(c.groupID).toBe(2);
    expect(c.libraryID).toBe(2);
    expect(c.indexedKey).toBe('EKUBHHNWg2');
    expect(c.backlink).toBe('zotero://select/groups/2/items/EKUBHHNW');
    expect(c.weblink).toBe('https://www.zotero.org/groups/2/items/EKUBHHNW');
  });

  it('tolerates a missing entry', () => {
    const c = buildNoteContext(null);
    expect(c.key).toBe('');
    expect(c.groupID).toBeNull();
    expect(c.itemType).toBe('document');
    expect(c.creators).toEqual([]);
    expect(c.tags).toEqual([]);
    expect(c.attachments).toEqual([]);
    expect(c.annotations).toEqual([]);
    expect(c.notes).toEqual([]);
  });

  it('converts HTML fields but does not escape brackets (frontmatter-safe)', () => {
    const c = buildNoteContext({
      id: 'x',
      type: 'book',
      title: 'A <i>B</i> [c]',
      'title-short': '<i>S</i>',
      abstract: '<i>D</i>',
    });
    expect(c.title).toBe('A *B* [c]');
    expect(c.shortTitle).toBe('*S*');
    expect(c.abstract).toBe('*D*');
  });
});

describe('buildNoteContext() — creators', () => {
  it('recovers Zotero roles from the CSL role groups, in author-then-editor order', () => {
    const c = buildNoteContext(fixture);
    expect(c.creators.map((x) => x.role)).toEqual(['author', 'editor']);
    expect(c.creators[0]).toEqual({
      family: 'Al-Sāʾiḥ',
      given: 'Muḥammad al-ʿArabī b.',
      literal: null,
      role: 'author',
      fullName: 'Muḥammad al-ʿArabī b. Al-Sāʾiḥ',
    });
  });

  it('uses a literal for institutional creators', () => {
    const c = buildNoteContext({
      id: 'org',
      type: 'report',
      author: [{ literal: 'World Health Organization' }],
    });
    expect(c.creators[0].literal).toBe('World Health Organization');
    expect(c.creators[0].fullName).toBe('World Health Organization');
  });

  it('picks the primary role and the primary creators', () => {
    const c = buildNoteContext(fixture);
    expect(c.primaryCreatorType).toBe('author');
    expect(c.authors).toHaveLength(1);
    expect(c.authors[0].family).toBe('Al-Sāʾiḥ');
  });

  it('falls back to every creator when the primary role is absent', () => {
    const c = buildNoteContext({
      id: 'x',
      type: 'book',
      editor: [{ family: 'Uqayyil' }],
    });
    expect(c.primaryCreatorType).toBe('author');
    expect(c.authors).toEqual(c.creators);
  });

  it('formats authorsShort for one, two, and three-plus creators', () => {
    const mk = (family: string) => ({
      family,
      given: '',
      literal: null,
      role: 'author',
      fullName: family,
    });
    expect(formatAuthorsShort([mk('Smith')], 'author')).toBe('Smith');
    expect(formatAuthorsShort([mk('Smith'), mk('Jones')], 'author')).toBe(
      'Smith and Jones'
    );
    expect(
      formatAuthorsShort([mk('Smith'), mk('Jones'), mk('Lee')], 'author')
    ).toBe('Smith et al.');
  });
});

describe('buildNoteContext() — extra', () => {
  it('parses the empty cheater marker into a non-null extra with no fields', () => {
    const c = buildNoteContext(fixture);
    expect(c.extra).not.toBeNull();
    expect(c.extra!.fields).toEqual({});
    expect(c.extra!.lines).toEqual([{ raw: '{:original-date:}', key: null }]);
  });

  it('is null when Zotero has no extra', () => {
    const c = buildNoteContext({ ...fixture, _extra: undefined });
    expect(c.extra).toBeNull();
  });

  it('promotes recognised extra keys to context properties', () => {
    const c = buildNoteContext({
      id: 'x',
      type: 'book',
      _extra: 'Original Date: 1950\nPublisher: Routledge\nGoogle-Books-ID: abc',
    });
    expect(c.originalDate).toBe('1950');
    expect(c.publisher).toBe('Routledge');
    expect(c['Google-Books-ID']).toBeUndefined();
  });

  it('lets a real entry field win over the same extra key', () => {
    const c = buildNoteContext({
      id: 'x',
      type: 'book',
      publisher: 'Dār al-Jīl',
      _extra: 'Publisher: Routledge',
    });
    expect(c.publisher).toBe('Dār al-Jīl');
  });
});

describe('buildNoteContext() — tags', () => {
  it('maps tag names to the template tag shape', () => {
    const c = buildNoteContext({ ...fixture, _tags: ['sufism', 'west africa'] });
    expect(c.tags).toEqual([
      { name: 'sufism', type: 'unknown' },
      { name: 'west africa', type: 'unknown' },
    ]);
  });

  it('drops non-string tag entries', () => {
    const c = buildNoteContext({
      ...fixture,
      _tags: ['ok', '', null as unknown as string],
    });
    expect(c.tags).toEqual([{ name: 'ok', type: 'unknown' }]);
  });
});

describe('buildNoteContext() — children and note path', () => {
  it('passes child arrays through, including our note text', () => {
    const c = buildNoteContext(fixture, {
      attachments: [
        {
          key: '2VFRLV96',
          indexedKey: '2VFRLV96',
          filename: 'a.pdf',
          contentType: 'application/pdf',
          linkMode: 'imported_file',
          backlink: 'zotero://open/library/items/2VFRLV96',
          filePath: '/tmp/a.pdf',
          fileLink: () => '[[a.pdf]]',
        },
      ],
      notes: [
        {
          key: 'NOTE1',
          indexedKey: 'NOTE1',
          title: 'A note',
          noteLink: null,
          text: 'Body of the note.',
        },
      ],
    });
    expect(c.attachments).toHaveLength(1);
    expect(c.attachments[0].filename).toBe('a.pdf');
    expect(c.notes[0].text).toBe('Body of the note.');
  });

  it('builds a note link once the path is known, and null otherwise', () => {
    expect(buildNoteContext(fixture).noteLink()).toBeNull();
    const c = buildNoteContext(fixture, { notePath: '_2 Notes/@x.md' });
    expect(c.notePath).toBe('_2 Notes/@x.md');
    expect(c.noteLink()).toBe('[[_2 Notes/@x|@x]]');
    expect(c.noteLink('custom')).toBe('[[_2 Notes/@x|custom]]');
    expect(c.noteLink(undefined, 'Annotations')).toBe(
      '[[_2 Notes/@x#Annotations|@x]]'
    );
  });
});

describe('cslTypeToZoteroItemType()', () => {
  it('maps a CSL type back to a Zotero type that round-trips', () => {
    for (const [zotero, csl] of Object.entries(ZOTERO_TYPE_TO_CSL)) {
      const back = cslTypeToZoteroItemType(csl);
      expect(ZOTERO_TYPE_TO_CSL[back]).toBe(csl);
      expect(zotero).toBeDefined();
    }
  });

  it('passes through an unknown type and defaults a missing one', () => {
    expect(cslTypeToZoteroItemType('made-up')).toBe('made-up');
    expect(cslTypeToZoteroItemType(undefined)).toBe('document');
  });
});

describe('toContextDate()', () => {
  it('renders a year-only date with a working toString', () => {
    const d = toContextDate({ 'date-parts': [[2005]] });
    expect(d).toEqual({
      kind: 'year',
      value: null,
      year: 2005,
      month: null,
      day: null,
      raw: '2005',
    });
    expect(String(d)).toBe('2005');
  });

  it('renders year+month and full dates', () => {
    expect(toContextDate({ 'date-parts': [[2020, 6]] })).toMatchObject({
      kind: 'yearMonth',
      value: '2020-06',
    });
    const full = toContextDate({ 'date-parts': [[2020, 6, 15]] });
    expect(full).toMatchObject({ kind: 'date', value: '2020-06-15' });
    expect(String(full)).toBe('2020-06-15');
  });

  it('falls back to text, recovering a standalone year when it has one', () => {
    expect(toContextDate({ raw: 'n.d.' })).toMatchObject({
      kind: 'text',
      text: 'n.d.',
      year: null,
    });
    expect(toContextDate({ raw: 'circa 1500?' })).toMatchObject({
      kind: 'year',
      year: 1500,
    });
    expect(toContextDate('n.d.')).toMatchObject({ kind: 'text', text: 'n.d.' });
  });

  it('returns null when there is nothing to parse', () => {
    expect(toContextDate(undefined)).toBeNull();
    expect(toContextDate(null)).toBeNull();
    expect(toContextDate({})).toBeNull();
  });
});
