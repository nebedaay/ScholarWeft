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

const children: RawZoteroChildren = {
  attachments: [],
  annotations: [],
  notes: [],
};

describe('renderNote()', () => {
  it('produces content and a default @citekey filename', () => {
    const { content, fileName } = renderNote(entry, children, {
      templateSource,
      importDate: '2026-09-25',
    });
    expect(fileName).toBe('@alsaihBughyatAlmustafid2005');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('citekey: alsaihBughyatAlmustafid2005');
    expect(content).toContain('# Bughyat al-mustafīd');
    expect(content).toContain('%%sw-managed%%');
  });

  it('merges into an existing note, preserving user content', () => {
    const first = renderNote(entry, children, {
      templateSource,
      importDate: '2026-09-25',
    });

    const asUserEdited = first.content
      .replace('title: Bughyat al-mustafīd', 'title: Bughyat al-mustafīd\nmy-field: mine')
      .replace('%%/sw-managed%%', '%%/sw-managed%%\n\nMy own closing note.\n');

    const second = renderNote(
      { ...entry, title: 'A new title' },
      children,
      {
        templateSource,
        importDate: '2026-09-25',
        existingContent: asUserEdited,
      }
    );

    // Managed: title refreshed.
    expect(second.content).toContain('title: A new title');
    // Out of scope: the user's field survives.
    expect(second.content).toContain('my-field: mine');
    // User body text after the region survives.
    expect(second.content).toContain('My own closing note.');
  });
});
