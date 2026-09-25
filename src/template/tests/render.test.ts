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

import { renderNote } from '../render';
import type { RawZoteroChildren } from '../children';
import type { CachedEntry } from '../context';

const templateSource = readFileSync(
  join(__dirname, '../../../sw-note-templates/sw-note.eta.md'),
  'utf8'
);

const entry: CachedEntry = {
  id: 'alsaihBughyatAlmustafid2005',
  type: 'book',
  groupID: 1,
  title: 'Bughyat al-mustafīd',
  author: [{ family: 'Al-Sāʾiḥ', given: 'Muḥammad' }],
  issued: { 'date-parts': [[2005]] },
  _zoteroKey: 'EKUBHHNW',
};

const attachment = {
  key: 'PDF1',
  links: { enclosure: { href: 'file:///zot/Bughyat.pdf' } },
  data: {
    key: 'PDF1',
    itemType: 'attachment',
    contentType: 'application/pdf',
    linkMode: 'imported_file',
    filename: 'Bughyat.pdf',
  },
};

const annotation = {
  key: 'A1',
  data: {
    key: 'A1',
    itemType: 'annotation',
    parentItem: 'PDF1',
    annotationType: 'highlight',
    annotationText: 'ex',
    annotationComment: '',
    annotationColor: '#FFD400',
    annotationPageLabel: '3',
    dateAdded: '2026-09-16T22:31:36Z',
    tags: [],
  },
};

const withAnnotation: RawZoteroChildren = {
  attachments: [attachment],
  annotations: [annotation],
  notes: [],
};

const withoutAnnotation: RawZoteroChildren = {
  attachments: [attachment],
  annotations: [],
  notes: [],
};

describe('renderNote()', () => {
  it('produces content and a default @citekey filename', () => {
    const { content, fileName } = renderNote(entry, withAnnotation, {
      templateSource,
      importDate: '2026-09-25',
    });
    expect(fileName).toBe('@alsaihBughyatAlmustafid2005');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('citekey: alsaihBughyatAlmustafid2005');
    expect(content).toContain('zotero-key: EKUBHHNW');
    // No body title/abstract; Notes outside the region; Annotations inside.
    expect(content).not.toContain('# Bughyat');
    expect(content).toContain('## Notes');
    expect(content).toContain('%%sw-managed%%\n## Annotations');
  });

  it('merges into an existing note, preserving user content', () => {
    const first = renderNote(entry, withAnnotation, {
      templateSource,
      importDate: '2026-09-25',
    });

    const asUserEdited = first.content
      .replace('title: Bughyat al-mustafīd', 'title: Bughyat al-mustafīd\nmy-field: mine')
      .replace('%%/sw-managed%%', '%%/sw-managed%%\n\nMy own closing note.\n');

    const second = renderNote({ ...entry, title: 'A new title' }, withAnnotation, {
      templateSource,
      importDate: '2026-09-25',
      existingContent: asUserEdited,
    });

    expect(second.content).toContain('title: A new title');
    expect(second.content).toContain('my-field: mine');
    expect(second.content).toContain('My own closing note.');
  });

  it('appends the region when annotations appear after creation', () => {
    const first = renderNote(entry, withoutAnnotation, {
      templateSource,
      importDate: '2026-09-25',
    });
    expect(first.content).not.toContain('%%sw-managed%%');

    const second = renderNote(entry, withAnnotation, {
      templateSource,
      importDate: '2026-09-25',
      existingContent: first.content,
    });
    expect(second.content).toContain('%%sw-managed%%');
    expect(second.content).toContain('## Annotations');
    expect(second.content).toContain('## Notes');
  });

  it('removes the region when annotations are deleted', () => {
    const first = renderNote(entry, withAnnotation, {
      templateSource,
      importDate: '2026-09-25',
    });
    expect(first.content).toContain('%%sw-managed%%');

    const second = renderNote(entry, withoutAnnotation, {
      templateSource,
      importDate: '2026-09-25',
      existingContent: first.content,
    });
    expect(second.content).not.toContain('%%sw-managed%%');
    expect(second.content).not.toContain('## Annotations');
    expect(second.content).toContain('## Notes');
  });
});
