import { App, Modal, Notice, TFile } from 'obsidian';

import type ReferenceList from '../main';
import { t } from '../lang/helpers';
import type { PartialCSLEntry } from '../bib/types';
import {
  defaultFilters,
  flagsFromChildren,
  flagsFromPresence,
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
import {
  collectionToken,
  descendantTokens,
  libraryToken,
  membershipTokens,
} from '../template/collections';
import type { CollectionNode } from '../template/collections';
import { excerptsForResult } from '../template/search-excerpt';
import { appendHighlighted, highlightMatchesIn } from '../template/highlight';
import { formatImportSummary } from '../template/import-summary';
import { setModalTitle } from './modalTitle';

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

/**
 * Most results the search will rank. The list renders a page at a time, so a
 * cap comfortably larger than any realistic scroll keeps the visible ordering
 * identical while avoiding scoring/mapping the entire library on every search.
 */
const MAX_RESULTS = 2000;

/** Wait after the last keystroke before re-running the full-library search. */
const SEARCH_DEBOUNCE_MS = 120;

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
  private collectionsEl: HTMLElement | null = null;
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

    setModalTitle(this, t('Add Literature Notes from Zotero'));
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
      // The query scores the WHOLE library synchronously, so running it on every
      // keystroke is what made typing feel like a freeze on a few thousand
      // items. Coalesce: render the first result quickly, then the settled one.
      this.scheduleRefresh();
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
    const selectAll = actions.createEl('button', { text: t('Select all results') });
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
    // Over 10k files in a large vault, walking every markdown file's metadata
    // synchronously is what made opening the modal pause. Build it on the FIRST
    // open and keep it (the vault's note set rarely changes mid-session), then
    // let the modal paint before the first (potentially long) render.
    void this.ensureLitNoteIndex();
    requestAnimationFrame(() => this.refresh());
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
    // Collections load fast and populate the tree; nothing is fetched if the
    // index is already built.
    if (!this.plugin.bibManager.collectionsReady) {
      void this.plugin.bibManager
        .ensureCollectionsIndex()
        .then(() => {
          if (this.containerEl.isConnected) this.renderCollections();
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
    // ── Show items with ──────────────────────────────────────────────────────
    side.createDiv({
      cls: 'sw-add-notes__filter-group',
      text: t('Show items with'),
    });
    const withRow = side.createDiv({ cls: 'sw-add-notes__toggles' });
    const withToggles: Array<[string, 'hasNotes' | 'hasAttachment' | 'hasAnnotations' | 'withoutLitNote']> = [
      [t('No literature note'), 'withoutLitNote'],
      [t('Zotero notes'), 'hasNotes'],
      [t('PDF/snapshot'), 'hasAttachment'],
      [t('Annotations'), 'hasAnnotations'],
    ];
    for (const [label, key] of withToggles) {
      this.toggleButton(withRow, label, this.filters[key], (on) => {
        this.filters = { ...this.filters, [key]: on };
        this.refresh();
      });
    }

    // ── Show item types ──────────────────────────────────────────────────────
    side.createDiv({
      cls: 'sw-add-notes__filter-group',
      text: t('Show item types'),
    });
    const typeRow = side.createDiv({ cls: 'sw-add-notes__toggles' });
    // "All" is on exactly when nothing specific is chosen; picking a type turns
    // it off, and clicking All clears the specific choices.
    const allBtn = typeRow.createEl('button', {
      cls: 'sw-add-notes__toggle',
      text: t('All'),
    });
    const typeBtns = new Map<ImportTypeGroup, HTMLButtonElement>();
    const syncTypeButtons = () => {
      allBtn.toggleClass('is-on', this.filters.types.length === 0);
      for (const [g, b] of typeBtns) {
        b.toggleClass('is-on', this.filters.types.includes(g));
      }
    };
    allBtn.addEventListener('click', () => {
      this.filters = { ...this.filters, types: [] };
      syncTypeButtons();
      this.refresh();
    });
    for (const group of IMPORT_TYPE_GROUPS) {
      const btn = typeRow.createEl('button', {
        cls: 'sw-add-notes__toggle',
        text: t(TYPE_GROUP_LABELS[group]),
      });
      typeBtns.set(group, btn);
      btn.addEventListener('click', () => {
        const set = new Set(this.filters.types);
        if (set.has(group)) set.delete(group);
        else set.add(group);
        this.filters = { ...this.filters, types: [...set] };
        syncTypeButtons();
        this.refresh();
      });
    }
    syncTypeButtons();

    // ── Collections ──────────────────────────────────────────────────────────
    side.createDiv({ cls: 'sw-add-notes__filter-group', text: t('Collections') });
    this.collectionsEl = side.createDiv({
      cls: 'sw-add-notes__collection-list',
    });
    this.renderCollections();
  }

  /**
   * A small on/off pill. Clicking flips it; the handler receives the new state.
   */
  private toggleButton(
    container: HTMLElement,
    label: string,
    on: boolean,
    onToggle: (on: boolean) => void
  ): HTMLButtonElement {
    const btn = container.createEl('button', {
      cls: 'sw-add-notes__toggle',
      text: label,
    });
    btn.toggleClass('is-on', on);
    btn.addEventListener('click', () => {
      const next = !btn.hasClass('is-on');
      btn.toggleClass('is-on', next);
      onToggle(next);
    });
    return btn;
  }

  /**
   * The collection tree: one heading per enabled library, then its top-level
   * collections, each subcollection nested under its parent (name only, no
   * "Parent > Child" prefix). Collections are ON by default; clicking one off
   * switches its whole subtree off.
   */
  private renderCollections(): void {
    const wrap = this.collectionsEl;
    if (!wrap) return;
    const scroll = this.collectionListEl?.scrollTop ?? 0;
    wrap.empty();

    const nodes = this.plugin.bibManager.collectionNodes;
    const off = new Set(this.filters.excludeCollections);
    const groups = this.plugin.settings.zoteroGroups ?? [];
    // Every node that can be switched: each library plus every collection.
    const allTokens = [
      ...groups.map((g) => libraryToken(g.id)),
      ...nodes.map((n) => collectionToken(n.groupID, n.key)),
    ];

    // All / None, so a single library (or one collection) can be isolated
    // without switching every other collection off by hand.
    const bar = wrap.createDiv({ cls: 'sw-add-notes__col-toolbar' });
    const allBtn = bar.createEl('button', {
      cls: 'sw-add-notes__toggle',
      text: t('All'),
    });
    allBtn.toggleClass('is-on', off.size === 0);
    allBtn.addEventListener('click', () => this.setCollections(allTokens, true));
    const noneBtn = bar.createEl('button', {
      cls: 'sw-add-notes__toggle',
      text: t('None'),
    });
    noneBtn.toggleClass(
      'is-on',
      allTokens.length > 0 && allTokens.every((tk) => off.has(tk))
    );
    noneBtn.addEventListener('click', () => this.setCollections(allTokens, false));

    const list = wrap.createDiv({ cls: 'sw-add-notes__collection-list' });
    this.collectionListEl = list;

    for (const group of groups) {
      const inGroup = nodes.filter((n) => n.groupID === group.id);
      const libToken = libraryToken(group.id);
      // A library's node hides its uncategorised items too, so it owns the
      // library token as well as every collection token.
      const groupTokens = [
        libToken,
        ...inGroup.map((n) => collectionToken(n.groupID, n.key)),
      ];
      const groupOff = off.has(libToken);

      const heading = list.createDiv({
        cls: 'sw-add-notes__library-heading',
        text: group.name || `Group ${group.id}`,
      });
      heading.toggleClass('is-off', groupOff);
      heading.addEventListener('click', () =>
        this.setCollections(groupTokens, groupOff)
      );

      const byParent = new Map<string, typeof inGroup>();
      for (const n of inGroup) {
        const parent = n.parentKey ?? '';
        const arr = byParent.get(parent) ?? [];
        arr.push(n);
        byParent.set(parent, arr);
      }
      const renderLevel = (parentKey: string, depth: number) => {
        for (const node of byParent.get(parentKey) ?? []) {
          const token = collectionToken(node.groupID, node.key);
          const row = list.createDiv({
            cls: 'sw-add-notes__col-item',
            text: node.name || node.path,
          });
          row.style.paddingLeft = `${10 + depth * 12}px`;
          row.toggleClass('is-off', off.has(token));
          row.addEventListener('click', () =>
            this.toggleCollection(node, off.has(token))
          );
          renderLevel(node.key, depth + 1);
        }
      };
      renderLevel('', 0);
    }

    if (!list.childElementCount) {
      list.createDiv({
        cls: 'sw-add-notes__collection-empty',
        text: t('No collections found'),
      });
    }
    list.scrollTop = scroll;
  }

  /** Turn a set of collection tokens on/off at once. */
  private setCollections(tokens: readonly string[], turnOn: boolean): void {
    const set = new Set(this.filters.excludeCollections);
    for (const t of tokens) {
      if (turnOn) set.delete(t);
      else set.add(t);
    }
    this.filters = { ...this.filters, excludeCollections: [...set] };
    this.renderCollections();
    this.refresh();
  }

  /** Turn a collection's whole subtree on/off and re-apply the filters. */
  private toggleCollection(node: CollectionNode, turnOn: boolean): void {
    this.setCollections(
      descendantTokens(
        this.plugin.bibManager.collectionNodes,
        node.groupID,
        node.key
      ),
      turnOn
    );
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

  /** Session flag: the note index is built once, not on every modal open. */
  private litNotesBuilt = false;

  /**
   * Build the note index on the FIRST open, off the paint path, and keep it:
   * the vault's note set rarely changes mid-session, while walking 10k+ files
   * per open is what stalled the modal. `buildLitNoteIndex` itself is fast when
   * it does run — the cost was doing it synchronously on every open.
   */
  private async ensureLitNoteIndex(): Promise<void> {
    if (this.litNotesBuilt) return;
    this.litNotesBuilt = true;
    await new Promise((r) => setTimeout(r, 0));
    this.buildLitNoteIndex();
    if (this.containerEl.isConnected) this.refresh();
  }

  private stableKeyFor(entry: PartialCSLEntry): string {
    if (typeof entry._zoteroKey !== 'string') return '';
    const gid = entry.groupID && entry.groupID !== 1 ? entry.groupID : null;
    return gid ? `${entry._zoteroKey}g${gid}` : entry._zoteroKey;
  }

  private flagsFor(entry: PartialCSLEntry): ImportItemFlags {
    const stable = this.stableKeyFor(entry);
    const groupID = entry.groupID && entry.groupID !== 1 ? entry.groupID : 1;
    const collections = membershipTokens(
      groupID,
      (entry as { _collections?: string[] })._collections
    );
    const type = (entry as { type?: string }).type;

    // The library-wide presence index is what the has-notes/PDF/annotations
    // filters must use — the fetched-children cache holds only the items whose
    // children were fetched (so filtering by it returns almost nothing). Fall
    // back to it only when presence is not built yet.
    const presence = stable
      ? this.plugin.bibManager.syncState.presence?.[stable]
      : undefined;
    if (presence) {
      return flagsFromPresence(presence, this.litNotes.has(entry.id), type, collections);
    }
    const children = stable
      ? readChildren<RawZoteroChildren>(this.plugin.bibManager.childrenCache, stable)
      : null;
    return flagsFromChildren(children, this.litNotes.has(entry.id), type, collections);
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

  private _refreshSeq = 0;

  private refresh(): void {
    const seq = ++this._refreshSeq;
    const q = this.query.trim();
    const searching = !!q;
    // Yield once so the browser can PAINT the modal (and accept typing) before
    // the synchronous compute below. Without this the open blocks on 10k+ items
    // and the caret cannot even follow your keystrokes.
    window.setTimeout(() => {
      if (seq !== this._refreshSeq || !this.containerEl.isConnected) return;
      void this.computeAndRender(q, searching, seq);
    }, 0);
  }

  private async computeAndRender(
    q: string,
    searching: boolean,
    seq: number
  ): Promise<void> {
    let filtered: PartialCSLEntry[];
    if (q) {
      // The async scan yields between chunks and is abandoned if a newer
      // keystroke lands, so typing never waits on the library scan.
      const res = await this.plugin.bibManager.searchTierAsync(
        this.searchAbstract ? 'abstract' : 'title',
        q,
        MAX_RESULTS,
        0,
        () => seq !== this._refreshSeq || !this.containerEl.isConnected
      );
      if (res.cancelled || seq !== this._refreshSeq || !this.containerEl.isConnected)
        return;
      const { entries } = res;
      filtered = entries
        .map((e) => e.entry)
        .filter((e) => passesImportFilters(this.flagsFor(e), this.filters));
      this.termsByKey = new Map(entries.map((e) => [e.entry.id, e.terms]));
    } else {
      // No query: the list is ordered by author/date. Only a page at a time is
      // rendered, so cap the set before sorting — sorting the whole library to
      // show the first page is the pause felt just after opening.
      filtered = Array.from(this.plugin.bibManager.bibCache.values())
        .filter((e) => passesImportFilters(this.flagsFor(e), this.filters))
        .slice(0, MAX_RESULTS);
      this.termsByKey = new Map();
    }
    this.matches = this.orderMatches(filtered, searching);
    this.rendered = 0;
    this.listEl.empty();
    this.renderMore();
    this.updateStatus();
  }

  private _refreshTimer: number | null = null;

  /**
   * Coalesce rapid input into ONE deferred render. Each keystroke resets the
   * timer; the search then runs once the typing settles (and the modal has had
   * a chance to paint), instead of blocking every keypress on a full-library
   * scan. `refresh()` itself yields before the compute.
   */
  private scheduleRefresh(): void {
    if (this._refreshTimer != null) window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      this._refreshTimer = null;
      if (this.containerEl.isConnected) this.refresh();
    }, SEARCH_DEBOUNCE_MS);
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
    //
    // citeproc builds a throwaway engine (~55–97 ms for a page), so it runs at
    // IDLE rather than in the keystroke path, and only if this search is still
    // current. Already-rendered references are reused from `renderedRefs`.
    const unrendered = slice
      .map((e) => e.id)
      .filter((id) => !this.renderedRefs.has(id));
    if (!unrendered.length) return;
    const token = this._refreshSeq;
    this.whenIdle(() => {
      if (token !== this._refreshSeq || !this.containerEl.isConnected) return;
      void this.plugin.bibManager
        .renderEntryElements(unrendered, { suppressUrls: true })
        .then((map) => {
          if (token !== this._refreshSeq || !this.containerEl.isConnected) return;
          for (const [k, v] of map) this.renderedRefs.set(k, v);
          this.fillReferences();
        })
        .catch((e) => console.warn('[sw:add-notes] reference render failed', e));
    });
  }

  /** Run `fn` when the main thread is idle (fallback: a short timeout). */
  private whenIdle(fn: () => void): void {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') ric(fn, { timeout: 300 });
    else window.setTimeout(fn, 30);
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

    // Abstract excerpts around the matched terms, when searching. Same render
    // as the `@@` popup: up to three lines, so several matched terms can each
    // be shown rather than one line hiding the rest.
    const excerpts = excerptsForResult(
      entry as { abstract?: string | null },
      terms,
      { maxLines: 3 }
    );
    for (const excerpt of excerpts) {
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
    // Open the note when the user asked for exactly one (and the setting allows).
    const open =
      citekeys.length === 1 && this.plugin.settings.openImportedNote !== false;
    const createdKeys: string[] = [];
    for (const ck of citekeys) {
      try {
        await this.plugin.bibManager.createLiteratureNote(ck, source, { open });
        createdKeys.push(ck);
      } catch (e) {
        console.warn('[sw:add-notes] failed for', ck, e);
      }
      progress.setMessage(
        `Creating literature notes… ${createdKeys.length}/${citekeys.length}`
      );
    }
    progress.hide();
    new Notice(
      formatImportSummary(createdKeys.map((k) => `@${k}`)),
      8000
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
