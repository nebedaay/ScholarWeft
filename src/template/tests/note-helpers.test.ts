jest.mock(
  'obsidian',
  () => ({
    htmlToMarkdown: (html: string) =>
      html
        .replace(
          /<h([1-6])>(.*?)<\/h\1>/g,
          (_m: string, l: string, t: string) => `${'#'.repeat(Number(l))} ${t}\n\n`
        )
        .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
        .replace(/<i>(.*?)<\/i>/g, '*$1*')
        .trim(),
  }),
  { virtual: true }
);

import { NoteHelpers, prepareTemplateData, todayIso } from '../note-helpers';
import { buildNoteContextWithChildren } from '../children';
import { buildNoteContext, type CachedEntry } from '../context';

const entry: CachedEntry = {
  id: 'alsaihBughyatAlmustafid2005',
  type: 'book',
  groupID: 1,
  title: 'Bughyat al-mustafīd li-sharḥ munyat al-murīd',
  author: [{ family: 'Al-Sāʾiḥ', given: 'Muḥammad al-ʿArabī b.' }],
  editor: [{ family: 'ʿUqayyil', given: 'Saʿīd Maḥmūd' }],
  issued: { 'date-parts': [[2005]] },
  publisher: 'Dār al-Jīl',
  'publisher-place': 'Beirut',
  _zoteroKey: 'EKUBHHNW',
};

const helpers = new NoteHelpers();

describe('YAML helpers', () => {
  it('round-trips a property list through the per-render state', () => {
    const ctx = buildNoteContext(entry);
    prepareTemplateData(ctx);
    helpers.startYAML(ctx);
    helpers.addProperty(ctx, 'title', ctx.title);
    helpers.addProperty(ctx, 'year', '2005');
    helpers.addProperty(ctx, 'empty', null);
    expect(helpers.endYAML(ctx)).toBe(
      ['---', 'title: Bughyat al-mustafīd li-sharḥ munyat al-murīd', 'year: "2005"', '---', ''].join('\n')
    );
  });

  it('creates default state when a render forgets prepareTemplateData', () => {
    const ctx = buildNoteContext(entry);
    expect(helpers.isFirstImport(ctx)).toBe(true);
    expect(helpers.importDate(ctx)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('creator helpers', () => {
  it('groups creators by Zotero role with a suffix', () => {
    const ctx = buildNoteContext(entry);
    prepareTemplateData(ctx);
    expect(helpers.creatorsByType(ctx)).toEqual([
      { key: 'authors', values: ['[[Al-Sāʾiḥ, Muḥammad al-ʿArabī b.]]'] },
      { key: 'editors', values: ['[[ʿUqayyil, Saʿīd Maḥmūd]]'] },
    ]);
  });

  it('formats a creator string for the body', () => {
    const ctx = buildNoteContext(entry);
    expect(helpers.creatorNames(ctx, 'author', '{family}')).toBe('Al-Sāʾiḥ');
  });
});

describe('derived values', () => {
  it('derives a short title from the first colon', () => {
    const ctx = buildNoteContext({ ...entry, title: 'Main: subtitle' });
    expect(helpers.shortTitle(ctx)).toBe('Main');
  });

  it('prefers an explicit short title', () => {
    const ctx = buildNoteContext({ ...entry, 'title-short': 'Short' });
    expect(helpers.shortTitle(ctx)).toBe('Short');
  });

  it('builds aliases in the Zotero-Integration shape', () => {
    const ctx = buildNoteContext(entry);
    expect(helpers.aliases(ctx)).toEqual([
      'Al-Sāʾiḥ - 2005 - Bughyat al-mustafīd li-sharḥ munyat al-murīd',
      'Bughyat al-mustafīd li-sharḥ munyat al-murīd',
    ]);
  });

  it('adds et al. for three or more creators', () => {
    const ctx = buildNoteContext({
      ...entry,
      author: [
        { family: 'A' },
        { family: 'B' },
        { family: 'C' },
      ],
    });
    expect(helpers.aliases(ctx)[0]).toBe(
      'A et al. - 2005 - Bughyat al-mustafīd li-sharḥ munyat al-murīd'
    );
  });

  it('links tags and related items', () => {
    const ctx = buildNoteContext({ ...entry, _tags: ['Sufism', 'orality'] });
    expect(helpers.relatedLinks(ctx)).toEqual(['[[Sufism]]', '[[orality]]']);
  });
});

describe('child-note helpers', () => {
  const raw = {
    attachments: [
      {
        key: 'PDF1',
        links: { enclosure: { href: 'file:///zot/storage/PDF1/book.pdf' } },
        data: {
          key: 'PDF1',
          itemType: 'attachment',
          contentType: 'application/pdf',
          linkMode: 'imported_file',
          filename: 'book.pdf',
        },
      },
    ],
    notes: [
      {
        key: 'N1',
        data: { key: 'N1', itemType: 'note', note: '<h1>Wird</h1><p>Body</p>' },
      },
    ],
  };

  it('inlines the converted note text by default', () => {
    const ctx = buildNoteContextWithChildren(entry, raw);
    prepareTemplateData(ctx);
    expect(helpers.zoteroNotes(ctx)).toBe('### Wird\n\nBody');
  });

  it('re-shifts to a requested heading level', () => {
    const ctx = buildNoteContextWithChildren(entry, raw);
    prepareTemplateData(ctx, { options: { notesHeadingLevel: 2 } });
    expect(helpers.zoteroNotes(ctx, { level: 2 })).toBe('## Wird\n\nBody');
  });

  it('links an imported note file in link mode', () => {
    const ctx = buildNoteContextWithChildren(entry, raw);
    ctx.notes[0].noteLink = (alias) => `[[@N1|${alias ?? '@N1'}]]`;
    prepareTemplateData(ctx, { options: { notesMode: 'link' } });
    expect(helpers.zoteroNotes(ctx)).toBe('[[@N1|@N1]]');
  });

  it('returns an empty string with no notes', () => {
    const ctx = buildNoteContextWithChildren(entry, {});
    prepareTemplateData(ctx);
    expect(helpers.zoteroNotes(ctx)).toBe('');
  });
});

describe('filename', () => {
  it('defaults to @citekey and honours set_file_name', () => {
    const ctx = buildNoteContext(entry);
    prepareTemplateData(ctx);
    expect(helpers.fileName(ctx)).toBe('@alsaihBughyatAlmustafid2005');
    helpers.setFileName(ctx, 'Custom name');
    expect(helpers.fileName(ctx)).toBe('Custom name');
  });
});

describe('re-import merge', () => {
  it('exposes the managed field specs in template order', () => {
    const ctx = buildNoteContext(entry);
    prepareTemplateData(ctx);
    helpers.startYAML(ctx);
    helpers.addProperty(ctx, 'title', ctx.title);
    helpers.addProperty(ctx, 'citekey', ctx.citekey, { merge: 'keep' });
    helpers.addProperty(ctx, 'edition', null);
    helpers.endYAML(ctx);

    const specs = helpers.fieldSpecs(ctx);
    expect(specs.map((s) => [s.key, s.merge])).toEqual([
      ['title', 'replace'],
      ['citekey', 'keep'],
      ['edition', 'replace'],
    ]);
    // An omitted (empty) field is still in scope, so replace can remove it.
    expect(specs[2].lines).toEqual([]);
  });

  it('merges a fresh render into an existing note, keeping user data', () => {
    const ctx = buildNoteContext(entry);
    prepareTemplateData(ctx);
    helpers.startYAML(ctx);
    helpers.addProperty(ctx, 'title', 'New title');
    helpers.addProperty(ctx, 'citekey', ctx.citekey);
    helpers.endYAML(ctx);

    const existing = '---\ntitle: Old\ncustom: keep\n---\n\nuser text\n';
    const rendered =
      '---\ntitle: New title\ncitekey: alsaihBughyatAlmustafid2005\n---\n\n# H\n';
    const out = helpers.mergeInto(ctx, existing, rendered);

    expect(out).toContain('title: New title');
    expect(out).toContain('custom: keep');
    expect(out).toContain('user text');
  });

  it('returns the render untouched for a first import', () => {
    const ctx = buildNoteContext(entry);
    prepareTemplateData(ctx);
    helpers.startYAML(ctx);
    helpers.endYAML(ctx);
    expect(helpers.mergeInto(ctx, null, 'rendered')).toBe('rendered');
  });
});

describe('todayIso', () => {
  it('formats a local date', () => {
    expect(todayIso(new Date(2026, 8, 25))).toBe('2026-09-25');
  });
});
