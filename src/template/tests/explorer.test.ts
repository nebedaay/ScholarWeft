jest.mock(
  'obsidian',
  () => ({
    htmlToMarkdown: (html: string) =>
      html.replace(/<i>/g, '*').replace(/<\/i>/g, '*'),
  }),
  { virtual: true }
);

import type { CachedEntry } from '../context';
import { buildExplorerList, filterExplorerEntries } from '../explorer';

const raw: Array<[string, CachedEntry]> = [
  [
    'smithWork2020',
    {
      id: 'smithWork2020',
      type: 'article-journal',
      title: 'Zeta Work',
      _zoteroKey: 'AAAA1111',
      author: [{ family: 'Smith', given: 'Ada' }],
    } as CachedEntry,
  ],
  [
    'brownBook1999',
    {
      id: 'brownBook1999',
      type: 'book',
      title: 'Alpha Book',
      _zoteroKey: 'BBBB2222',
      author: [{ family: 'Brown', given: 'Bob' }],
    } as CachedEntry,
  ],
];

describe('buildExplorerList', () => {
  it('shapes entries and sorts by title', () => {
    const list = buildExplorerList(raw);
    expect(list.map((e) => e.citekey)).toEqual([
      'brownBook1999',
      'smithWork2020',
    ]);
    expect(list[1]).toMatchObject({
      title: 'Zeta Work',
      itemType: 'article-journal',
      zoteroKey: 'AAAA1111',
      creatorNames: 'Ada Smith',
    });
  });

  it('falls back to the citekey when there is no title', () => {
    const list = buildExplorerList([
      ['bareKey', { id: 'bareKey', type: 'book' } as CachedEntry],
    ]);
    expect(list[0].title).toBe('bareKey');
    expect(list[0].zoteroKey).toBeNull();
  });
});

describe('filterExplorerEntries', () => {
  const list = buildExplorerList(raw);

  it('returns everything for an empty query', () => {
    expect(filterExplorerEntries(list, '   ')).toHaveLength(2);
  });

  it('matches titles case-insensitively', () => {
    expect(filterExplorerEntries(list, 'ALPHA').map((e) => e.citekey)).toEqual([
      'brownBook1999',
    ]);
  });

  it('matches creators and Zotero keys too', () => {
    expect(filterExplorerEntries(list, 'smith').map((e) => e.citekey)).toEqual([
      'smithWork2020',
    ]);
    expect(filterExplorerEntries(list, 'BBBB').map((e) => e.citekey)).toEqual([
      'brownBook1999',
    ]);
  });
});
