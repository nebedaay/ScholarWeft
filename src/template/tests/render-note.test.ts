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

import { readFileSync } from 'fs';
import { join } from 'path';

import { buildNoteContextWithChildren, type RawZoteroChildren } from '../children';
import type { CachedEntry } from '../context';
import { NoteTemplateEngine } from '../engine';
import { prepareTemplateData } from '../note-helpers';
import { renderNote } from '../render';

const template = readFileSync(
  join(__dirname, '../../../sw-note-templates/sw-note.eta.md'),
  'utf8'
);

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
  _extra: '{:original-date:}',
};

const raw: RawZoteroChildren = {
  attachments: [
    {
      key: 'PDF1',
      links: { enclosure: { href: 'file:///zot/Bughyat.pdf' } },
      data: {
        key: 'PDF1',
        itemType: 'attachment',
        contentType: 'application/pdf',
        linkMode: 'imported_file',
        filename: 'Bughyat.pdf',
      },
    },
  ],
  annotations: [
    {
      key: 'ANN1',
      data: {
        key: 'ANN1',
        itemType: 'annotation',
        parentItem: 'PDF1',
        annotationType: 'ink',
        annotationComment: 'An <i>idea</i>',
        annotationColor: '#FF6666',
        annotationPageLabel: '116',
        annotationPosition: '{"pageIndex":115,"rects":[]}',
        dateAdded: '2026-09-16T22:31:36Z',
        tags: [{ tag: 'tawāḍuʿ', type: 0 }],
      },
    },
  ],
  notes: [
    {
      key: 'N1',
      data: { key: 'N1', itemType: 'note', note: '<h1>Wird</h1><p>Body text</p>' },
    },
  ],
};

function render(rawChildren: RawZoteroChildren = raw, entryOverride: CachedEntry = entry): string {
  const ctx = buildNoteContextWithChildren(entryOverride, rawChildren, {
    dataDir: '/zot',
    notePath: '_2 Bibliographic notes/@alsaihBughyatAlmustafid2005.md',
    noteHeadingLevel: 3,
  });
  prepareTemplateData(ctx, { importDate: '2026-09-25' });
  return new NoteTemplateEngine().renderString(template, ctx);
}

describe('sw-related: Zotero references and tags', () => {
  const withRelated: RawZoteroChildren = {
    ...raw,
    relatedItems: [
      { key: 'REL1', citationKey: 'other2020', title: null },
      { key: 'REL2', citationKey: 'another2021', title: null },
    ],
  };

  it('links Zotero related items and tags under sw-related', () => {
    const out = render({
      ...withRelated,
      relatedItems: withRelated.relatedItems,
    });
    expect(out).toContain('sw-related:');
    expect(out).toContain('  - "[[@other2020]]"');
    expect(out).toContain('  - "[[@another2021]]"');
  });

  it('links Zotero tags as wikilinks in the same property', () => {
    const tagged = render(withRelated, {
      ...entry,
      _tags: ['islamic-law', 'manuscripts'],
    } as CachedEntry);
    expect(tagged).toContain('  - "[[islamic-law]]"');
    expect(tagged).toContain('  - "[[manuscripts]]"');
  });

  it('leaves an empty related: for the user, alongside sw-related', () => {
    const out = render(withRelated);
    expect(out).toContain('related: []');
  });

  it('rebuilds sw-related on import, so a removed tag disappears', () => {
    const existing = [
      '---',
      'zotero-key: EKUBHHNW',
      'related:',
      '  - "[[my-own-note]]"',
      'sw-related:',
      '  - "[[a-tag-i-deleted-in-zotero]]"',
      '  - "[[@other2020]]"',
      '---',
      '',
      '## Notes',
      '',
    ].join('\n');

    const merged = renderNote(entry, withRelated, {
      templateSource: template,
      dataDir: '/zot',
      importDate: '2026-09-25',
      existingContent: existing,
    });

    // Zotero-owned: the deleted tag is gone, current ones are present.
    expect(merged.content).not.toContain('a-tag-i-deleted-in-zotero');
    expect(merged.content).toContain('"[[@other2020]]"');
    expect(merged.content).toContain('"[[@another2021]]"');
    // User-owned: their own link is untouched.
    expect(merged.content).toContain('"[[my-own-note]]"');
  });

  it('migrates an upgraded note: duplicates leave related:, the rest survives', () => {
    // A note from the previous release: Zotero's tags/related items were written
    // into `related:`, mixed in with the user's own links. The user has since
    // removed one of those tags in Zotero.
    const existing = [
      '---',
      'zotero-key: EKUBHHNW',
      'related:',
      '  - "[[my-own-note]]"',
      '  - "[[@other2020]]"',
      '  - "[[@another2021]]"',
      '  - "[[a-tag-i-deleted-in-zotero]]"',
      '  - "[[a-tag-zotero-still-has]]"',
      '---',
      '',
      '## Notes',
      '',
    ].join('\n');

    const merged = renderNote(
      { ...entry, _tags: ['a-tag-zotero-still-has'] } as CachedEntry,
      withRelated,
      {
        templateSource: template,
        dataDir: '/zot',
        importDate: '2026-09-25',
        existingContent: existing,
        migrateRelated: true,
      }
    );

    const relatedBlock = /(?:^|\n)related:\n((?: {2}- .*\n)+)/.exec(
      merged.content
    )?.[1];
    const swBlock = /(?:^|\n)sw-related:\n((?: {2}- .*\n)+)/.exec(
      merged.content
    )?.[1];

    // The user's own link is untouched.
    expect(relatedBlock).toContain('my-own-note');
    // Items Zotero still supplies were removed from `related:`...
    expect(relatedBlock).not.toContain('other2020');
    expect(relatedBlock).not.toContain('another2021');
    expect(relatedBlock).not.toContain('a-tag-zotero-still-has');
    // ...but the tag deleted in Zotero was NOT removed from `related:`.
    // It is the user's only record of it now, so dropping it would lose data.
    expect(relatedBlock).toContain('a-tag-i-deleted-in-zotero');
    // Zotero's current list lives in sw-related.
    expect(swBlock).toContain('other2020');
    expect(swBlock).toContain('a-tag-zotero-still-has');
  });

  it('only tidies related: on the MIGRATION update, never again', () => {
    // A note upgraded from the previous release, with Zotero entries mixed into
    // `related:` alongside the user's own link.
    const existing = [
      '---',
      'zotero-key: EKUBHHNW',
      'related:',
      '  - "[[my-own-note]]"',
      '  - "[[@other2020]]"',
      '---',
      '',
      '## Notes',
      '',
    ].join('\n');
    const opts = {
      templateSource: template,
      dataDir: '/zot',
      importDate: '2026-09-25',
      existingContent: existing,
    };

    // 1. The migration update moves Zotero's entry out.
    const migrated = renderNote(entry, withRelated, {
      ...opts,
      migrateRelated: true,
    });
    const migratedRelated =
      /related:\n((?: {2}- .*\n)+)/.exec(migrated.content)?.[1] ?? '';
    expect(migratedRelated).toContain('my-own-note');
    expect(migratedRelated).not.toContain('other2020');

    // 2. Every LATER update leaves related: completely alone — including a link
    //    the user adds by hand later, which must never be removed even though
    //    Zotero also supplies it.
    const later = renderNote(entry, withRelated, {
      ...opts,
      existingContent: migrated.content.replace(
        '  - "[[my-own-note]]"',
        '  - "[[my-own-note]]"\n  - "[[@other2020]]"'
      ),
      migrateRelated: false,
    });
    const relatedBlock =
      /related:\n((?: {2}- .*\n)+)/.exec(later.content)?.[1] ?? '';
    expect(relatedBlock).toContain('my-own-note');
    // The user re-added it by hand; it stays even though Zotero has it.
    expect(relatedBlock).toContain('other2020');
  });

  it('never touches the user’s related: list', () => {
    const existing = [
      '---',
      'zotero-key: EKUBHHNW',
      'related:',
      '  - "[[only-mine]]"',
      '---',
      '',
      '## Notes',
      '',
    ].join('\n');

    const merged = renderNote(entry, withRelated, {
      templateSource: template,
      dataDir: '/zot',
      importDate: '2026-09-25',
      existingContent: existing,
    });
    expect(merged.content).toContain('"[[only-mine]]"');
    // The Zotero list did not leak into the user's property: `related:` holds
    // only their own link, and the Zotero entries live under `sw-related:`.
    const relatedBlock = /related:\n((?: {2}- .*\n)+)/.exec(merged.content)?.[1] ?? '';
    expect(relatedBlock).toContain('only-mine');
    expect(relatedBlock).not.toContain('other2020');
  });
});

describe('sw-note.eta.md — end-to-end render', () => {
  const out = render();

  it('opens and closes a frontmatter block', () => {
    expect(out.startsWith('---\n')).toBe(true);
    const end = out.indexOf('\n---\n');
    expect(end).toBeGreaterThan(0);
  });

  it('writes the ZotLit frontmatter shape', () => {
    expect(out).toContain('document-type: "[[zotero-import]]"');
    expect(out).toContain('created: 2026-09-25');
    expect(out).toContain('up:\n  - "[[Bibliographic Notes]]"');
    expect(out).toContain('item-type: book');
    expect(
      out.includes('title: Bughyat al-mustafīd li-sharḥ munyat al-murīd')
    ).toBe(true);
    expect(out).toContain('year: "[[2005]]"');
    expect(out).toContain('place: Beirut');
    expect(out).toContain('publisher: "[[Dār al-Jīl]]"');
    expect(out).toContain('citekey: alsaihBughyatAlmustafid2005');
    expect(out).toContain('zotero-link: zotero://select/library/items/EKUBHHNW');
  });

  it('groups creators into role-named lists', () => {
    expect(out).toContain(
      'authors:\n  - "[[Al-Sāʾiḥ, Muḥammad al-ʿArabī b.]]"'
    );
    expect(out).toContain('editors:\n  - "[[ʿUqayyil, Saʿīd Maḥmūd]]"');
  });

  it('lists attachments and aliases', () => {
    expect(out).toContain(
      'attachments:\n  - "[Bughyat.pdf](zotero://open/library/items/PDF1)"'
    );
    expect(out).toContain(
      '  - Al-Sāʾiḥ - 2005 - Bughyat al-mustafīd li-sharḥ munyat al-murīd'
    );
  });

  it('emits no body title or abstract — those live only in the frontmatter', () => {
    expect(out).not.toContain('# Bughyat al-mustafīd');
    expect(out).not.toContain('[!ABSTRACT]');
  });

  it('always emits the Notes heading, with the note text under it', () => {
    expect(out).toContain('## Notes\n\n### Wird\n\nBody text');
  });

  it('renders the annotation callout under its attachment heading', () => {
    expect(out).toContain('## Annotations');
    expect(out).toContain('### [Bughyat.pdf](zotero://open/library/items/PDF1)');
    expect(out).toContain('[!red-ink-annotation] Red Ink');
    expect(out).toContain('[!ann-comment]');
    expect(out).toContain('An *idea*');
    expect(out).toContain('- [[tawāḍuʿ]]');
    expect(out).toContain(
      '> - ([p. 116](zotero://select/library/items/ANN1), 2026-09-16)'
    );
  });

  it('keeps ## Notes OUTSIDE the managed region and Annotations inside it', () => {
    const open = out.indexOf('%%sw-managed%%');
    const close = out.indexOf('%%/sw-managed%%');
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    expect(out.indexOf('## Notes')).toBeLessThan(open);
    const region = out.slice(open, close);
    expect(region).toContain('## Annotations');
    expect(region).not.toContain('## Notes');
    // A blank line separates the notes text from the region.
    expect(out).toContain('\n\n%%sw-managed%%');
  });

  it('omits the managed region entirely when there are no annotations', () => {
    const bare = render({ attachments: raw.attachments, notes: raw.notes });
    expect(bare).not.toContain('%%sw-managed%%');
    expect(bare).not.toContain('## Annotations');
    expect(bare).toContain('## Notes');
  });

  it('emits only ## Notes when there are no notes or annotations either', () => {
    const empty = render({});
    expect(empty).not.toContain('%%sw-managed%%');
    expect(empty).toContain('## Notes');
    expect(empty.includes('### ')).toBe(false);
  });

  it('mirrors the ZotLit frontmatter field set and order', () => {
    const rich: CachedEntry = {
      ...entry,
      abstract: 'Abstract text',
      _dateAdded: '2022-02-12T17:19:53Z',
      translator: [{ family: 'T' }],
      contributor: [{ family: 'C' }],
      'collection-title': 'Series',
      'collection-number': '5',
      'number-of-volumes': '3',
    };
    const richOut = render(raw, rich);

    expect(richOut).toContain('added: 2022-02-12');
    expect(richOut).toContain('translators:\n  - "[[T]]"');
    expect(richOut).toContain('contributors:\n  - "[[C]]"');
    expect(richOut).toContain('abstract: Abstract text');
    expect(richOut).toContain('series: "[[Series]]"');
    expect(richOut).toContain('series-number: "5"');
    expect(richOut).toContain('volumes: "3"');

    const at = (key: string) => richOut.indexOf(`\n${key}:`);
    expect(at('authors')).toBeLessThan(at('editors'));
    expect(at('editors')).toBeLessThan(at('translators'));
    expect(at('translators')).toBeLessThan(at('abstract'));
    expect(at('abstract')).toBeLessThan(at('series'));
    expect(at('series')).toBeLessThan(at('contributors'));
    expect(at('contributors')).toBeLessThan(at('year'));
    expect(at('publication')).toBeLessThan(at('volumes'));
    expect(at('volumes')).toBeLessThan(at('citekey'));
    expect(at('citekey')).toBeLessThan(at('attachments'));
    expect(at('attachments')).toBeLessThan(at('aliases'));
  });

  it('always writes related, even when empty', () => {
    expect(out).toContain('related: []');
  });

  it('writes the stable zotero-key from the item key', () => {
    expect(out).toContain('zotero-key: EKUBHHNW');
    // It sits with the other Zotero identifiers (after zotero-link).
    const at = (key: string) => out.indexOf(`\n${key}:`);
    expect(at('zotero-link')).toBeLessThan(at('zotero-key'));
    expect(at('zotero-key')).toBeLessThan(at('attachments'));
  });

  it('leaves no trailing whitespace on any line', () => {
    const bad = out
      .split('\n')
      .map((line, i) => ({ i, line }))
      .filter(({ line }) => /[ \t]+$/.test(line));
    expect(bad).toEqual([]);
  });

  it('quotes values Obsidian would otherwise misparse', () => {
    // A colon-space in a value must have been quoted by the YAML builder.
    expect(out).not.toMatch(/^title: .*: /m);
  });
});
