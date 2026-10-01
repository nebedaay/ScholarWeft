jest.mock(
  'obsidian',
  () => {
    class Modal {
      app: any;
      contentEl: any;
      modalEl: any;
      containerEl: any;
      constructor(app: any) {
        const doc = (globalThis as any).document;
        this.app = app;
        this.contentEl = doc.createElement('div');
        this.modalEl = doc.createElement('div');
        this.containerEl = doc.createElement('div');
      }
      open() {}
      close() {}
    }
    return {
      Modal,
      Notice: class {
        setMessage() {}
        hide() {}
      },
      FileSystemAdapter: { readLocalFile: jest.fn() },
      Keymap: { isModEvent: jest.fn(() => false) },
      MarkdownView: class {},
      Menu: class {
        addItem() {}
        showAtMouseEvent() {}
      },
      Platform: { isDesktop: false },
      TFile: class {},
      TFolder: class {},
      FuzzySuggestModal: class {},
      debounce: (fn: any) => fn,
      htmlToMarkdown: (s: string) => s.replace(/<[^>]+>/g, ''),
      normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/'),
      requestUrl: jest.fn(),
      setIcon: jest.fn(),
    };
  },
  { virtual: true }
);

jest.mock('../../bib/bibtex', () => ({ parseBibFile: jest.fn() }));

import { BibManager } from 'src/bib/bibManager';
import { AddLiteratureNotesModal } from '../addLiteratureNotesModal';
import { defaultFilters } from 'src/template/import-filters';
import { PromiseCapability } from 'src/helpers';

const entries: any[] = [
  { id: 'a', title: 'The Colour of Law', author: [{ family: 'Smith' }], type: 'book' },
  { id: 'b', title: 'Colorful Histories', author: [{ family: 'Jones' }], type: 'book' },
  { id: 'c', title: 'Colours and Colors', author: [{ family: 'Lee' }], type: 'book' },
  { id: 'd', title: 'An Unrelated Work', author: [{ family: 'Ng' }], type: 'book' },
];

function makeManager(): any {
  const init = new PromiseCapability<void>();
  init.resolve();
  const plugin: any = {
    app: {
      vault: { on: jest.fn(() => ({ detach: jest.fn() })) },
      workspace: { getActiveFile: () => null },
    },
    cacheDir: '.scholar-weft',
    initPromise: init,
    settings: {},
    registerEvent: jest.fn(),
    saveSettings: jest.fn(),
    processReferences: jest.fn(),
    scheduleCitekeyReconcile: jest.fn(),
    view: { setMessage: jest.fn() },
  };
  const manager = new BibManager(plugin);
  manager.initPromise.resolve();
  for (const e of entries) manager.bibCache.set(e.id, e);
  manager.setFuse(entries);
  plugin.bibManager = manager;
  return plugin;
}

/** A modal instance with just enough state for `computeAndRender`, no DOM. */
function makeModal(plugin: any): any {
  const m: any = Object.create(AddLiteratureNotesModal.prototype);
  m.plugin = plugin;
  m.app = plugin.app;
  m.containerEl = document.createElement('div');
  document.body.appendChild(m.containerEl);
  m.listEl = document.createElement('div');
  (m.listEl as any).empty = () => {};
  m.selected = new Set();
  m.searchAbstract = false;
  m.filters = defaultFilters();
  m.sortMode = 'relevance';
  m.sortDir = 'asc';
  m.termsByKey = new Map();
  m.renderedRefs = new Map();
  m.matches = [];
  m.rendered = 0;
  m.litNotes = new Set();
  m._refreshSeq = 0;
  m.renderMore = () => {};
  m.updateStatus = () => {};
  return m;
}

describe('AddLiteratureNotesModal search', () => {
  it('returns the same matches for color and colour', async () => {
    const plugin = makeManager();
    const ids = async (q: string): Promise<string[]> => {
      const m = makeModal(plugin);
      await m.computeAndRender(q, true, 0);
      return m.matches.map((e: any) => e.id).sort();
    };
    expect(await ids('color')).toEqual(['a', 'b', 'c']);
    expect(await ids('colour')).toEqual(await ids('color'));
    expect(await ids('colours')).toEqual(await ids('colors'));
  });
});