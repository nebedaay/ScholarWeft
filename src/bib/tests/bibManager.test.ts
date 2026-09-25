/* eslint-disable @typescript-eslint/ban-ts-comment */

jest.mock(
  'obsidian',
  () => ({
    FileSystemAdapter: { readLocalFile: jest.fn() },
    FuzzySuggestModal: class FuzzySuggestModal {},
    Keymap: { isModEvent: jest.fn(() => false) },
    MarkdownView: class MarkdownView {},
    Menu: class Menu {
      addItem(callback: any) {
        callback({
          setTitle() {
            return this;
          },
          setIcon() {
            return this;
          },
          onClick() {
            return this;
          },
        });
        return this;
      }
      showAtMouseEvent() {
        return this;
      }
    },
    Platform: { isDesktop: false },
    TFile: class TFile {},
    debounce: (fn: any) => fn,
    htmlToMarkdown: (html: string) => html.replace(/<[^>]+>/g, ''),
    normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/'),
    requestUrl: jest.fn(),
    setIcon: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('../bibtex', () => ({
  parseBibFile: jest.fn(),
}));

import { BibManager } from '../bibManager';
import { bibPathsToCSL, searchZoteroBBT } from '../helpers';
import { parseBibFile } from '../bibtex';
import { ZOTERO_TYPE_TO_CSL, zoteroItemToCSL } from '../zotero-csl';
import { parseExtra } from '../extra';
import { SimpleLRU } from '../lru';
import { locales, styles } from 'src/parser/tests/styles';
import { PromiseCapability } from 'src/helpers';
import { PartialCSLEntry } from '../types';

const DEFAULT_STYLE = 'apa';

function makePlugin(overrides: Record<string, any> = {}) {
  const initPromise = new PromiseCapability<void>();
  initPromise.resolve();

  return {
    app: global.app,
    cacheDir: '.scholar-weft',
    initPromise,
    settings: {
      cslStyleURL: DEFAULT_STYLE,
      cslLang: 'en-US',
      renderLinkCitations: true,
      pullFromZotero: false,
      ...overrides,
    },
    registerEvent: jest.fn(),
    saveSettings: jest.fn(),
    processReferences: jest.fn(),
    view: { setMessage: jest.fn() },
  } as any;
}

function makeManager(entries: PartialCSLEntry[], settings = {}) {
  const plugin = makePlugin(settings);
  const manager = new BibManager(plugin);
  manager.initPromise.resolve();

  for (const entry of entries) {
    manager.bibCache.set(entry.id, entry);
  }
  manager.styleCache.set(DEFAULT_STYLE, styles[DEFAULT_STYLE]);
  manager.langCache.set('en-US', locales['en-US']);

  return { manager, plugin };
}

function makeFile(path = 'notes/test.md') {
  return { path, extension: 'md', basename: 'test', name: 'test.md' } as any;
}

beforeAll(() => {
  HTMLElement.prototype.findAll = function (selector: string) {
    return Array.from(this.querySelectorAll(selector)) as HTMLElement[];
  };
  HTMLElement.prototype.hasClass = function (className: string) {
    return this.classList.contains(className);
  };
  HTMLElement.prototype.onClickEvent = function (
    callback: (this: HTMLElement, ev: MouseEvent) => any,
    options?: boolean | AddEventListenerOptions
  ): void {
    this.addEventListener('click', callback, options);
  };
  HTMLElement.prototype.setAttr = function (name: string, value: string) {
    this.setAttribute(name, value);
  };
  HTMLElement.prototype.createDiv = function (options?: any, callback?: (el: HTMLDivElement) => void) {
    const el = (global as any).createDiv(options, callback);
    this.append(el);
    return el;
  };
});

beforeEach(() => {
  document.body.innerHTML = '';
  (parseBibFile as jest.Mock).mockReset();

  (global as any).app = {
    metadataCache: {
      getFileCache: jest.fn((): null => null),
      getFirstLinkpathDest: jest.fn((): null => null),
    },
    workspace: {
      getLeavesOfType: jest.fn((): any[] => []),
      openLinkText: jest.fn(),
    },
    vault: {
      on: jest.fn(() => ({ detach: jest.fn() })),
      adapter: {
        exists: jest.fn(async (): Promise<boolean> => false),
        mkdir: jest.fn(async (): Promise<void> => undefined),
        read: jest.fn(),
        write: jest.fn(),
      },
      create: jest.fn(),
    },
  };

  (global as any).createDiv = (options?: any, callback?: (el: HTMLDivElement) => void) => {
    const el = document.createElement('div');
    if (typeof options === 'string') {
      el.className = options;
    } else if (options) {
      if (options.cls) el.className = options.cls;
      if (options.text) el.textContent = options.text;
      if (options.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
          el.setAttribute(key, String(value));
        }
      }
    }
    callback?.(el);
    return el;
  };
});

// ─── SimpleLRU ────────────────────────────────────────────────────────────────

describe('SimpleLRU', () => {
  it('stores and retrieves values', () => {
    const lru = new SimpleLRU<string, number>({ max: 3 });
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.has('a')).toBe(true);
    expect(lru.get('a')).toBe(1);
    expect(lru.has('z')).toBe(false);
    expect(lru.get('z')).toBeUndefined();
  });

  it('evicts the least-recently-used entry when over max', () => {
    const evicted: string[] = [];
    const lru = new SimpleLRU<string, string>({
      max: 2,
      dispose: (v) => evicted.push(v),
    });

    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.get('a'); // access 'a' to make 'b' the oldest
    lru.set('c', 'C'); // 'b' is oldest — should be evicted
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(evicted).toEqual(['B']);
  });

  it('does not call dispose when overwriting an existing key', () => {
    const evicted: string[] = [];
    const lru = new SimpleLRU<string, string>({
      max: 2,
      dispose: (v) => evicted.push(v),
    });

    lru.set('a', 'A');
    lru.set('a', 'A2');
    expect(lru.get('a')).toBe('A2');
    expect(evicted).toEqual([]);
  });

  it('delete removes the entry', () => {
    const lru = new SimpleLRU<string, number>({ max: 5 });
    lru.set('x', 99);
    lru.delete('x');
    expect(lru.has('x')).toBe(false);
  });

  it('clear empties the cache', () => {
    const lru = new SimpleLRU<string, number>({ max: 5 });
    lru.set('a', 1);
    lru.set('b', 2);
    lru.clear();
    expect(lru.has('a')).toBe(false);
    expect(lru.has('b')).toBe(false);
  });
});

// ─── BibTeX multi-file loading ──────────────────────────────────────────────

describe('bibPathsToCSL()', () => {
  it('concatenates multiple BibTeX files before parsing so @string macros can cross file boundaries', async () => {
    (global.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);
    (global.app.vault.adapter.read as jest.Mock).mockImplementation(
      async (path: string) =>
        path === 'strings.bib'
          ? '@string{IEEE = "IEEE Transactions on Testing"}'
          : '@article{smith2020, journal = IEEE}'
    );
    (parseBibFile as jest.Mock).mockReturnValue([{ id: 'smith2020' }]);

    const result = await bibPathsToCSL(['strings.bib', 'refs.bib']);

    expect(result).toEqual([{ id: 'smith2020' }]);
    expect(parseBibFile).toHaveBeenCalledWith(
      '@string{IEEE = "IEEE Transactions on Testing"}\n\n@article{smith2020, journal = IEEE}',
      'strings.bib'
    );
  });
});

// ─── zoteroItemToCSL ─────────────────────────────────────────────────────────

describe('zoteroItemToCSL()', () => {
  const baseItem = (overrides: Record<string, any> = {}) => ({
    data: {
      citationKey: 'smith2020',
      itemType: 'journalArticle',
      title: 'A Test Article',
      creators: [{ creatorType: 'author', firstName: 'Jane', lastName: 'Smith' }],
      date: '2020-06-15',
      publicationTitle: 'Journal of Testing',
      volume: '12',
      issue: '3',
      pages: '100-110',
      DOI: '10.1234/test',
      ...overrides,
    },
  });

  it('returns null when citationKey is missing', () => {
    expect(zoteroItemToCSL({ data: { itemType: 'book' } }, 1)).toBeNull();
  });

  it('retains extra, tags, dateAdded and shortTitle for the template context', () => {
    const result = zoteroItemToCSL(
      baseItem({
        extra: 'Original Date: 1950\nPublisher: Routledge',
        tags: [{ tag: 'sufism' }, { tag: 'west africa' }],
        dateAdded: '2022-02-12T17:19:53Z',
        shortTitle: 'Short',
      }),
      1
    ) as any;
    expect(result._extra).toBe('Original Date: 1950\nPublisher: Routledge');
    expect(result._tags).toEqual(['sufism', 'west africa']);
    expect(result._dateAdded).toBe('2022-02-12T17:19:53Z');
    expect(result['title-short']).toBe('Short');
  });

  it('omits the new fields entirely when Zotero has no value for them', () => {
    // Templates test for presence, so an empty array/string must not appear as
    // though it were data.
    const result = zoteroItemToCSL(baseItem(), 1) as any;
    expect(result._extra).toBeUndefined();
    expect(result._tags).toBeUndefined();
    expect(result._dateAdded).toBeUndefined();
    expect(result['title-short']).toBeUndefined();
  });

  it('drops non-string tag entries rather than passing them through', () => {
    const result = zoteroItemToCSL(
      baseItem({ tags: [{ tag: 'ok' }, { tag: '' }, {}, null] }),
      1
    ) as any;
    expect(result._tags).toEqual(['ok']);
  });

  it('handles a real Zotero item end to end (captured from the local API)', () => {
    // The item this project has been using as a fixture. Kept verbatim so a
    // change to the mapping shows up against real data, not a tidy synthetic.
    const real = {
      key: 'EKUBHHNW',
      version: 0,
      data: {
        key: 'EKUBHHNW',
        version: 0,
        itemType: 'book',
        title: 'Bughyat al-mustafīd li-sharḥ munyat al-murīd',
        date: '2005',
        language: 'ar',
        extra: '{:original-date:}',
        place: 'Beirut',
        publisher: 'Dār al-Jīl',
        citationKey: 'alsaihBughyatAlmustafid2005',
        creators: [
          { firstName: 'Muḥammad al-ʿArabī b.', lastName: 'Al-Sāʾiḥ', creatorType: 'author' },
          { firstName: 'Saʿīd Maḥmūd', lastName: 'ʿUqayyil', creatorType: 'editor' },
        ],
        tags: [],
        collections: [],
        relations: {},
        dateAdded: '2022-02-12T17:19:53Z',
        dateModified: '2025-01-02T20:35:01Z',
      },
    };
    const r = zoteroItemToCSL(real, 1) as any;

    expect(r.id).toBe('alsaihBughyatAlmustafid2005');
    expect(r.type).toBe('book');
    expect(r.publisher).toBe('Dār al-Jīl');
    expect(r['publisher-place']).toBe('Beirut');
    expect(r.language).toBe('ar');
    expect(r.issued).toEqual({ 'date-parts': [[2005]] });
    expect(r.author).toEqual([
      { family: 'Al-Sāʾiḥ', given: 'Muḥammad al-ʿArabī b.' },
    ]);
    expect(r.editor).toEqual([{ family: 'ʿUqayyil', given: 'Saʿīd Maḥmūd' }]);
    expect(r._zoteroKey).toBe('EKUBHHNW');
    expect(r._dateAdded).toBe('2022-02-12T17:19:53Z');
    // Present but valueless: retained verbatim, and parsed as a text row.
    expect(r._extra).toBe('{:original-date:}');
    expect(parseExtra(r._extra)!.fields).toEqual({});
    // An empty tag list must not appear as data.
    expect(r._tags).toBeUndefined();
  });

  it('maps a journal article correctly', () => {
    const result = zoteroItemToCSL(baseItem(), 1);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('smith2020');
    expect((result as any).type).toBe('article-journal');
    expect((result as any).title).toBe('A Test Article');
    expect((result as any)['container-title']).toBe('Journal of Testing');
    expect((result as any).DOI).toBe('10.1234/test');
    expect((result as any).author).toEqual([{ family: 'Smith', given: 'Jane' }]);
  });

  it('sets groupID on every entry', () => {
    const result = zoteroItemToCSL(baseItem(), 42);
    expect((result as any).groupID).toBe(42);
  });

  it('parses full date (YYYY-MM-DD)', () => {
    const result = zoteroItemToCSL(baseItem(), 1);
    expect((result as any).issued).toEqual({ 'date-parts': [[2020, 6, 15]] });
  });

  it('falls back to document type for unknown itemType', () => {
    const result = zoteroItemToCSL(baseItem({ itemType: 'unknownType' }), 1);
    expect((result as any).type).toBe('document');
  });

  it('maps every configured Zotero item type to its CSL type', () => {
    expect(Object.keys(ZOTERO_TYPE_TO_CSL)).toHaveLength(38);

    for (const [itemType, cslType] of Object.entries(ZOTERO_TYPE_TO_CSL)) {
      const result = zoteroItemToCSL(baseItem({ itemType }), 1);
      expect((result as any)?.type).toBe(cslType);
    }
  });

  it('maps editor creator type', () => {
    const item = baseItem({
      creators: [{ creatorType: 'editor', firstName: 'Bob', lastName: 'Jones' }],
    });
    const result = zoteroItemToCSL(item, 1);
    expect((result as any).editor).toEqual([{ family: 'Jones', given: 'Bob' }]);
    expect((result as any).author).toBeUndefined();
  });

  it('handles institutional authors (literal name)', () => {
    const item = baseItem({
      creators: [{ creatorType: 'author', name: 'ACME Corp' }],
    });
    const result = zoteroItemToCSL(item, 1);
    expect((result as any).author).toEqual([{ literal: 'ACME Corp' }]);
  });
});

// ─── CSL rendering pipeline ─────────────────────────────────────────────────

describe('searchZoteroBBT()', () => {
  const { requestUrl } = require('obsidian');

  it('maps BBT item.search results to CSL entries keyed by citekey', async () => {
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: {
        result: [
          {
            id: 'http://zotero.org/users/1/items/ABCD',
            type: 'book',
            'citation-key': 'smith2020',
            citekey: 'smith2020',
            title: 'A Test Book',
            author: [{ family: 'Smith', given: 'Jane' }],
            issued: { 'date-parts': [['2020']] },
          },
          {
            id: 'http://zotero.org/users/1/items/EFGH',
            type: 'article-journal',
            citekey: 'doe2021',
            title: 'Other',
          },
        ],
      },
    });

    const out = await searchZoteroBBT(
      '23119',
      [['citationKey', 'contains', 'smith']],
      [1],
      20
    );

    // The URI `id` is replaced by the citekey; fields are preserved.
    expect(out.map((e) => e.id)).toEqual(['smith2020', 'doe2021']);
    expect(out[0].title).toBe('A Test Book');
    expect((out[0] as any).groupID).toBe(1);
  });
});

describe('graceful degradation without Zotero / .bib / Pandoc', () => {
  it('loadGlobalZBib() is a no-op when no Zotero groups are configured', async () => {
    const { manager } = makeManager([], {
      pullFromZotero: true,
      zoteroGroups: [],
    });
    const outcome = await manager.loadGlobalZBib(false);
    expect(outcome.attempted).toBe(false);
    expect(manager.bibCache.size).toBe(0);
  });

  it('the native adapter returns no library when Zotero is not running', async () => {
    const { manager } = makeManager([], {
      pullFromZotero: true,
      useNativeZoteroAPI: true,
      zoteroGroups: [{ id: 1, name: 'My Library' }],
    });
    const adapter = manager.getZoteroAdapter();
    const res = await adapter.getBib('', 1, true);
    expect(res.list).toBeNull();
  });

  it('searchZoteroBBT returns [] (not a throw) when the request fails', async () => {
    const { requestUrl } = require('obsidian');
    (requestUrl as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const out = await searchZoteroBBT(
      '23119',
      [['citationKey', 'contains', 'anything']],
      [1],
      20
    );
    expect(out).toEqual([]);
  });

  it('renders nothing (and records the keys) when there is no library at all', async () => {
    const { manager } = makeManager([]);
    manager.styleCache.set(DEFAULT_STYLE, styles[DEFAULT_STYLE]);
    manager.langCache.set('en-US', locales['en-US']);
    await manager.buildGlobalEngine();

    const file = makeFile('notes/nolib.md');
    const bib = await manager.getReferenceList(file, 'Nothing [@nobody1999].');

    expect(bib).toBeNull();
    expect(manager.fileCache.get(file)!.unresolvedKeys).toEqual(
      new Set(['nobody1999'])
    );
  });
});

describe('BibManager CSL rendering pipeline', () => {
  const entries: PartialCSLEntry[] = [
    {
      id: 'smith2020',
      type: 'article-journal',
      title: 'A Test Article',
      author: [{ family: 'Smith', given: 'Jane' }],
      issued: { 'date-parts': [[2020]] },
      'container-title': 'Journal of Testing',
      volume: '12',
      issue: '3',
      page: '100-110',
    } as any,
    {
      id: 'doe2021',
      type: 'book',
      title: 'A Test Book',
      author: [{ family: 'Doe', given: 'John' }],
      issued: { 'date-parts': [[2021]] },
      publisher: 'Testing Press',
    } as any,
  ];

  it('builds a CSL engine from cached style, locale, and bibliography entries', async () => {
    const { manager } = makeManager(entries);

    await manager.buildGlobalEngine();

    expect(manager.engine).toBeTruthy();
    expect(manager.fuse).toBeTruthy();
  });

  it('renders a bibliography for resolved citekeys and tracks cache metadata', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile();

    await manager.buildGlobalEngine();
    const bib = await manager.getReferenceList(
      file,
      'Smith citation [@smith2020] and Doe citation [@doe2021].'
    );

    expect(bib).toBeInstanceOf(HTMLElement);
    expect(bib.querySelectorAll('.csl-entry')).toHaveLength(2);
    expect(bib.textContent).toContain('A Test Article');
    expect(bib.textContent).toContain('A Test Book');

    const cache = manager.fileCache.get(file)!;
    expect(cache.keys).toEqual(new Set(['smith2020', 'doe2021']));
    expect(cache.resolvedKeys).toEqual(new Set(['smith2020', 'doe2021']));
    expect(cache.unresolvedKeys.size).toBe(0);
    expect(cache.citations).toHaveLength(2);
    expect(cache.citeBibMap.get('smith2020')).toContain('A Test Article');
  });

  it('pre-renders full reference entries as plain markdown text', async () => {
    const { manager } = makeManager(entries);
    await manager.buildGlobalEngine();

    const map = await manager.renderReferenceMarkdown([
      'smith2020',
      'doe2021',
      'missing2024',
    ]);

    expect(map.has('missing2024')).toBe(false);
    const smith = map.get('smith2020') ?? '';
    expect(smith).toContain('A Test Article');
    // Tags are stripped; emphasis survives as markdown.
    expect(smith).not.toMatch(/[<>]/);
  });

  it('does not render unresolved citekeys but records them in the file cache', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile();

    await manager.buildGlobalEngine();
    const bib = await manager.getReferenceList(
      file,
      'Known [@smith2020] and unknown [@missing2024].'
    );

    expect(bib.querySelectorAll('.csl-entry')).toHaveLength(1);
    expect(bib.textContent).toContain('A Test Article');
    expect(bib.textContent).not.toContain('missing2024');

    const cache = manager.fileCache.get(file)!;
    expect(cache.resolvedKeys).toEqual(new Set(['smith2020']));
    expect(cache.unresolvedKeys).toEqual(new Set(['missing2024']));
  });

  it('persists a rendered note and replays it from disk without re-rendering', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile('notes/persist.md');
    const content = 'Smith citation [@smith2020] and Doe citation [@doe2021].';

    await manager.buildGlobalEngine();
    const bib = await manager.getReferenceList(file, content);
    expect(bib).toBeInstanceOf(HTMLElement);
    expect(bib.querySelectorAll('.csl-entry')).toHaveLength(2);

    // The note was written to the in-memory persistent cache.
    const persisted = (manager as any).renderedCache.get(file.path);
    expect(persisted).toBeTruthy();
    expect(persisted.contentHash).toMatch(/^[0-9a-f]{1,8}$/);
    expect(persisted.citations).toHaveLength(2);
    expect(persisted.bibHtml).toContain('A Test Article');

    // Simulate a restart: new manager, cache loaded from disk.
    const { manager: manager2 } = makeManager(entries);
    (manager2 as any).renderedCacheLoaded = true;
    (manager2 as any).renderedCache.set(file.path, persisted);
    await manager2.buildGlobalEngine();

    const bib2 = await manager2.getReferenceList(file, content);

    // Replayed from the persisted entry: same HTML, no engine source attached
    // (proves cite()/makeBibliography were skipped).
    expect(bib2).toBeInstanceOf(HTMLElement);
    expect(bib2.textContent).toContain('A Test Article');
    expect(bib2.textContent).toContain('A Test Book');
    expect((manager2.fileCache.get(file) as any).source).toBeUndefined();
    expect(manager2.fileCache.get(file)!.citations).toHaveLength(2);
    expect(manager2.fileCache.get(file)!.citeBibMap.get('smith2020')).toContain(
      'A Test Article'
    );
  });

  it('cold start: fetches only the note’s cited keys while the full library loads', async () => {
    // Empty library + backend still loading = first-run cold start.
    const { manager } = makeManager([], {
      pullFromZotero: true,
      zoteroGroups: [{ id: 1, name: 'My Library' }],
    });
    manager.beginBackendLoad();

    const fetched: string[][] = [];
    (manager as any).getZoteroAdapter = () =>
      ({
        getCSLEntriesForCiteKeys: async (keys: string[]) => {
          fetched.push(keys);
          return entries.filter((e) => keys.includes(e.id));
        },
        getItemsForCiteKeys: async () => null,
      } as any);

    const file = makeFile('notes/cold.md');
    const bib = await manager.getReferenceList(file, 'Smith [@smith2020].');

    // The cited key was fetched on demand and rendered immediately.
    expect(fetched.flat()).toContain('smith2020');
    expect(bib).toBeInstanceOf(HTMLElement);
    expect(bib.textContent).toContain('A Test Article');
    expect(manager.fileCache.get(file)!.resolvedKeys).toEqual(
      new Set(['smith2020'])
    );

    // A partial render must NOT be persisted (so the post-load re-render runs).
    expect((manager as any).renderedCache.has(file.path)).toBe(false);

    // The full library arrives; the note re-renders with everything and persists.
    manager.markBackendReady();
    manager.bibCache.set('doe2021', entries[1]);
    await manager.buildGlobalEngine();
    const bib2 = await manager.getReferenceList(
      file,
      'Smith [@smith2020] and Doe [@doe2021].'
    );
    expect(bib2.textContent).toContain('A Test Book');
    expect((manager as any).renderedCache.has(file.path)).toBe(true);
  });

  it('does NOT treat an unreachable Zotero as a loaded library', async () => {
    // The original bug: Zotero down → 0 entries → declared "ready", so the
    // on-demand render path was disarmed and citations stayed unformatted.
    const { manager } = makeManager([], {
      pullFromZotero: true,
      useNativeZoteroAPI: true,
      zoteroGroups: [{ id: 1, name: 'My Library' }],
    });

    let engineBuilt = false;
    (manager as any).buildGlobalEngine = async () => {
      engineBuilt = true;
    };
    // Zotero is down: the adapter reports it as not running.
    (manager as any).getZoteroAdapter = () =>
      ({
        isRunning: async () => false,
        getBib: async () => ({ list: null, version: 0 }),
      } as any);

    // One attempt only, so the test doesn't wait on the backoff timers.
    await manager.loadAllSources({ fromCache: true, maxRetries: 0 });

    // The library is still considered loading, not ready.
    expect(manager.isBackendLoading).toBe(true);
    expect(manager.initPromise.settled).toBe(false);

    // And the promise really is still pending until a load succeeds.
    let resolved = false;
    void manager.initPromise.promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(engineBuilt).toBe(false);
  });

  it('marks the library ready once entries actually load', async () => {
    const { manager } = makeManager([], {
      pullFromZotero: true,
      useNativeZoteroAPI: true,
      zoteroGroups: [{ id: 1, name: 'My Library' }],
    });
    (manager as any).getZoteroAdapter = () =>
      ({
        isRunning: async () => true,
        getBib: async () => ({
          list: [{ id: 'smith2020', title: 'A Test Article' }],
          version: 1,
        }),
      } as any);

    await manager.loadAllSources({ fromCache: true, maxRetries: 0 });

    expect(manager.bibCache.has('smith2020')).toBe(true);
    expect(manager.isBackendLoading).toBe(false);
    expect(manager.initPromise.settled).toBe(true);
  });

  it('invalidates the persistent cache when note content changes', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile('notes/persist2.md');
    const content = 'Smith citation [@smith2020].';

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, content);

    const persistedBefore = (manager as any).renderedCache.get(file.path);
    expect(persistedBefore).toBeTruthy();

    // New content → full re-render with a real engine.
    const bib = await manager.getReferenceList(file, 'Smith [@smith2020] again.');
    expect(bib).toBeInstanceOf(HTMLElement);
    expect((manager.fileCache.get(file) as any).source).toBeTruthy();
  });

  it('partially re-renders: reuses cached citations when a changed entry keeps author+year', async () => {
    const { manager } = makeManager(entries, {
      zoteroGroups: [{ id: 1, name: 'My Library', libraryVersion: 100 }],
    });
    const file = makeFile('notes/partial.md');
    const content = 'Smith [@smith2020] and Doe [@doe2021].';

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, content);

    const persisted = (manager as any).renderedCache.get(file.path);
    expect(persisted).toBeTruthy();
    expect(persisted.libraryVersion).toBe(100);
    expect(persisted.authorYearFp['smith2020']).toMatch(/^[0-9a-f]{1,8}$/);

    // Simulate a Zotero edit that keeps author+year (e.g. title changed):
    // bump the library version + the entry's _version but leave author/year
    // identical.
    (manager.plugin.settings.zoteroGroups[0].libraryVersion = 101);
    const smith = {
      ...entries[0],
      _version: 99,
      title: 'A Retitled Article',
    } as any;
    manager.bibCache.set('smith2020', smith);
    manager.fileCache.delete(file);

    const bib2 = await manager.getReferenceList(file, content);
    expect(bib2).toBeInstanceOf(HTMLElement);
    const cache2 = manager.fileCache.get(file)!;
    // Citations reused from cache (engine attached, but cite() was skipped —
    // the citations array is byte-identical to the persisted one).
    expect(cache2.citations).toEqual(persisted.citations);
    expect(cache2.citations).toHaveLength(2);
    // Bibliography rebuilt with the new title.
    expect(cache2.citeBibMap.get('smith2020')).toContain('A Retitled Article');
    expect(cache2.citeBibMap.get('doe2021')).toContain('A Test Book');
    // Persisted cache updated with the new version.
    const persisted2 = (manager as any).renderedCache.get(file.path);
    expect(persisted2.versions['smith2020']).toBe(99);
  });

  it('fully re-renders when a changed entry has a different author', async () => {
    const { manager } = makeManager(entries, {
      zoteroGroups: [{ id: 1, name: 'My Library', libraryVersion: 100 }],
    });
    const file = makeFile('notes/partial-author.md');
    const content = 'Smith [@smith2020] and Doe [@doe2021].';

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, content);

    // Change the AUTHOR of smith2020 (disambiguation could shift → full render).
    (manager.plugin.settings.zoteroGroups[0].libraryVersion = 101);
    const smith = {
      ...entries[0],
      _version: 99,
      author: [{ family: 'Jones', given: 'Jane' }],
    } as any;
    manager.bibCache.set('smith2020', smith);
    manager.fileCache.delete(file);

    await manager.getReferenceList(file, content);
    const cache = manager.fileCache.get(file)!;
    // Full re-render: fresh citations (different author name).
    expect(cache.citations[0].val).toContain('Jones');
    expect(cache.citations[0].val).not.toContain('Smith');
  });

  it('lazily hydrates getCacheForPath from the persisted cache (first paint)', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile('notes/hydrate.md');
    const content = 'Smith [@smith2020].';

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, content);
    const persisted = (manager as any).renderedCache.get(file.path);
    expect(persisted).toBeTruthy();

    // Fresh manager simulating startup: persisted cache loaded, engine NOT
    // built yet (bibCache empty — library-version shortcut must carry it).
    const { manager: manager2 } = makeManager(entries);
    (manager2 as any).renderedCacheLoaded = true;
    (manager2 as any).renderedCache.set(file.path, persisted);
    (manager2 as any).fileCache.clear();

    // getAbstractFileByPath must return a TFile instance for the instanceof
    // check in getCacheForPath. stat.mtime must match the persisted entry.
    const tfile = Object.assign(new (require('obsidian').TFile)(), {
      path: file.path,
      extension: 'md',
      basename: 'hydrate',
      name: 'hydrate.md',
      stat: { mtime: persisted.mtime },
    });
    (global as any).app.vault.getAbstractFileByPath = jest.fn(() => tfile);

    // getCacheForPath hydrates synchronously — no async call needed.
    const hydrated = manager2.getCacheForPath(file.path)!;
    expect(hydrated).toBeTruthy();
    expect(hydrated.citations).toHaveLength(1);
    // Marked as already-dispatched so the later getReferenceList fast path
    // skips the forced re-render.
    expect((manager2 as any).dispatchedHashes.get(file.path)).toBe(
      persisted.contentHash
    );
  });

  it('rebuilt sidebar bibliography includes a Zotero button for every entry', async () => {
    const { manager } = makeManager(entries, {
      zoteroGroups: [{ id: 1, name: 'My Library', libraryVersion: 100 }],
    });
    const file = makeFile('notes/zotbtn.md');
    const content = 'Smith [@smith2020] and Doe [@doe2021].';

    // Both entries carry _zoteroKey like the real library cache.
    (manager.bibCache.get('smith2020') as any)._zoteroKey = 'ABC12345';
    (manager.bibCache.get('doe2021') as any)._zoteroKey = 'XYZ99999';

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, content);
    const persisted = (manager as any).renderedCache.get(file.path);
    expect(persisted).toBeTruthy();

    // Simulate cold start: persisted cache loaded, engine NOT built yet
    // (bibCache empty → the first hydration pass builds buttons without
    // Zotero links), then the engine finishes and the fast path re-renders.
    const { manager: manager2 } = makeManager(entries, {
      zoteroGroups: [{ id: 1, name: 'My Library', libraryVersion: 100 }],
    });
    (manager2 as any).renderedCacheLoaded = true;
    (manager2 as any).renderedCache.set(file.path, persisted);
    (manager2 as any).fileCache.clear();
    (manager2 as any).zCitekeyToLinks.clear(); // empty maps on cold start
    // Cold start: Zotero library not loaded yet → bibCache empty. (makeManager
    // shares the entries array by reference with `manager`, so clear it.)
    (manager2 as any).bibCache.clear();

    // First pass (Zotero engine not loaded): hydrate → no Zotero buttons.
    const tfile = Object.assign(new (require('obsidian').TFile)(), {
      path: file.path,
      extension: 'md',
      basename: 'zotbtn',
      name: 'zotbtn.md',
      stat: { mtime: persisted.mtime },
    });
    (global as any).app.vault.getAbstractFileByPath = jest.fn(() => tfile);
    const zotBtnIn = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('.clickable-icon')).filter((b) =>
        b.getAttribute('aria-label')?.includes('Open in Zotero')
      );
    const hydrated = manager2.getCacheForPath(file.path)!;
    expect(zotBtnIn(hydrated.bib!)).toHaveLength(0);

    // Second pass: engine loads (bibCache populated) → fast path re-renders
    // → Zotero button for EVERY entry.
    (manager2 as any).bibCache.set('smith2020', {
      ...entries[0],
      _zoteroKey: 'ABC12345',
    });
    (manager2 as any).bibCache.set('doe2021', {
      ...entries[1],
      _zoteroKey: 'XYZ99999',
    });
    await manager2.buildGlobalEngine();
    const bib2 = await manager2.getReferenceList(file, content);
    expect(bib2).toBeInstanceOf(HTMLElement);
    expect(zotBtnIn(bib2!)).toHaveLength(2);
  });

  it('does not hydrate getCacheForPath when the file mtime changed', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile('notes/hydrate-stale.md');
    const content = 'Smith [@smith2020].';

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, content);
    const persisted = (manager as any).renderedCache.get(file.path);
    // Simulate a persisted entry with a real mtime, far outside the 5s
    // tolerance (Obsidian's stat mtime jitters by ms; a real edit is seconds+).
    persisted.mtime = 60000;

    const tfile = Object.assign(new (require('obsidian').TFile)(), {
      path: file.path,
      extension: 'md',
      basename: 'hydrate-stale',
      name: 'hydrate-stale.md',
      stat: { mtime: 2000 }, // edited long after render
    });
    (global as any).app.vault.getAbstractFileByPath = jest.fn(() => tfile);

    expect(manager.getCacheForPath(file.path)).toBeNull();
  });

  it('derives zotero://select URLs from _zoteroKey without HTTP', async () => {
    const { manager } = makeManager(entries);
    // Attach _zoteroKey to entries as the library fetch would have.
    (manager.bibCache.get('smith2020') as any)._zoteroKey = 'ABC12345';
    (manager.bibCache.get('doe2021') as any)._zoteroKey = 'XYZ99999';

    const getItems = jest.fn(async (): Promise<any[] | null> => null);
    (manager as any).getZoteroAdapter = () => ({ getItemsForCiteKeys: getItems });

    await manager.getZLinksForKeys(new Set(['smith2020', 'doe2021']));

    expect(manager.zCitekeyToLinks.get('smith2020')).toBe(
      'zotero://select/library/items/ABC12345'
    );
    expect(manager.zCitekeyToLinks.get('doe2021')).toBe(
      'zotero://select/library/items/XYZ99999'
    );
    // No network needed for the select URLs (group 1 → library path).
    expect(getItems).not.toHaveBeenCalled();
  });

  it('persists and restores the Zotero link maps', async () => {
    const { manager } = makeManager(entries);
    manager.zCitekeyToLinks.set('smith2020', 'zotero://select/library/items/ABC12345');
    manager.zCitekeyToPDFLinks.set('smith2020', ['pdf://x.pdf']);

    const writes: string[] = [];
    (global as any).app.vault.adapter.write.mockImplementation(
      async (_p: string, data: string) => {
        writes.push(data);
      }
    );
    await manager.saveZLinks();
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(writes[writes.length - 1]);
    expect(parsed.links['smith2020']).toBe('zotero://select/library/items/ABC12345');
    expect(parsed.pdfs['smith2020']).toEqual(['pdf://x.pdf']);

    (global as any).app.vault.adapter.read.mockResolvedValue(writes[0]);
    const { manager: manager2 } = makeManager(entries);
    await manager2.loadZLinks();
    expect(manager2.zCitekeyToLinks.get('smith2020')).toBe(
      'zotero://select/library/items/ABC12345'
    );
    expect(manager2.zCitekeyToPDFLinks.get('smith2020')).toEqual(['pdf://x.pdf']);
  });

  it('skips dispatchResult when the same content hash was already rendered', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile('notes/skipdispatch.md');
    const content = 'Smith [@smith2020].';

    const queueRender = jest.fn();
    const renderer = {
      lastText: 'x',
      sections: [] as any[],
      queueRender,
    };
    (global as any).app.workspace.getLeavesOfType = jest.fn(() => [
      { view: { file, previewMode: { renderer }, editor: { cm: { dispatch: jest.fn(), state: { selection: { main: { anchor: 0, head: 0 } } }, requestMeasure: jest.fn() } } } },
    ]);

    await manager.buildGlobalEngine();
    // First render: full path → dispatchResult → forced re-render.
    await manager.getReferenceList(file, content);
    expect(queueRender).toHaveBeenCalledTimes(1);

    // Simulate the hydration case: same content already dispatched.
    const persisted = (manager as any).renderedCache.get(file.path);
    (manager as any).dispatchedHashes.set(file.path, persisted.contentHash);
    (manager as any).fileCache.delete(file);

    // Second call: fast path → dispatchResult early-returns → no re-render.
    await manager.getReferenceList(file, content);
    expect(queueRender).toHaveBeenCalledTimes(1);
  });

  it('loads and saves the rendered cache through the vault adapter', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile('notes/io.md');

    await manager.buildGlobalEngine();
    await manager.getReferenceList(file, 'Smith [@smith2020].');

    // Rendering schedules an automatic flush (debounce mocked as identity),
    // so the cache is on disk without any explicit save call.
    const writes: string[] = [];
    (global as any).app.vault.adapter.write.mockImplementation(
      async (_path: string, data: string) => {
        writes.push(data);
      }
    );
    (manager as any).renderedCacheDirty = true;
    await (manager as any).saveRenderedCache();

    expect(writes.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(writes[writes.length - 1]);
    expect(parsed.version).toBe(3);
    expect(parsed.notes['notes/io.md']).toBeTruthy();

    // Round-trip through loadRenderedCache into a fresh map.
    (global as any).app.vault.adapter.read.mockResolvedValue(writes[0]);
    const { manager: manager2 } = makeManager(entries);
    await (manager2 as any).loadRenderedCache();
    expect((manager2 as any).renderedCache.has('notes/io.md')).toBe(true);
  });

  it('returns null and caches citekeys when no CSL engine is available', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile();

    const bib = await manager.getReferenceList(file, 'Known [@smith2020].');

    expect(bib).toBeNull();

    const cache = manager.fileCache.get(file)!;
    expect(cache.keys).toEqual(new Set(['smith2020']));
    expect(cache.bib).toBeNull();
    expect(cache.citations).toEqual([]);
  });

  it('can abort before caching stale reference results', async () => {
    const { manager } = makeManager(entries);
    const file = makeFile();

    const bib = await manager.getReferenceList(
      file,
      'Known [@smith2020].',
      () => false
    );

    expect(bib).toBeUndefined();
    expect(manager.fileCache.has(file)).toBe(false);
  });

  it('scrolls from a sidebar entry to the first exact citekey occurrence', async () => {
    const { manager, plugin } = makeManager(entries);
    const file = makeFile();
    const pos = { line: 0, ch: 14 };
    const editor = {
      getValue: jest.fn(() => 'Other [@smith2020a]\nTarget [@smith2020].'),
      offsetToPos: jest.fn(() => pos),
      setCursor: jest.fn(),
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
    };
    const view = { file, editor };
    plugin.app.workspace.getLeavesOfType = jest.fn(() => [{ view }]);

    await manager.scrollToCitation('smith2020', file);

    expect(editor.offsetToPos).toHaveBeenCalledWith(28);
    expect(editor.setCursor).toHaveBeenCalledWith(pos);
    expect(editor.scrollIntoView).toHaveBeenCalledWith(
      { from: pos, to: pos },
      true
    );
    expect(editor.focus).toHaveBeenCalled();
  });

  it('replaces stale scoped bibliography watch paths when frontmatter changes', () => {
    const { manager } = makeManager(entries);
    const file = makeFile();

    (manager as any).globalWatchedBibPaths.add('global.bib');
    (manager as any).updateScopedWatchedBibPaths(file, {
      bibliography: ['refs/old.bib'],
    });

    expect((manager as any).watchedBibPaths).toEqual(
      new Set(['global.bib', 'refs/old.bib'])
    );

    (manager as any).updateScopedWatchedBibPaths(file, {
      bibliography: ['refs/new.bib'],
    });

    expect((manager as any).watchedBibPaths).toEqual(
      new Set(['global.bib', 'refs/new.bib'])
    );
  });
});

// ─── Cited-keys index reconciliation ────────────────────────────────────────
//
// Regression guard for the startup stall: the index must read only files whose
// mtime is newer than the persisted scan watermark, never the whole vault.

describe('cited-keys index reconciliation', () => {
  const tfile = (path: string, mtime: number) => {
    const name = path.split('/').pop()!;
    return Object.assign(new (require('obsidian').TFile)(), {
      path,
      extension: 'md',
      basename: name.replace(/\.md$/, ''),
      name,
      stat: { mtime },
    });
  };

  function setVault(
    files: ReturnType<typeof tfile>[],
    contents: Record<string, string> = {}
  ) {
    const vault = (global as any).app.vault;
    vault.getMarkdownFiles = jest.fn(() => files);
    vault.read = jest.fn(async (f: any) => contents[f.path] ?? '');
  }

  it('reads every indexable file when no watermark is persisted (v1/migration)', async () => {
    const { manager } = makeManager([]);
    setVault(
      [
        tfile('_1 Notes/a.md', 1000),
        tfile('_2 Bib/b.md', 1000),
        tfile('root.md', 1000), // not in an _N folder — never indexed
      ],
      {
        '_1 Notes/a.md': 'cite [@smith2020]',
        '_2 Bib/b.md': 'no citations here',
      }
    );

    const read = await manager.reconcileCitedKeysIndex();

    expect(read).toBe(2);
    expect(manager.citedKeysByFile.get('_1 Notes/a.md')).toEqual(
      new Set(['smith2020'])
    );
    // Files with no citations are not stored (only cited notes are tracked).
    expect(manager.citedKeysByFile.has('_2 Bib/b.md')).toBe(false);
    expect(manager.citedKeysByFile.has('root.md')).toBe(false);
    expect(manager.citedKeysBuiltAt).toBeGreaterThan(0);
  });

  it('re-reads only files newer than the watermark and trusts the rest', async () => {
    const { manager } = makeManager([]);
    manager.deserializeCitedKeysIndex({
      version: 2,
      mdCount: 2,
      builtAt: 5000,
      files: { '_1 Notes/a.md': ['smith2020'] },
    });
    setVault(
      [tfile('_1 Notes/a.md', 1000), tfile('_1 Notes/new.md', 9000)],
      { '_1 Notes/new.md': '[@doe2021]' }
    );

    const read = await manager.reconcileCitedKeysIndex();

    expect(read).toBe(1); // only the newer file
    expect(manager.citedKeysByFile.get('_1 Notes/a.md')).toEqual(
      new Set(['smith2020']) // trusted from the persisted index, not re-read
    );
    expect(manager.citedKeysByFile.get('_1 Notes/new.md')).toEqual(
      new Set(['doe2021'])
    );
    expect((global as any).app.vault.read).toHaveBeenCalledTimes(1);
  });

  it('drops entries for files that no longer exist', async () => {
    const { manager } = makeManager([]);
    manager.deserializeCitedKeysIndex({
      version: 2,
      builtAt: 5000,
      files: { '_1 Notes/gone.md': ['smith2020'] },
    });
    setVault([tfile('_1 Notes/a.md', 1000)]);

    await manager.reconcileCitedKeysIndex();

    expect(manager.citedKeysByFile.has('_1 Notes/gone.md')).toBe(false);
  });

  it('treats a v1 index (no builtAt) as stale and rescans it once', async () => {
    const { manager } = makeManager([]);
    manager.deserializeCitedKeysIndex({
      mdCount: 1,
      files: { '_1 Notes/a.md': ['oldkey'] },
    });
    expect(manager.citedKeysBuiltAt).toBe(0);

    setVault([tfile('_1 Notes/a.md', 1000)], {
      '_1 Notes/a.md': '[@newkey]',
    });
    const read = await manager.reconcileCitedKeysIndex();

    expect(read).toBe(1);
    expect(manager.citedKeysByFile.get('_1 Notes/a.md')).toEqual(
      new Set(['newkey'])
    );
  });

  it('shares a single scan across concurrent reconcile calls', async () => {
    const { manager } = makeManager([]);
    setVault([tfile('_1 Notes/a.md', 1000)], { '_1 Notes/a.md': '[@x]' });

    const [r1, r2] = await Promise.all([
      manager.reconcileCitedKeysIndex(),
      manager.reconcileCitedKeysIndex(),
    ]);

    expect(r1).toBe(1);
    expect(r2).toBe(1);
    expect((global as any).app.vault.read).toHaveBeenCalledTimes(1);
  });

  it('serializes and restores version + builtAt', () => {
    const { manager } = makeManager([]);
    manager.citedKeysByFile.set('_1 Notes/a.md', new Set(['smith2020']));
    manager.indexMdCount = 3;
    manager.citedKeysBuiltAt = 12345;

    const data = manager.serializeCitedKeysIndex();
    expect(data.version).toBe(2);
    expect(data.builtAt).toBe(12345);
    expect(data.files['_1 Notes/a.md']).toEqual(['smith2020']);

    const { manager: restored } = makeManager([]);
    restored.deserializeCitedKeysIndex(data);
    expect(restored.citedKeysBuiltAt).toBe(12345);
    expect(restored.citedKeysByFile.get('_1 Notes/a.md')).toEqual(
      new Set(['smith2020'])
    );
  });
});
