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

function render(): string {
  const ctx = buildNoteContextWithChildren(entry, raw, {
    dataDir: '/zot',
    notePath: '_2 Bibliographic notes/@alsaihBughyatAlmustafid2005.md',
    noteHeadingLevel: 3,
  });
  prepareTemplateData(ctx, { importDate: '2026-09-25' });
  return new NoteTemplateEngine().renderString(template, ctx);
}

describe('sw-note.eta.md — end-to-end render', () => {
  const out = render();

  it('opens and closes a frontmatter block', () => {
    expect(out.startsWith('---\n')).toBe(true);
    const end = out.indexOf('\n---\n');
    expect(end).toBeGreaterThan(0);
  });

  it('writes the Zotero-Integration frontmatter shape', () => {
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

  it('emits the title and the notes body', () => {
    expect(out).toContain('# Bughyat al-mustafīd li-sharḥ munyat al-murīd');
    expect(out).toContain('## Notes');
    expect(out).toContain('### Wird\n\nBody text');
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

  it('leaves no trailing whitespace on any line', () => {
    const bad = out
      .split('\n')
      .map((line, i) => ({ i, line }))
      .filter(({ line }) => /[ \t]+$/.test(line));
    expect(bad).toEqual([]);
  });

  it('emits a block-scalar-free, Obsidian-parseable frontmatter', () => {
    // A colon-space in a value must have been quoted by the YAML builder.
    expect(out).not.toMatch(/^title: .*: /m);
  });
});
