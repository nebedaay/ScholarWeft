import { App, Modal, Notice, TFile } from 'obsidian';

import type ReferenceList from '../main';
import { t } from '../lang/helpers';
import type { PartialCSLEntry } from '../bib/types';
import {
  defaultFilters,
  flagsFromChildren,
  passesImportFilters,
  IMPORT_TYPE_GROUPS,
  type ImportFilters,
  type ImportItemFlags,
  type ImportTypeGroup,
} from '../template/import-filters';
import {
  sortImportEntries,
  type ImportSortMode,
  type SortDirection,
} from '../template/import-order';
import { readChildren } from '../template/children-cache';
import type { RawZoteroChildren } from '../template/children';
import { collectionToken, collectionTokens } from '../template/collections';
import { excerptForResult } from '../template/search-excerpt';
import { appendHighlighted, highlightMatchesIn } from '../template/highlight';

/**
 * Native "Add literature notes" dialogue.
 *
 * A sibling of the Better BibTeX picker ("Import literature notes from Zotero…"):
 * that one opens Zotero's own dialog; this one searches and filters WITHIN
 * Obsidian. Both stay available under distinct names.
 *
 * Search behaviour mirrors the editor popup: `@` (title/author) by default, or
 * `@@` (adds abstract + publication) when "Search abstracts" is checked.
 */

/** Rows rendered per batch; more load on scroll (Obsidian has no virtual list). */
const PAGE = 100;

/** UI labels for the type groups (keys into the locale table). */
const TYPE_GROUP_LABELS: Record<ImportTypeGroup, string> = {
  book: 'Books',
  article: 'Articles',
  chapter: 'Book sections',
  news: 'Newspaper/magazine articles',
  webpage: 'Web pages',
  other: 'Other',
};

/** Where the dialogue remembers the last search + ordering (per app). */
const LAST_SEARCH_KEY = 'scholar-weft:add-notes-search';
const DEFAULT_PLACEHOLDER = 'Search by citekey, author, title…';
const ABSTRACT_PLACEHOLDER =
  'Search citekey, author, title, abstract, publication…';

interface LastSearchState {
  query: string;
  searchAbstract: boolean;
  sortMode: ImportSortMode;
  sortDir: SortDirection;
}

/** The remembered search/ordering, or `{}` when absent/unreadable. */
function loadLastSearch(): Partial<LastSearchState> {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) || '{}');
  } catch {
    return {};
  }
}

export class AddLiteratureNotesModal extends Modal {
  private plugin: ReferenceList;
  private query = '';
  private searchAbstract = false;
  private filters: ImportFilters = defaultFilters();
  private sortMode: ImportSortMode = 'relevance';
  private sortDir: SortDirection = 'asc';
  private selected = new Set<string>();
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private dirSelect: HTMLSelectElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private rendered = 0;
  private matches: PartialCSLEntry[] = [];
  private termsByKey = new Map<string, string[]>();
  private litNotes = new Set<string>();
  private collectionQuery = '';
  private collectionListEl: HTMLElement | null = null;

  constructor(app: App, plugin: ReferenceList) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.addClass('sw-add-notes');
    if (modalEl) modalEl.addClass('sw-add-notes-modal');

    // Restore the last search + ordering BEFORE building the UI, so the box,
    // the toggle and the selects all start where the user left them and the
    // results come back. Filters are deliberately NOT restored — a stale
    // "Books only" could silently hide everything.
    const saved = loadLastSearch();
    this.query = typeof saved.query === 'string' ? saved.query : '';
    this.searchAbstract = saved.searchAbstract === true;
    this.sortMode =
      saved.sortMode === 'author' || saved.sortMode === 'dateAdded'
        ? saved.sortMode
        : 'relevance';
    this.sortDir = saved.sortDir === 'desc' ? 'desc' : 'asc';

    contentEl.createEl('h3', { text: t('Add literature notes') });

    // Search box + the abstract toggle (the `@@` tier).
    const searchRow = contentEl.createDiv({ cls: 'sw-add-notes__searchrow' });
    this.searchInput = searchRow.createEl('input', {
      cls: 'sw-add-notes__search',
      attr: {
        type: 'search',
        placeholder: t(
          this.searchAbstract ? ABSTRACT_PLACEHOLDER : DEFAULT_PLACEHOLDER
        ),
      },
    });
    this.searchInput.value = this.query;
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.persistSearch();
      this.refresh();
    });
    const absLabel = searchRow.createEl('label', { cls: 'sw-add-notes__abstract' });
    const absBox = absLabel.createEl('input', { type: 'checkbox' });
    absBox.checked = this.searchAbstract;
    absBox.addEventListener('change', () => {
      this.searchAbstract = absBox.checked;
      this.searchInput.placeholder = t(
        absBox.checked ? ABSTRACT_PLACEHOLDER : DEFAULT_PLACEHOLDER
      );
      this.persistSearch();
      this.refresh();
    });
    absLabel.appendText(' ' + t('Search abstracts'));

    // Ordering: a sort mode + a direction. "Ranked search" is the default and
    // the only mode whose order comes from the query itself; the direction
    // control is disabled for it (and, with no query, it falls back to author
    // order — see `orderMatches`).
    const orderRow = contentEl.createDiv({ cls: 'sw-add-notes__order' });
    orderRow.createSpan({ cls: 'sw-add-notes__order-label', text: t('Order by') });
    const modeSelect = orderRow.createEl('select', { cls: 'dropdown' });
    const modeOptions: Array<[ImportSortMode, string]> = [
      ['relevance', t('Ranked search')],
      ['author', t('Author, title, year')],
      ['dateAdded', t('Date added')],
    ];
    for (const [value, label] of modeOptions) {
      modeSelect.createEl('option', { text: label, value });
    }
    modeSelect.value = this.sortMode;
    this.dirSelect = orderRow.createEl('select', { cls: 'dropdown' });
    const dirOptions: Array<[SortDirection, string]> = [
      ['asc', t('Ascending')],
      ['desc', t('Descending')],
    ];
    for (const [value, label] of dirOptions) {
      this.dirSelect.createEl('option', { text: label, value });
    }
    this.dirSelect.value = this.sortDir;
    this.dirSelect.disabled = this.sortMode === 'relevance';

    modeSelect.addEventListener('change', () => {
      this.sortMode = modeSelect.value as ImportSortMode;
      // A sensible direction per mode; the user can still flip it.
      if (this.sortMode === 'dateAdded') this.sortDir = 'desc';
      else if (this.sortMode === 'author') this.sortDir = 'asc';
      if (this.dirSelect) {
        this.dirSelect.value = this.sortDir;
        this.dirSelect.disabled = this.sortMode === 'relevance';
      }
      this.persistSearch();
      this.refresh();
    });
    this.dirSelect.addEventListener('change', () => {
      this.sortDir = this.dirSelect!.value as SortDirection;
      this.persistSearch();
      this.refresh();
    });

    // Filters (left column) + list (right).
    const body = contentEl.createDiv({ cls: 'sw-add-notes__body' });
    const side = body.createDiv({ cls: 'sw-add-notes__filters' });
    this.renderFilters(side);
    const main = body.createDiv({ cls: 'sw-add-notes__pane' });
    this.listEl = main.createDiv({ cls: 'sw-add-notes__list' });
    main.addEventListener('scroll', () => {
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 200) {
        this.renderMore();
      }
    });
    // Fixed footer row INSIDE the pane: status left, actions right. Stays put
    // regardless of how long the list is.
    const footer = main.createDiv({ cls: 'sw-add-notes__footer' });
    this.statusEl = footer.createDiv({ cls: 'sw-add-notes__status' });
    const actions = footer.createDiv({ cls: 'sw-add-notes__actions' });
    const selectAll = actions.createEl('button', { text: t('Select all shown') });
    selectAll.addEventListener('click', () => {
      for (const e of this.matches) this.selected.add(e.id);
      this.redrawSelection();
      this.updateStatus();
    });
    const clear = actions.createEl('button', { text: t('Clear') });
    clear.addEventListener('click', () => {
      this.selected.clear();
      this.redrawSelection();
      this.updateStatus();
    });
    this.confirmBtn = actions.createEl('button', {
      text: t('Add notes'),
      cls: 'mod-cta',
    });
    this.confirmBtn.addEventListener('click', () => void this.createSelected());

    this.searchInput.focus();
    // A restored query is selected so typing replaces it in one go.
    if (this.query) this.searchInput.select();
    this.buildLitNoteIndex();
    this.refresh();
    // Build the library-wide presence index in the background (first open only),
    // then re-run the filters so the has-notes/PDF/annotations boxes are usable.
    if (!this.plugin.bibManager.presenceReady) {
      void this.plugin.bibManager
        .buildChildPresenceIndex()
        .then(() => {
          if (this.containerEl.isConnected) this.refresh();
        })
        .catch((e) => console.warn('[sw:add-notes] presence index failed', e));
    }
    // Collections load fast and populate the checklist; nothing is fetched if
    // the index is already built.
    if (!this.plugin.bibManager.collectionsReady) {
      void this.plugin.bibManager
        .ensureCollectionsIndex()
        .then(() => {
          if (this.containerEl.isConnected) this.renderCollectionList();
        })
        .catch((e) =>
          console.warn('[sw:add-notes] collections index failed', e)
        );
    }
    // Cold start: a restored search can only be answered once the library is
    // loaded, so re-run when it is (otherwise the box shows a query but no
    // results until something else triggers a refresh).
    if (!this.plugin.bibManager.fuseReady) {
      void this.plugin.bibManager.initPromise.promise
        .then(() => {
          if (this.containerEl.isConnected) this.refresh();
        })
        .catch(() => {});
    }
  }

  /** Remember the last search + ordering, so the next open starts there. */
  private persistSearch(): void {
    try {
      localStorage.setItem(
        LAST_SEARCH_KEY,
        JSON.stringify({
          query: this.query,
          searchAbstract: this.searchAbstract,
          sortMode: this.sortMode,
          sortDir: this.sortDir,
        })
      );
    } catch {
      /* localStorage unavailable — remembering is best-effort */
    }
  }

  private renderFilters(side: HTMLElement): void {
    const mk = (label: string, key: 'hasNotes' | 'hasAttachment' | 'hasAnnotations' | 'withoutLitNote') => {
      const row = side.createEl('label', { cls: 'sw-add-notes__filter' });
      const input = row.createEl('input', { type: 'checkbox' });
      input.checked = this.filters[key];
      input.addEventListener('change', () => {
        this.filters = { ...this.filters, [key]: input.checked };
        this.refresh();
      });
      row.appendText(' ' + label);
    };
    mk(t('Items with Zotero notes'), 'hasNotes');
    mk(t('Items with a PDF or snapshot'), 'hasAttachment');
    mk(t('Items with annotations'), 'hasAnnotations');
    mk(t('Items without a literature note'), 'withoutLitNote');

    // Item types: a union of the checked groups; NONE checked means every type,
    // so the default never hides anything.
    side.createDiv({ cls: 'sw-add-notes__filter-group', text: t('Item types') });
    for (const group of IMPORT_TYPE_GROUPS) {
      const row = side.createEl('label', { cls: 'sw-add-notes__filter' });
      const input = row.createEl('input', { type: 'checkbox' });
      input.checked = this.filters.types.includes(group);
      input.addEventListener('change', () => {
        const types = new Set(this.filters.types);
        if (input.checked) types.add(group);
        else types.delete(group);
        this.filters = { ...this.filters, types: [...types] };
        this.refresh();
      });
      row.appendText(' ' + t(TYPE_GROUP_LABELS[group]));
    }

    // Collections: a UNION (in at least one checked collection). Searchable
    // because a real library has hundreds, nested; the path disambiguates
    // duplicate names. Items in no collection are reachable via Uncategorized.
    side.createDiv({ cls: 'sw-add-notes__filter-group', text: t('Collections') });
    const colWrap = side.createDiv({ cls: 'sw-add-notes__collections' });
    const colSearch = colWrap.createEl('input', {
      cls: 'sw-add-notes__collection-search',
      attr: { type: 'search', placeholder: t('Filter collections…') },
    });
    colSearch.value = this.collectionQuery;
    colSearch.addEventListener('input', () => {
      this.collectionQuery = colSearch.value;
      this.renderCollectionList();
    });
    this.collectionListEl = colWrap.createDiv({
      cls: 'sw-add-notes__collection-list',
    });
    this.renderCollectionList();
  }

  /** Fill the collection checklist from the index, honouring the search box. */
  private renderCollectionList(): void {
    const list = this.collectionListEl;
    if (!list) return;
    list.empty();

    const uncat = list.createEl('label', { cls: 'sw-add-notes__filter' });
    const uncatBox = uncat.createEl('input', { type: 'checkbox' });
    uncatBox.checked = this.filters.uncategorized;
    uncatBox.addEventListener('change', () => {
      this.filters = { ...this.filters, uncategorized: uncatBox.checked };
      this.refresh();
    });
    uncat.appendText(' ' + t('Uncategorized'));

    const nodes = this.plugin.bibManager.collectionNodes;
    if (!nodes.length) {
      list.createDiv({
        cls: 'sw-add-notes__collection-empty',
        text: t('No collections found'),
      });
      return;
    }

    const q = this.collectionQuery.trim().toLowerCase();
    const selected = new Set(this.filters.collections);
    for (const node of nodes) {
      if (q && !node.path.toLowerCase().includes(q)) continue;
      const token = collectionToken(node.groupID, node.key);
      const row = list.createEl('label', {
        cls: 'sw-add-notes__filter sw-add-notes__collection',
      });
      // Indent by nesting depth so the hierarchy reads at a glance.
      row.style.paddingLeft = `${8 + node.depth * 10}px`;
      const input = row.createEl('input', { type: 'checkbox' });
      input.checked = selected.has(token);
      input.addEventListener('change', () => {
        const set = new Set(this.filters.collections);
        if (input.checked) set.add(token);
        else set.delete(token);
        this.filters = { ...this.filters, collections: [...set] };
        this.refresh();
      });
      row.appendText(' ' + node.path);
    }
  }

  /** Vault-wide literature-note existence, by citekey (one scan, cached). */
  private buildLitNoteIndex(): void {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const ck =
        typeof fm?.citekey === 'string'
          ? fm.citekey
          : f.basename.startsWith('@')
            ? f.basename.slice(1)
            : null;
      if (ck) this.litNotes.add(ck);
    }
  }

  private stableKeyFor(entry: PartialCSLEntry): string {
    if (typeof entry._zoteroKey !== 'string') return '';
    const gid = entry.groupID && entry.groupID !== 1 ? entry.groupID : null;
    return gid ? `${entry._zoteroKey}g${gid}` : entry._zoteroKey;
  }

  private flagsFor(entry: PartialCSLEntry): ImportItemFlags {
    const stable = this.stableKeyFor(entry);
    const children = stable
      ? readChildren<RawZoteroChildren>(this.plugin.bibManager.childrenCache, stable)
      : null;
    const groupID = entry.groupID && entry.groupID !== 1 ? entry.groupID : 1;
    const collections = collectionTokens(
      groupID,
      (entry as { _collections?: string[] })._collections
    );
    return flagsFromChildren(
      children,
      this.litNotes.has(entry.id),
      (entry as { type?: string }).type,
      collections
    );
  }

  /**
   * Order the filtered matches. "Ranked search" keeps the query ranking when
   * searching, but with NO query there is no ranking to keep — so it falls back
   * to author order rather than the cache's insertion order.
   */
  private orderMatches(entries: PartialCSLEntry[], searching: boolean): PartialCSLEntry[] {
    if (this.sortMode === 'relevance') {
      return searching ? entries : sortImportEntries(entries, 'author', 'asc');
    }
    return sortImportEntries(entries, this.sortMode, this.sortDir);
  }

  private refresh(): void {
    const q = this.query.trim();
    const searching = !!q;
    let filtered: PartialCSLEntry[];
    if (q) {
      const { entries } = this.plugin.bibManager.searchTier(
        this.searchAbstract ? 'abstract' : 'title',
        q,
        100000
      );
      filtered = entries
        .map((e) => e.entry)
        .filter((e) => passesImportFilters(this.flagsFor(e), this.filters));
      this.termsByKey = new Map(entries.map((e) => [e.entry.id, e.terms]));
    } else {
      filtered = Array.from(this.plugin.bibManager.bibCache.values()).filter(
        (e) => passesImportFilters(this.flagsFor(e), this.filters)
      );
      this.termsByKey = new Map();
    }
    this.matches = this.orderMatches(filtered, searching);
    this.rendered = 0;
    this.listEl.empty();
    this.renderMore();
    this.updateStatus();
  }

  private renderedRefs = new Map<string, HTMLElement>();

  private renderMore(): void {
    const slice = this.matches.slice(this.rendered, this.rendered + PAGE);
    for (const entry of slice) this.renderRow(entry);
    this.rendered += slice.length;
    // Fill in formatted references for the rows just added, in ONE call. Uses
    // the SHARED reference path: the same citeproc HTML the sidebar and in-body
    // references render (`.csl-entry`), so italics and every other CSL rule
    // appear here exactly as they do there. URLs/DOIs are suppressed: these are
    // search results, so a click-through link is noise.
    const unrendered = slice
      .map((e) => e.id)
      .filter((id) => !this.renderedRefs.has(id));
    if (unrendered.length) {
      void this.plugin.bibManager
        .renderEntryElements(unrendered, { suppressUrls: true })
        .then((map) => {
          for (const [k, v] of map) this.renderedRefs.set(k, v);
          if (this.containerEl.isConnected) this.fillReferences();
        })
        .catch((e) => console.warn('[sw:add-notes] reference render failed', e));
    }
  }

  /** Fill already-drawn rows with their rendered reference, when ready. */
  private fillReferences(): void {
    for (const row of Array.from(
      this.listEl.querySelectorAll('.sw-add-notes__row')
    ) as HTMLElement[]) {
      const key = row.dataset.citekey;
      if (!key) continue;
      const entry = this.renderedRefs.get(key);
      if (!entry) continue;
      const refEl = row.querySelector('.sw-add-notes__ref') as HTMLElement | null;
      if (!refEl) continue;
      // Highlight the current search's terms on the CLONE, so the cached
      // element stays clean for the next search.
      const clone = entry.cloneNode(true) as HTMLElement;
      highlightMatchesIn(clone, this.termsByKey.get(key) ?? []);
      refEl.empty();
      refEl.append(clone);
    }
  }

  /** Rich row: citekey, creators, title, the rendered reference, an excerpt. */
  private renderRow(entry: PartialCSLEntry): void {
    const row = this.listEl.createDiv({ cls: 'sw-add-notes__row' });
    row.toggleClass('is-selected', this.selected.has(entry.id));
    row.dataset.citekey = entry.id;

    // The terms that matched, emphasised in EVERY field below the citekey —
    // exactly what the `@`/`@@` popup does, via the same highlighter.
    const terms = this.termsByKey.get(entry.id) ?? [];

    const info = row.createDiv({ cls: 'sw-add-notes__info' });
    const head = info.createDiv({ cls: 'sw-add-notes__head' });
    const citekey = head.createSpan({ cls: 'sw-add-notes__citekey' });
    appendHighlighted(citekey, `@${entry.id}`, terms);
    const creators = this.creatorText(entry);
    if (creators) {
      const authors = head.createSpan({ cls: 'sw-add-notes__authors' });
      appendHighlighted(authors, creators, terms);
    }
    if (entry.groupID && entry.groupID !== 1) {
      const name =
        this.plugin.settings.zoteroGroups?.find(
          (g: { id: number; name: string }) => g.id === entry.groupID
        )?.name ?? `Group ${entry.groupID}`;
      head.createSpan({ cls: 'sw-add-notes__library', text: `· ${name}` });
    }
    if (this.litNotes.has(entry.id)) {
      head.createSpan({ cls: 'sw-add-notes__has-note', text: `· ${t('has a note')}` });
    }

    // The formatted reference, from the shared reference path — the same
    // citeproc HTML the sidebar and in-body references render, filled in
    // asynchronously by `fillReferences`. Shows the title until it is ready.
    const ref = info.createDiv({ cls: 'sw-add-notes__ref' });
    const rendered = this.renderedRefs.get(entry.id);
    if (rendered) {
      const clone = rendered.cloneNode(true) as HTMLElement;
      highlightMatchesIn(clone, terms);
      ref.append(clone);
    } else {
      appendHighlighted(ref, entry.title ?? '', terms);
    }

    // An abstract excerpt around the matched terms, when searching.
    const excerpt = excerptForResult(
      entry as { abstract?: string | null },
      terms
    );
    if (excerpt) {
      const line = info.createDiv({ cls: 'sw-add-notes__excerpt' });
      appendHighlighted(line, excerpt.text, terms);
    }

    row.addEventListener('click', () => {
      if (this.selected.has(entry.id)) this.selected.delete(entry.id);
      else this.selected.add(entry.id);
      row.toggleClass('is-selected', this.selected.has(entry.id));
      this.updateStatus();
    });
  }

  private creatorText(entry: PartialCSLEntry): string {
    const lists = [entry.author, entry.editor];
    const parts: string[] = [];
    for (const list of lists) {
      for (const n of list ?? []) {
        const name =
          (n as { literal?: string }).literal ??
          [(n as { given?: string }).given, (n as { family?: string }).family]
            .filter(Boolean)
            .join(' ');
        if (name) parts.push(name);
      }
    }
    return parts.join('; ');
  }

  private sourceFile(): TFile {
    return (
      this.app.workspace.getActiveFile() ??
      (this.app.vault.getRoot() as unknown as TFile)
    );
  }

  private redrawSelection(): void {
    for (const row of Array.from(
      this.listEl.querySelectorAll('.sw-add-notes__row')
    ) as HTMLElement[]) {
      const key = row.dataset.citekey;
      row.toggleClass('is-selected', !!key && this.selected.has(key));
    }
  }

  private updateStatus(): void {
    const total = this.matches.length;
    const n = this.selected.size;
    this.statusEl.setText(
      `${total} ${total === 1 ? t('reference') : t('references')}` +
        (n ? ` · ${n} ${t('selected')}` : '')
    );
    if (this.confirmBtn) {
      this.confirmBtn.setText(`${t('Add notes')} (${n})`);
      this.confirmBtn.toggleClass('is-disabled', n === 0);
    }
  }

  private async createSelected(): Promise<void> {
    if (!this.selected.size) return;
    const citekeys = [...this.selected];
    this.close();
    const source = this.sourceFile();
    const progress = new Notice(`Creating literature notes… 0/${citekeys.length}`, 0);
    let created = 0;
    for (const ck of citekeys) {
      try {
        await this.plugin.bibManager.createLiteratureNote(ck, source, { open: false });
        created++;
      } catch (e) {
        console.warn('[sw:add-notes] failed for', ck, e);
      }
      progress.setMessage(`Creating literature notes… ${created}/${citekeys.length}`);
    }
    progress.hide();
    new Notice(
      `Created or refreshed ${created} literature note${created === 1 ? '' : 's'}.`,
      8000
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
