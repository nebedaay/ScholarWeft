import Fuse from 'fuse.js';
import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Platform,
} from 'obsidian';
import { searchZoteroNative, searchZoteroBBT, DEFAULT_ZOTERO_PORT } from 'src/bib/helpers';
import { normalizeDiacritics } from 'src/bib/bibManager';
import { excerptForResult, findTermSpans } from 'src/template/search-excerpt';
import {
  afterOpenBracketIn,
  computeInsertion,
  insertionHint,
  insertionKind,
} from 'src/template/cite-insert';
import {
  DEFAULT_MIN_CHARS,
  DOUBLE_AT_PREFIX,
  MIN_SEARCH_CHARS,
  detectCitationTrigger,
  normalizeQueryText,
  triggerQueryText,
} from 'src/template/cite-trigger';
import {
  cycleQueries,
  getLastQuery,
  getQueryHistory,
  getRecentKeys,
  orderByRecency,
  prefixMatches,
} from 'src/template/recent-keys';
import { PartialCSLEntry } from 'src/bib/types';
import ReferenceList from 'src/main';
import { isZotLitSuggestActive } from 'src/zotlit';
export { isZotLitSuggestActive }; // re-exported for settings.tsx

// Set to true to enable verbose autocomplete logging.
const SUGGEST_DEBUG = false;
const LOG = SUGGEST_DEBUG
  ? (...args: any[]) => console.log('[sw:suggest]', ...args)
  : (..._args: any[]) => {};

// Returns a compact metadata string for a CSL entry: "Smith · 2020 · Nature"
function getEntryMeta(item: PartialCSLEntry): string {
  const e = item as any;
  const parts: string[] = [];

  const first = e.author?.[0];
  if (first) parts.push(first.family ?? first.literal ?? '');

  const year = e.issued?.['date-parts']?.[0]?.[0];
  if (year) parts.push(String(year));

  const container = e['container-title'];
  if (container && String(container).length < 50) parts.push(String(container));

  return parts.filter(Boolean).join(' · ');
}


// A non-selectable placeholder shown while the library is still loading and the
// live Zotero search returned nothing, so the user learns the index is warming
// up instead of thinking search is broken. Tagged via a `loading` flag.
const LOADING_ITEM_ID = '__scholarweft_loading__';
function loadingSuggestion(): Fuse.FuseResult<PartialCSLEntry>[] {
  return [
    {
      item: { id: LOADING_ITEM_ID } as PartialCSLEntry,
      refIndex: -1,
      score: 0,
      loading: true,
    } as any,
  ];
}
function isLoadingSuggestion(s: Fuse.FuseResult<PartialCSLEntry>): boolean {
  return (s as any)?.loading === true || s?.item?.id === LOADING_ITEM_ID;
}

export class CiteSuggest extends EditorSuggest<Fuse.FuseResult<PartialCSLEntry>> {
  private plugin: ReferenceList;

  limit = 20;

  constructor(app: App, plugin: ReferenceList) {
    super(app);

    // EditorSuggest/PopoverSuggest's own constructor already sets a public
    // `this.app` from this same argument — no need to redeclare/reassign it.
    this.plugin = plugin;

    (this as any).suggestEl.addClass('sw-suggest');
    (this as any).scope.register(['Mod'], 'Enter', (evt: KeyboardEvent) => {
      (this as any).suggestions.useSelectedItem(evt);
      return false;
    });
    // Tab cycles through previous queries while the popup is open (it would
    // otherwise indent the paragraph). Registered with no modifiers so it only
    // fires in this scope; Shift+Tab is left to Obsidian.
    (this as any).scope.register([], 'Tab', () => {
      this.cycleHistory();
      return false;
    });

    this.setInstructions([
      // Updated per search to name what Enter actually inserts (see
      // renderCount): the closer inside a bracket, or the full citation form.
      { command: '↵', purpose: 'insert [[@key]]' },
    ]);
  }

  /**
   * Update the footer row: the closing mark on the left, the result count on
   * the right. One row, so the popup does not grow a second line.
   */
  private renderCount(shown: number, total = shown): void {
    // "20 of 137" when the list is capped, plain "7 results" when everything
    // fits — so a truncated list is never mistaken for the whole answer.
    const truncated = total > shown;
    // Phrased as a sentence fragment so the row reads clearly on its own:
    //   ⌘ ↵ close with ]]                     Showing 20 of 137 results
    const summary =
      shown === 0
        ? 'No results'
        : truncated
          ? `Showing ${shown} of ${total} results`
          : total === 1
            ? '1 result'
            : `${total} results`;
    this.setInstructions([
      // Enter performs the context-aware insertion; the hint names it.
      { command: '↵', purpose: this._insertionHint },
      ...(this._pandocHint
        ? [
            {
              command: Platform.isMacOS ? '⌘ ↵' : 'ctrl ↵',
              purpose: 'Pandoc citation',
            },
          ]
        : []),
      // `command` renders first, so an empty one keeps the summary as the
      // whole right-hand phrase rather than splitting it across two spans.
      { command: '', purpose: summary },
    ]);
  }

  /** Names what Enter inserts in the current context, for the footer. */
  private _insertionHint = 'insert [[@key]]';

  /** Show the ⌘/Ctrl+Enter "Pandoc citation" hint? Only for a bare `@`. */
  private _pandocHint = false;

  /** Record the insertion hint for the current context, for the footer. */
  private setInsertionHint(context: EditorSuggestContext): void {
    const line = context.editor.getLine(context.start.line) ?? '';
    const beforeStart = line.substring(0, context.start.ch);
    const afterCursor = line.substring(context.end.ch);
    const afterOpenBracket = afterOpenBracketIn(beforeStart);
    const linked = this.plugin.settings.renderLinkCitations !== false;
    this._insertionHint = insertionHint(
      { beforeStart, afterCursor, afterOpenBracket },
      { linked }
    );
    // The Pandoc escape hatch only changes the result for a bare `@` while
    // linked citations are in use; elsewhere the closer is unambiguous.
    this._pandocHint =
      linked &&
      insertionKind({ beforeStart, afterCursor, afterOpenBracket }) === 'bare';
  }

  async getSuggestions(
    context: EditorSuggestContext
  ): Promise<Fuse.FuseResult<PartialCSLEntry>[]> {
    const isDoubleAtMode = context.query.startsWith(DOUBLE_AT_PREFIX);
    const rawQuery = context.query.slice(isDoubleAtMode ? 1 : 0).trim();
    // An underscore stands in for a space in a single-token query, so
    // `@social_theory` searches "social theory" without needing `@@`.
    const searchQuery = normalizeQueryText(rawQuery);

    LOG(
      'getSuggestions query=',
      JSON.stringify(searchQuery),
      'mode=',
      isDoubleAtMode ? '@@' : '@'
    );

    // `@` searches titles and creators as well as citekeys, because `@` is what
    // a citation looks like — reaching for it is natural. An exact or leading
    // citekey match ranks at the very top (see scoreEntry), so citekey lookup
    // still works for anyone who types one. `@@` adds the abstract,
    // journal/book title, series and publisher.
    //
    // ALL `@` queries take this path, spaced or not. Previously an unspaced `@`
    // went to `searchCitekeyFirst`, which returns early on the first tier that
    // matches — so a query with any citekey prefix never reached the title and
    // creator search at all, and `@` behaved as citekey-only.
    const useMultiField = true;

    // Reset per-search state. Every path below records the terms it matched, so
    // highlighting cannot inherit stale terms from the previous search.
    this._matchedTermsByKey = new Map();
    this.renderCount(0);

    const { plugin } = this;
    const { bibManager } = plugin;
    // Do NOT bail out while the local index is still building. Previously this
    // returned [] for the first several minutes after a fresh install, so
    // autocomplete looked broken. Fall through to the live Zotero search below
    // and, only if that finds nothing either, show a "still loading" line.
    const indexReady = bibManager.fuseReady;

    // ── `@` and `@@`: our multi-field search ───────────────────────────────
    // Always uses the global index — per-file bibliography overrides are
    // intentionally ignored here since this is a full-library search.
    //
    // ZotLit is NOT consulted. Its database search offered the same kind of
    // item lookup our own index does (it never searched PDF full text), and
    // ours is rankable and works without the plugin. ZotLit remains only as a
    // last-resort accelerator below, when our index is missing and its own is
    // present — never as the source of truth for what @@ means.
    if (useMultiField) {
      // `@` searches citekey, author (first / last / single name) and title.
      // `@@` adds abstract, publisher and containing work (journal or book
      // title). Two levels only: a third was introduced briefly and removed,
      // since `@@` covers it and nobody had built a habit around it.
      const tier = isDoubleAtMode ? 'abstract' : 'title';
      const fuse = bibManager.fuseForTier(tier) ?? bibManager.fuse;

      if (!fuse) {
        // No local index yet (a fresh install). Prefer Zotero live search, then
        // ZotLit's index if that is all we have, then say "still loading".
        const items = await this.liveSearch(searchQuery, 'text');
        if (items.length) {
          return items.map((item, refIndex) => ({ item, refIndex, score: 0.5 }));
        }
        const zotlitResults = await this.zotlitFallback(searchQuery);
        if (zotlitResults.length) return zotlitResults;
        return indexReady ? [] : loadingSuggestion();
      }

      LOG(`tier=${tier}, docs=`, (fuse as any)?._docs?.length ?? 0);

      // Below the scorer's minimum (MIN_SEARCH_CHARS) there is nothing to rank,
      // so serve by RECENCY and citekey PREFIX instead: 0 characters shows the
      // most recently used references; 1–2 show citekeys starting with them.
      // See recent-keys.ts.
      if (searchQuery.length < MIN_SEARCH_CHARS) {
        const { items, total } = this.shortQuerySuggestions(searchQuery);
        this.renderCount(items.length, total);
        if (items.length) {
          return items.map((item, refIndex) => ({ item, refIndex, score: 0 }));
        }
        // Nothing recent/prefix-matching: fall through to live/ZotLit/loading.
      } else {
        // searchTier ranks by exact phrase, coverage, whole words and position —
        // and does its own AND filtering. Nothing further to re-rank here.
        const { entries, total } = bibManager.searchTier(
          tier,
          searchQuery,
          this.limit
        );
        // The terms recorded are those of the interpretation that MATCHED each
        // entry, not the raw query: an unbroken query like `islamwomenauthority`
        // appears in no field, while the words it split into do. Used for BOTH
        // the excerpt (`@@`) and for highlighting every field — so this must be
        // recorded for BOTH tiers.
        this._matchedTermsByKey = new Map(
          entries.map((e) => [e.entry.id, e.terms])
        );
        // Show an honest count: "20 of 137" when the list is truncated, so a
        // capped result does not read like "only 20 matched".
        this.renderCount(entries.length, total);
        if (entries.length > 0) {
          return entries.map(({ entry }, refIndex) => ({
            item: entry,
            refIndex,
            score: 0,
          }));
        }
      }

      // Nothing in the index — try Zotero live, then ZotLit, then say
      // "still loading" if the index is still building.
      const live = await this.liveSearch(searchQuery, 'text');
      if (live.length) {
        LOG('live Zotero returned', live.length, 'items');
        this._matchedTermsByKey = new Map(
          live.map((item) => [item.id, [searchQuery]])
        );
        this.renderCount(live.length);
        return live.map((item, refIndex) => ({ item, refIndex, score: 0.5 }));
      }
      const zotlitResults = await this.zotlitFallback(searchQuery);
      if (zotlitResults.length) return zotlitResults;
      return indexReady ? [] : loadingSuggestion();
    }
  }

  /**
   * Suggestions for a short query (0, 1 or 2 characters), bypassing the ranked
   * scorer. 0 characters leads with THIS note's last query (if fresh) so a
   * search can be reused to cite several works; otherwise the most recently
   * used references. 1–2 characters show citekeys that START with them.
   * Ordering — MRU, then Zotero `dateAdded` desc, then A–Z — is in
   * `recent-keys.ts`.
   */
  private shortQuerySuggestions(query: string): {
    items: PartialCSLEntry[];
    total: number;
  } {
    const bib = this.plugin.bibManager;
    // Recents and the last query are scoped to the ACTIVE note: notes are about
    // different things, so a shared history would be noise.
    const notePath = this.plugin.app.workspace.getActiveFile()?.path ?? '';

    // 0 characters: this note's last query, when it is fresh.
    if (!query) {
      const last = getLastQuery(bib.queryHistory, notePath, Date.now());
      if (last) {
        const rerun = normalizeQueryText(last.query);
        if (rerun) {
          const { entries, total } = bib.searchTier(
            last.doubleAt ? 'abstract' : 'title',
            rerun,
            this.limit
          );
          if (entries.length) {
            this._matchedTermsByKey = new Map(
              entries.map((e) => [e.entry.id, e.terms])
            );
            return { items: entries.map((e) => e.entry), total };
          }
        }
      }
    }

    const entries = Array.from(bib.bibCache.values());
    if (!entries.length) return { items: [], total: 0 };
    const base = query ? prefixMatches(entries, query) : entries;
    // THIS note's recents first, then the global MRU, then Zotero dateAdded —
    // concatenation is the tier order (first occurrence wins in the rank map),
    // so a note with no history still shows something useful.
    const recents = [
      ...getRecentKeys(bib.recentKeys, notePath),
      ...bib.globalRecentKeys,
    ];
    const ordered = orderByRecency(base, recents);
    return { items: ordered.slice(0, this.limit), total: ordered.length };
  }

  /**
   * Tab: replace the query with the previous one (most recent first), cycling
   * this note's queries then the global history, and wrapping at the end. The
   * stored MODE (`@`/`@@`) is reproduced so the same results come back.
   */
  private cycleHistory(): void {
    const context = this.context;
    if (!context) return;
    const bib = this.plugin.bibManager;
    const notePath = this.plugin.app.workspace.getActiveFile()?.path ?? '';
    const list = cycleQueries(
      getQueryHistory(bib.queryHistory, notePath),
      bib.globalQueryHistory
    );
    if (!list.length) return;

    const doubleAt = context.query.startsWith(DOUBLE_AT_PREFIX);
    const current = context.query.slice(doubleAt ? 1 : 0).trim();
    const idx = list.findIndex(
      (e) => e.query === current && e.doubleAt === doubleAt
    );
    const next = idx === -1 ? list[0] : list[(idx + 1) % list.length];
    const text = `${next.doubleAt ? '@@' : '@'}${next.query}`;

    // Replace from the marker to the cursor; Obsidian re-runs the suggest on the
    // resulting editor change, so the results follow the query.
    context.editor.replaceRange(text, context.start, context.end);
    context.editor.setCursor({
      line: context.start.line,
      ch: context.start.ch + text.length,
    });
  }

  /**
   * ZotLit's own index, used ONLY when ours is unavailable and Zotero's live
   * search came up empty. It is an accelerator, not a dependency: `@@` works
   * identically with ZotLit absent.
   */
  private async zotlitFallback(
    searchQuery: string
  ): Promise<Fuse.FuseResult<PartialCSLEntry>[]> {
    const db = (this.plugin.app as any).plugins?.plugins?.['zotlit']?.database;
    if (!db) return [];
    try {
      const raw: any[] = searchQuery
        ? await db.search(searchQuery)
        : await db.getItemsOf(this.limit);
      if (!raw?.length) return [];
      LOG('@@ ZotLit fallback returned', raw.length, 'items');
      return raw
        .map((r: any, refIndex: number) => {
          const titleRaw = r.item?.title;
          const title: string | undefined = Array.isArray(titleRaw)
            ? titleRaw[0]
            : typeof titleRaw === 'string'
              ? titleRaw
              : undefined;
          const id: string = r.item?.citekey ?? r.item?.citationKey ?? '';
          if (!id) return null;
          const entry: PartialCSLEntry = { id, title };
          const creators = r.item?.creators;
          if (Array.isArray(creators) && creators.length > 0) {
            entry.author = creators.map((c: any) => ({
              family: c.lastName ?? c.name ?? '',
              given: c.firstName ?? '',
            }));
          }
          return { item: entry, refIndex, score: 0.5 };
        })
        .filter(Boolean) as Fuse.FuseResult<PartialCSLEntry>[];
    } catch (e) {
      LOG('@@ ZotLit fallback failed:', e);
      return [];
    }
  }

  renderSuggestion(
    suggestion: Fuse.FuseResult<PartialCSLEntry>,
    el: HTMLElement
  ): void {
    if (isLoadingSuggestion(suggestion)) {
      el.setText(
        'ScholarWeft: still loading your library — citekey search will be complete shortly.'
      );
      return;
    }
    const frag = createFragment();
    const item = suggestion.item;
    const excerpt = this.excerptFor(item as { id?: string; abstract?: string });

    // Highlight the matched terms in EVERY field, on every render path. Doing
    // it from TERMS rather than Fuse's `matches` matters because searchTier
    // results carry no `matches` at all — so `@@` titles were never
    // emphasised, and `@` emphasised only what Fuse happened to report.
    const terms = this.termsFor(item, suggestion);

    const citekey = frag.createSpan({ text: '@' });
    this.appendHighlighted(citekey, item.id ?? '', terms);

    if (item.title) {
      const title = frag.createSpan('sw-suggest-title');
      this.appendHighlighted(title, item.title, terms);
    }

    // Author/editor names, so a search by name shows why it matched.
    const authorText = this.authorTextFor(item);
    if (authorText) {
      const authors = frag.createSpan({ cls: 'sw-suggest-authors' });
      this.appendHighlighted(authors, authorText, terms);
    }


    const meta = getEntryMeta(item);
    if (meta) frag.createSpan({ text: meta, cls: 'sw-suggest-meta' });

    this.appendExcerpt(frag, excerpt);

    el.setText(frag);

  }

  /**
   * The terms to emphasise for this suggestion.
   *
   * The multi-field tiers use the interpretation that MATCHED (recorded per entry), so the
   * emphasis matches what actually found the record. Single-`@` has no recorded
   * terms, so it falls back to Fuse's own match indices.
   */
  private termsFor(
    item: PartialCSLEntry,
    suggestion: Fuse.FuseResult<PartialCSLEntry>
  ): string[] {
    const recorded = item.id ? this._matchedTermsByKey.get(item.id) : undefined;
    if (recorded?.length) return recorded;
    // Fall back to the literal matched substrings Fuse reported. Guarded: a
    // `matches` entry without `value` or valid `indices` would throw inside the
    // renderer, which has no try/catch — aborting the rest of the item rather
    // than merely losing its emphasis.
    const out: string[] = [];
    for (const m of suggestion.matches ?? []) {
      if (typeof m?.value !== 'string' || !Array.isArray(m.indices)) continue;
      for (const range of m.indices) {
        if (!Array.isArray(range)) continue;
        const [a, b] = range;
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const term = m.value.substring(a, b + 1);
        if (term) out.push(term);
      }
    }
    return out;
  }

  /** Author/editor names for display, matching `authorTextOf` in bibManager. */
  private authorTextFor(item: PartialCSLEntry): string {
    const e = item as { author?: any[]; editor?: any[] };
    const parts: string[] = [];
    for (const list of [e.author, e.editor]) {
      for (const n of list ?? []) {
        const name = n?.literal ?? [n?.given, n?.family].filter(Boolean).join(' ');
        if (name) parts.push(name);
      }
    }
    return parts.join('; ');
  }

  /** Append `text`, emphasising every span matching one of `terms`. */
  private appendHighlighted(
    el: HTMLElement,
    text: string,
    terms: readonly string[]
  ): void {
    const spans = findTermSpans(text, terms);
    if (spans.length === 0) {
      el.appendText(text);
      return;
    }
    let at = 0;
    for (const s of spans) {
      if (s.start > at) el.appendText(text.slice(at, s.start));
      // Use `<mark>`, the same element the working excerpt emphasis uses, rather
      // than `<strong>`. Obsidian's own stylesheet gives `mark` visible
      // highlighting wherever it appears, so the emphasis cannot depend on our
      // CSS being applied to the right ancestor — which is what silently failed
      // for `<strong>`.
      // `<strong>` rather than `<mark>`: only bold is wanted, and `mark` brings
      // a background and colour that would then have to be overridden. The
      // class is on the element itself, so nothing depends on the popup's
      // ancestor structure (an ancestor selector is what silently failed
      // before).
      const strong = createEl('strong', {
        cls: 'sw-suggest-match',
        text: text.slice(s.start, s.start + s.length),
      });
      el.append(strong);
      at = s.start + s.length;
    }
    if (at < text.length) el.appendText(text.slice(at));
  }

  /** Append an excerpt line to a suggestion, emphasising the matched term. */
  private appendExcerpt(
    frag: DocumentFragment,
    excerpt: ReturnType<typeof excerptForResult>
  ): void {
    if (!excerpt) return;
    const line = frag.createDiv({ cls: 'sw-suggest-excerpt' });
    // Emphasise EVERY matched term in the line, not just the first: a line can
    // hold several matched words, and bolding one made the rest look ordinary.
    let at = 0;
    for (const m of excerpt.matches) {
      if (m.length <= 0 || m.start < at || m.start + m.length > excerpt.text.length) {
        continue;
      }
      if (m.start > at) line.appendText(excerpt.text.slice(at, m.start));
      line.append(
        createEl('strong', {
          cls: 'sw-suggest-match',
          text: excerpt.text.slice(m.start, m.start + m.length),
        })
      );
      at = m.start + m.length;
    }
    if (at < excerpt.text.length) line.appendText(excerpt.text.slice(at));
  }

  /**
   * Per-entry terms of the interpretation that matched, keyed by citekey.
   *
   * Drives BOTH the `@@` excerpt and the highlighting of every field, so it is
   * recorded for `@@` too — not only for the tier that shows an excerpt.
   */
  private _matchedTermsByKey = new Map<string, string[]>();

  /** An excerpt for an abstract match, or null when the terms are not there. */
  /**
   * An excerpt for an abstract match, or null when the terms are not there.
   *
   * Public so the render decision is testable: the excerpt was previously
   * rendered only after the `matches` branch, but `searchTier` results carry no
   * `matches`, so they returned early and never showed one. A test asserting
   * this path exists is what stops that regressing.
   */
  excerptFor(item: { id?: string; abstract?: string | null }) {
    const terms = item.id ? this._matchedTermsByKey.get(item.id) : undefined;
    return excerptForResult(item, terms ?? []);
  }

  private lastSelect: EditorPosition = null;

  selectSuggestion(
    suggestion: Fuse.FuseResult<PartialCSLEntry>,
    event: KeyboardEvent | MouseEvent
  ): void {
    if (isLoadingSuggestion(suggestion)) return;
    const { context } = this;
    if (!context) return;

    const id = suggestion.item.id;
    // Remember the pick, and (when it came from a query) the query itself, so
    // the 0-character popup can re-run it in this note.
    const doubleAt = context.query.startsWith(DOUBLE_AT_PREFIX);
    this.plugin.bibManager.rememberSelection(id, {
      query: context.query.slice(doubleAt ? 1 : 0).trim(),
      doubleAt,
      notePath: this.plugin.app.workspace.getActiveFile()?.path ?? '',
    });
    const lineText = context.editor.getLine(context.start.line);
    const charBefore = lineText[context.start.ch - 1];
    const afterCursor = lineText.substring(context.end.ch);
    const beforeStart = lineText.substring(0, context.start.ch);

    // `beforeStart` ends with the '@' (or '@@'), so the character before THAT is
    // what shows whether a citation bracket is already open — `[@del` needs
    // only `]`, where `@del` needs a full `[@key]` wrapper.
    const afterOpenBracket = afterOpenBracketIn(beforeStart);

    // Bracket-aware insertion, in one tested place (see cite-insert.ts): the
    // closing delimiter must match the opening one, or a `[[@key]` wikilink is
    // silently broken. A bare `@` inserts a linked citation when the "Process
    // linked citations" setting is on; ⌘/Ctrl+Enter forces the Pandoc form.
    const { text: replaceStr } = computeInsertion(
      id,
      { beforeStart, afterCursor, charBefore, afterOpenBracket },
      {
        linked: this.plugin.settings.renderLinkCitations !== false,
        forcePandoc: !!(event.metaKey || event.ctrlKey),
      }
    );

    context.editor.replaceRange(replaceStr, context.start, context.end);
    this.lastSelect = { ch: context.start.ch + replaceStr.length, line: context.start.line };
    this.close();
  }

  private isRefreshing = false;
  private lastRefreshAt = 0;

  /** Refresh the Zotero bib + fuse, rate-limited to once per 30 s so typing
   *  "@" repeatedly doesn't trigger a JSON-RPC round trip + full re-render
   *  (refreshGlobalZBib clears fileCache and calls processReferences) on
   *  every popup. The index is also refreshed at startup by the plugin, so
   *  this only needs to catch mid-session Zotero edits. */
  async refreshZBib() {
    if (this.isRefreshing) return;
    const now = Date.now();
    if (now - this.lastRefreshAt < 30_000) return;
    this.lastRefreshAt = now;
    this.isRefreshing = true;
    try {
      await this.plugin.bibManager.refreshGlobalZBib();
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Live Zotero search used when the local index can't answer (still building,
   * or the query found nothing). BBT's `item.search` is preferred because it
   * searches real fields (`citationKey`, `title`, `author`) and returns one
   * entry per item — the native `?q=` search returns child notes/attachments
   * and can bury the citeable item. The native API is queried as a secondary
   * source. Results are merged and de-duplicated, citekey-prefix matches first.
   */
  private async liveSearch(
    query: string,
    kind: 'citekey' | 'text'
  ): Promise<PartialCSLEntry[]> {
    const { settings } = this.plugin;
    if (!settings.pullFromZotero || query.length < 2) return [];
    const port = settings.zoteroPort ?? DEFAULT_ZOTERO_PORT;
    const groupIds = settings.zoteroGroups?.map((g) => g.id) ?? [];
    const out: PartialCSLEntry[] = [];
    const seen = new Set<string>();
    const add = (items: PartialCSLEntry[]) => {
      for (const e of items) {
        if (e?.id && !seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    };

    // 1) BBT search on the field that matters for this mode.
    if (kind === 'citekey') {
      add(
        await searchZoteroBBT(
          port,
          [['citationKey', 'contains', query]],
          groupIds,
          this.limit
        )
      );
    } else {
      add(await searchZoteroBBT(port, [['title', 'contains', query]], groupIds, this.limit));
      add(await searchZoteroBBT(port, [['author', 'contains', query]], groupIds, this.limit));
    }

    // 2) Native `?q=` search as a secondary source (also covers installs where
    //    BBT's RPC is unavailable).
    try {
      add(await searchZoteroNative(port, query, groupIds, this.limit));
    } catch (e) {
      LOG('native live search threw:', e);
    }

    if (kind === 'citekey') {
      const q = query.toLowerCase();
      out.sort((a, b) => {
        const ap = a.id.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.id.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      });
    }

    return out.slice(0, this.limit);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo {
    const { enableCiteKeyCompletion, pullFromZotero, citeSearchMinChars } =
      this.plugin.settings;

    if (enableCiteKeyCompletion === false) return null;

    const { lastSelect } = this;
    if (lastSelect && cursor.ch === lastSelect.ch && cursor.line === lastSelect.line) {
      return null; // suppress re-trigger right after a selection
    }

    // Name what Enter will insert here, so the footer hint matches the insertion
    // (`]]` inside a wikilink, `]` inside `[@…`). `end` is the caret: the hint
    // needs the text AFTER the caret to know whether a closer already exists.
    this.setInsertionHint({
      editor,
      start: cursor,
      end: cursor,
    } as EditorSuggestContext);

    const line = (editor.getLine(cursor.line) || '').substring(0, cursor.ch);

    // ONE detector for `@` and `@@`, honouring the word-start boundary and the
    // user's minimum-characters setting. Below the minimum it returns null, so
    // `[[@` falls back to Obsidian's native link search for users who raised it.
    //
    //   [[@key / [@key / [-@key / [see @key — unambiguous citations
    //   @key / @@text                          — full-library search
    const trigger = detectCitationTrigger(line, {
      minChars: citeSearchMinChars ?? DEFAULT_MIN_CHARS,
    });
    if (!trigger) return null;

    // A bare `@`/`@@` outside any bracket yields to ZotLit's own suggester when
    // the user has explicitly turned prioritization off. Bracketed forms are
    // always claimed (Obsidian's native link search can't see unimported refs).
    if (!trigger.isDoubleAt) {
      const beforeAt = line.substring(0, trigger.atPos);
      const inBracketCite = beforeAt.lastIndexOf('[') > beforeAt.lastIndexOf(']');
      if (
        !inBracketCite &&
        this.plugin.settings.prioritizeCiteKeyCompletion === false &&
        isZotLitSuggestActive(this.plugin.app)
      ) {
        return null;
      }
    }

    LOG(
      'onTrigger: matched',
      trigger.isDoubleAt ? '@@' : '@',
      'query=',
      JSON.stringify(triggerQueryText(trigger))
    );
    this.lastSelect = null;
    if (!this.context && pullFromZotero) this.refreshZBib();

    return {
      start: { line: cursor.line, ch: trigger.atPos },
      end: cursor,
      query: trigger.query,
    };
  }
}
