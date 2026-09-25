jest.mock('obsidian', () => ({ requestUrl: jest.fn() }), { virtual: true });
jest.mock(
  '../bib/helpers',
  () => ({ DEFAULT_ZOTERO_PORT: '23119', defaultHeaders: {} }),
  { virtual: true }
);

import { parseSelectUri, pickZoteroItems } from '../zoteroPicker';

const { requestUrl } = require('obsidian');

beforeEach(() => {
  (requestUrl as jest.Mock).mockReset();
});

describe('parseSelectUri', () => {
  it('reads the item key and library from a select URI', () => {
    expect(parseSelectUri('zotero://select/library/items/AAAA1111')).toEqual({
      key: 'AAAA1111',
      libraryID: 1,
    });
    expect(parseSelectUri('zotero://select/groups/222/items/BBBB2222')).toEqual({
      key: 'BBBB2222',
      libraryID: 222,
    });
  });

  it('returns nulls for anything else', () => {
    expect(parseSelectUri(undefined)).toEqual({ key: null, libraryID: null });
    expect(parseSelectUri('https://example.com')).toEqual({
      key: null,
      libraryID: null,
    });
  });
});

describe('pickZoteroItems', () => {
  it('parses the format=json array', async () => {
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      status: 200,
      json: [
        {
          citationKey: 'smithWork2020',
          uri: 'zotero://select/library/items/AAAA1111',
          item: { key: 'AAAA1111', libraryID: 1, title: 'A work' },
        },
        {
          citationKey: 'groupWork',
          uri: 'zotero://select/groups/222/items/BBBB2222',
        },
      ],
    });

    const picked = await pickZoteroItems('23119');
    expect(picked.map((p) => p.zoteroKey)).toEqual(['AAAA1111', 'BBBB2222']);
    expect(picked[0]).toMatchObject({
      citekey: 'smithWork2020',
      libraryID: 1,
      title: 'A work',
    });
    expect(picked[1].libraryID).toBe(222);
  });

  it('also accepts a { items } envelope and a text body', async () => {
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      status: 200,
      json: null,
      text: JSON.stringify({ items: [{ citekey: 'x', libraryID: 1 }] }),
    });
    const picked = await pickZoteroItems();
    expect(picked).toHaveLength(1);
    expect(picked[0].citekey).toBe('x');
  });

  it('returns an empty array when nothing is selected', async () => {
    (requestUrl as jest.Mock).mockResolvedValueOnce({ status: 200, json: [] });
    await expect(pickZoteroItems()).resolves.toEqual([]);
  });

  it('explains a 503 (another integration dialog is open)', async () => {
    (requestUrl as jest.Mock).mockResolvedValueOnce({ status: 503, text: '' });
    await expect(pickZoteroItems()).rejects.toThrow(/already showing/);
  });

  it('reports other HTTP failures', async () => {
    (requestUrl as jest.Mock).mockResolvedValueOnce({ status: 500, text: '' });
    await expect(pickZoteroItems()).rejects.toThrow(/HTTP 500/);
  });
});
