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
import { excerptForResult } from 'src/template/search-excerpt';
import {
  afterOpenBracketIn,
  computeInsertion,
  insertionHint,
} from 'src/template/cite-insert';
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

/**
 * Citekey-first single-@ search (PRL-style). Tiered so the suggestion list is
 * predictable instead of Fuse's often-random-looking fuzzy spread:
 *   1. citekeys that START with the query (prefix) — "pickus" → pickus… first
 *   2. citekeys CONTAINING the query (substring)
 *   3. everything else Fuse finds on title/author (fuzzy)
 * Each tier is itself sorted by Fuse score within the tier. Tiers 1–2 pull
 * from the index's docs directly (cheap, exact); tier 3 delegates to Fuse.
 * Returns up to `limit` results, prefix/substring tiering never dropping a
 * prefix match in favour of an unrelated fuzzy hit.
 */
function searchCitekeyFirst(
  fuse: Fuse<PartialCSLEntry> | undefined,
  query: string,
  limit: number
): Fuse.FuseResult<PartialCSLEntry>[] {
  if (!fuse) return [];
  const q = normalizeDiacritics(query).toLowerCase();
  if (!q) return [];

  const docs = ((fuse as any)?._docs ?? []) as PartialCSLEntry[];

  const asResult = (item: PartialCSLEntry): Fuse.FuseResult<PartialCSLEntry> => ({
    item,
    refIndex: docs.indexOf(item),
    score: 0,
  });

  // Tier 1: prefix on the citekey.
  const prefixes = docs
    .filter((d) => {
      const id = d.id ?? '';
      return id.length >= q.length && normalizeDiacritics(id).toLowerCase().startsWith(q);
    })
    .map(asResult);

  if (prefixes.length) return prefixes.slice(0, limit);

  // Tier 2: substring on the citekey.
  const substr = docs
    .filter((d) => {
      const id = normalizeDiacritics(d.id ?? '').toLowerCase();
      return id.includes(q);
    })
    .map(asResult);

  if (substr.length) return substr.slice(0, limit);

  // Tier 3: Fuse fuzzy on id/title/author.
  return fuse.search(normalizeDiacritics(query), { limit }) ?? [];
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

// Single-@ trigger: matches @citekey (no spaces, no @@ prefix)
const triggerRE = /(^|[^\p{L}\p{N}@])(@)([\p{L}\p{N}:.#$%&\-+?<>~_/]+)$/u;

// Double-@ trigger: @@ followed by any text (spaces allowed) up to a period.
// A period ends the trigger so normal sentence punctuation closes the popup.
const doubleAtRE = /(^|[^\p{L}\p{N}@])(@@)([^.]*)$/u;

// Triple-@ trigger: @@@ adds abstract to the @@ fields. Checked first so it
// wins over @@ (which would otherwise match the first two @s).
const tripleAtRE = /(^|[^\p{L}\p{N}@])(@@@)([^.]*)$/u;

// Sentinel prepended to the query when @@ mode is active. Encoding the mode
// in the query string means it travels with the EditorSuggestContext and is
// still correct when getSuggestions resolves asynchronously — no class-level
// flag that a later onTrigger call could clobber mid-flight.
const DOUBLE_AT_PREFIX = '\x00';

// Same idea for @@@ (title + creators + abstract).
const TRIPLE_AT_PREFIX = '\x01';

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

    this.setInstructions([
      {
        command: Platform.isMacOS ? '⌘ ↵' : 'ctrl ↵',
        // Updated per search to name the mark actually inserted (see
        // renderCount), so `[[` users are told about `]]`.
        purpose: 'wrap with brackets',
      },
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
      {
        command: Platform.isMacOS ? '⌘ ↵' : 'ctrl ↵',
        purpose: this._insertionHint,
      },
      // `command` renders first, so an empty one keeps the summary as the
      // whole right-hand phrase rather than splitting it across two spans.
      { command: '', purpose: summary },
    ]);
  }

  /** Names the closing mark the current context will insert (`]` or `]]`). */
  private _insertionHint = 'wrap with brackets';

  /** Record the closing mark for the current context, for the footer hint. */
  private setInsertionHint(context: EditorSuggestContext): void {
    const line = context.editor.getLine(context.start.line) ?? '';
    const beforeStart = line.substring(0, context.start.ch);
    this._insertionHint = insertionHint({
      beforeStart,
      afterOpenBracket: afterOpenBracketIn(beforeStart),
    });
  }

  async getSuggestions(
    context: EditorSuggestContext
  ): Promise<Fuse.FuseResult<PartialCSLEntry>[]> {
    const isTripleAtMode = context.query.startsWith(TRIPLE_AT_PREFIX);
    const isDoubleAtMode =
      isTripleAtMode || context.query.startsWith(DOUBLE_AT_PREFIX);
    const searchQuery = context.query
      .slice(isTripleAtMode ? 1 : isDoubleAtMode ? 1 : 0)
      .trim();

    LOG(
      'getSuggestions query=',
      JSON.stringify(searchQuery),
      'mode=',
      isTripleAtMode ? '@@@' : isDoubleAtMode ? '@@' : '@'
    );

    if (!isDoubleAtMode && (!searchQuery || searchQuery.includes(' '))) {
      return [];
    }

    const { plugin } = this;
    const { bibManager } = plugin;
    // Do NOT bail out while the local index is still building. Previously this
    // returned [] for the first several minutes after a fresh install, so
    // autocomplete looked broken. Fall through to the live Zotero search below
    // and, only if that finds nothing either, show a "still loading" line.
    const indexReady = bibManager.fuseReady;

    // ── @@ / @@@ mode: OUR search, ZotLit optional ─────────────────────────
    // Always uses the global index — per-file bibliography overrides are
    // intentionally ignored here since this is a full-library search.
    //
    // ZotLit is NOT consulted. Its database search offered the same kind of
    // item lookup our own index does (it never searched PDF full text), and
    // ours is rankable and works without the plugin. ZotLit remains only as a
    // last-resort accelerator below, when our index is missing and its own is
    // present — never as the source of truth for what @@ means.
    if (isDoubleAtMode) {
      const tier = isTripleAtMode ? 'abstract' : 'title';
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

      LOG(`@${isTripleAtMode ? '@@' : '@'} tier=${tier}, docs=`, (fuse as any)?._docs?.length ?? 0);
      if (!searchQuery) {
        const docs = (fuse as any)?._docs as PartialCSLEntry[] | undefined;
        return docs?.length
          ? docs.slice(0, this.limit).map((item, refIndex) => ({ item, refIndex, score: 0 }))
          : [];
      }

      // searchTier ranks by exact phrase, coverage, whole words and position —
      // and does its own AND filtering. Nothing further to re-rank here.
      const { entries, total } = bibManager.searchTier(
        tier,
        searchQuery,
        this.limit
      );
      // Excerpts are an `@@@` affordance. The terms come from the interpretation
      // that MATCHED each entry, not the raw query: an unbroken query like
      // `islamwomenauthority` appears in no abstract, while the words it split
      // into do — and those are what an excerpt must show.
      this._excerptTermsByKey = new Map(
        isTripleAtMode
          ? entries.map((e) => [e.entry.id, e.terms])
          : []
      );
      // Show an honest count: "20 of 137" when the list is truncated, so a
      // capped result does not read like "only 20 matched".
      this.renderCount(entries.length, total);
      return entries.map(({ entry }, refIndex) => ({
        item: entry,
        refIndex,
        score: 0,
      }));
    }

    this._excerptTermsByKey = new Map();
    this.renderCount(0);

    // ── single-@ mode: citekey-first search + live Zotero fallback ─────────
    // Use per-file Fuse index when the note has a frontmatter bibliography,
    // falling back to global if the per-file one is null (race on startup).
    // The fileCache entry's `.source` can be undefined (e.g. a null-render
    // placeholder), so guard both levels before reading `.fuse`.
    let fuse = bibManager.fuse;
    const fileCacheEntry = bibManager.fileCache.get(context.file);
    if (fileCacheEntry?.source?.fuse) {
      fuse = fileCacheEntry.source.fuse;
    }

    LOG('single-@ fuse docs=', (fuse as any)?._docs?.length ?? 0);
    const fuseResults = searchCitekeyFirst(fuse, searchQuery, this.limit);
    if (fuseResults?.length) return fuseResults;

    // Fuse returned nothing — fall back to a live Zotero query.
    LOG('falling back to live Zotero search');
    const liveItems = await this.liveSearch(searchQuery, 'citekey');
    if (liveItems.length) {
      LOG('live Zotero returned', liveItems.length, 'items');
      return liveItems.map((item, refIndex) => ({ item, refIndex, score: 0.5 }));
    }

    // Nothing from either the index or a live search. If the index is still
    // building, tell the user that rather than leaving the popup blank.
    return indexReady ? [] : loadingSuggestion();
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
    // `@@@` results can match only in the abstract, which is invisible from the
    // title — so the excerpt belongs on EVERY render path. It was previously
    // added only after the `matches` branch below, but searchTier results carry
    // no `matches`, so they returned early and never showed one.
    const excerpt = this.excerptFor(item as { id?: string; abstract?: string });

    if (!suggestion.matches || !suggestion.matches.length) {
      frag.createSpan({ text: `@${item.id}` });
      if (item.title)
        frag.createSpan({ text: item.title, cls: 'sw-suggest-title' });
      const meta = getEntryMeta(item);
      if (meta) frag.createSpan({ text: meta, cls: 'sw-suggest-meta' });
      this.appendExcerpt(frag, excerpt);
      return el.setText(frag);
    }

    const citekey = frag.createSpan({ text: '@' });
    const title = frag.createSpan('sw-suggest-title');

    let prevTitleIndex = 0;
    let prevCiteIndex = 0;

    suggestion.matches.forEach((m) => {
      if (m.key !== 'id' && m.key !== 'title') return;
      m.indices.forEach((indices) => {
        const start = indices[0];
        const stop = indices[1] + 1;

        const target = m.key === 'title' ? title : citekey;
        const prev = m.key === 'title' ? prevTitleIndex : prevCiteIndex;

        target.appendText(m.value.substring(prev, start));
        target.append(createEl('strong', { text: m.value.substring(start, stop) }));

        if (m.key === 'title') prevTitleIndex = stop;
        else prevCiteIndex = stop;
      });
    });

    if (item.title) title.appendText(item.title.substring(prevTitleIndex));
    citekey.appendText(item.id.substring(prevCiteIndex));

    const meta = getEntryMeta(item);
    if (meta) frag.createSpan({ text: meta, cls: 'sw-suggest-meta' });

    // `@@@` results can match only in the abstract, which is invisible from the
    this.appendExcerpt(frag, excerpt);

    el.setText(frag);
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
      line.append(createEl('mark', { text: excerpt.text.slice(m.start, m.start + m.length) }));
      at = m.start + m.length;
    }
    if (at < excerpt.text.length) line.appendText(excerpt.text.slice(at));
  }

  /**
   * Per-entry terms of the interpretation that matched, for `@@@` excerpts.
   * Keyed by citekey so the renderer shows the words that actually matched.
   */
  private _excerptTermsByKey = new Map<string, string[]>();

  /** An excerpt for an `@@@` result, or null outside that tier. */
  /**
   * An excerpt for an `@@@` result, or null outside that tier.
   *
   * Public so the render decision is testable: the excerpt was previously
   * rendered only after the `matches` branch, but `searchTier` results carry no
   * `matches`, so they returned early and never showed one. A test asserting
   * this path exists is what stops that regressing.
   */
  excerptFor(item: { id?: string; abstract?: string | null }) {
    const terms = item.id ? this._excerptTermsByKey.get(item.id) : undefined;
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
    // silently broken.
    const { text: replaceStr } = computeInsertion(
      id,
      { beforeStart, afterCursor, charBefore, afterOpenBracket },
      { wrap: !!(event.metaKey || event.ctrlKey) }
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
    const { enableCiteKeyCompletion, pullFromZotero } = this.plugin.settings;

    if (enableCiteKeyCompletion === false) return null;

    const { lastSelect } = this;
    if (lastSelect && cursor.ch === lastSelect.ch && cursor.line === lastSelect.line) {
      return null; // suppress re-trigger right after a selection
    }

    // Name the mark this context will insert, so the footer hint matches the
    // trigger the user is in (`]]` inside a wikilink, `]` inside `[@…`).
    this.setInsertionHint({ editor, start: cursor } as EditorSuggestContext);

    const line = (editor.getLine(cursor.line) || '').substring(0, cursor.ch);

    // Check @@@ then @@ before single-@ so they win. Mode is encoded in the
    // query string (DOUBLE_AT_PREFIX / TRIPLE_AT_PREFIX) so it travels with the
    // context and stays correct when getSuggestions resolves after a later
    // onTrigger has already fired.
    const tripleMatch = line.match(tripleAtRE);
    if (tripleMatch) {
      LOG('onTrigger: @@@ matched, query=', JSON.stringify(tripleMatch[3]));
      this.lastSelect = null;
      // @@@ searches OUR index (title/creators/abstract); ZotLit is not
      // consulted, so its presence no longer suppresses the refresh.
      if (!this.context && pullFromZotero) this.refreshZBib();
      return {
        start: { line: cursor.line, ch: tripleMatch.index + tripleMatch[1].length },
        end: cursor,
        query: TRIPLE_AT_PREFIX + tripleMatch[3],
      };
    }

    const doubleMatch = line.match(doubleAtRE);
    if (doubleMatch) {
      LOG('onTrigger: @@ matched, query=', JSON.stringify(doubleMatch[3]));
      this.lastSelect = null;
      if (!this.context && pullFromZotero) this.refreshZBib();
      return {
        start: { line: cursor.line, ch: doubleMatch.index + doubleMatch[1].length },
        end: cursor,
        query: DOUBLE_AT_PREFIX + doubleMatch[3],
      };
    }

    const match = line.match(triggerRE);
    if (!match) return null;

    // Position of the '@' character in the line.
    const atPos = match.index + match[1].length;

    // Detect any Pandoc bracket-citation context: an unclosed '[' exists before
    // the '@' on the current line. This covers:
    //   [[@key  — Obsidian-style double-bracket cite (Obsidian's native link
    //              suggester would otherwise win; claim it unconditionally)
    //   [@key   — Standard Pandoc citation
    //   [-@key  — Pandoc suppress-author citation
    //   [see @key, [cf. @key, … — Pandoc citations with a text prefix
    // All of these are unambiguous citations; trigger regardless of the
    // prioritizeCiteKeyCompletion setting (which only gates bare @key outside
    // any bracket context, where yielding to another plugin makes sense).
    const beforeAt = line.substring(0, atPos);
    const inBracketCite = beforeAt.lastIndexOf('[') > beforeAt.lastIndexOf(']');

    if (inBracketCite) {
      LOG('onTrigger: bracket-cite matched, query=', match[3]);
      this.lastSelect = null;
      if (!this.context && pullFromZotero) this.refreshZBib();
      return {
        start: { line: cursor.line, ch: atPos },
        end: cursor,
        query: match[3],
      };
    }

    // Plain "@key" outside any bracket. Only yield to ZotLit's own @ suggester
    // when (a) ZotLit is actually installed and its suggester is active, AND
    // (b) the user has explicitly turned off prioritizeCiteKeyCompletion.
    // If ZotLit isn't present there's no reason to suppress completion here —
    // the user would just get no suggestions at all for bare @key.
    if (
      this.plugin.settings.prioritizeCiteKeyCompletion === false &&
      isZotLitSuggestActive(this.plugin.app)
    ) {
      return null;
    }

    LOG('onTrigger: single-@ matched, query=', match[3]);
    this.lastSelect = null;
    if (!this.context && pullFromZotero) this.refreshZBib();

    return {
      start: { line: cursor.line, ch: atPos },
      end: cursor,
      query: match[3],
    };
  }
}
