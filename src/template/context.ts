// Note context builder for our own (non-ZotLit) import path.
//
// Assembles the `item.*` data our note templates render against from a CACHED
// CSL entry — the shape `zoteroItemToCSL()` (native API) or Better BibTeX's
// library export produce, plus the internal `_`-prefixed fields we retain
// (`_extra`, `_tags`, `_dateAdded`, `_zoteroKey`, …). It is deliberately
// I/O-free: child data (attachments, annotations, notes) and the vault-relative
// note path are passed in by the caller, because fetching them needs the Zotero
// HTTP API and resolving them needs the Obsidian vault.
//
// Field names follow ZotLit's published `zt` contract v2
// (`packages/db/src/contract/generated/note.schema.json`, AGPL-3.0 — see
// NOTICE.md). These templates and ours were both written against it, so keeping
// the names is what lets one template set serve both paths. The ONE difference
// is the root name: our templates read `item`, ZotLit's read `zt` (see
// `engine.ts`).
//
// What the cache cannot supply faithfully is noted where it matters: `creators`
// loses Zotero's cross-role ordering (the cache groups by CSL role), tag types
// are not retained (so they report `"unknown"`), and `collections` /
// `relatedItems` need the Zotero database, not the CSL export, so they are empty
// on this path for now.

import type { CSLName, PartialCSLEntry } from '../bib/types';
import { extraKeyToContextProperty, parseExtra } from '../bib/extra';
import type { ItemExtra } from '../bib/extra';
import { ZOTERO_TYPE_TO_CSL } from '../bib/zotero-csl';
import { htmlToMarkdownText } from './markdown';

/** A cached CSL entry: the CSL fields plus the internal fields we retain. */
export interface CachedEntry extends PartialCSLEntry {
  /** Zotero's free-text `extra` field, kept verbatim. */
  _extra?: string;
  /** Tag names (types are not retained). */
  _tags?: string[];
  /** ISO timestamp of when Zotero added the item. */
  _dateAdded?: string;
  /** Zotero item key (`EKUBHHNW`). */
  _zoteroKey?: string;
  /** CSL fields we read by name; not all are in `PartialCSLEntry`. */
  [key: string]: unknown;
}

/** ZotLit's `{ $helper, signature, value }` helper, at runtime a callable. */
export type LinkHelper = (alias?: string, subpath?: string) => string | null;

/** A template tag. `type` is `"unknown"` because our cache drops Zotero's type. */
export interface NoteContextTag {
  name: string;
  type: 'manual' | 'auto' | 'unknown';
}

/** One creator, in the template vocabulary. */
export interface NoteContextCreator {
  family: string;
  given: string;
  literal: string | null;
  /** Zotero creator type, e.g. `"author"`, `"editor"`. */
  role: string;
  /** `literal` for institutional creators, else `"given family"`. */
  fullName: string;
}

/** A Zotero collection. Empty on the CSL-only path. */
export interface NoteContextCollection {
  key: string;
  name: string;
  path: string[];
}

/** A related item (Zotero's "Related" panel). Empty on the CSL-only path. */
export interface NoteContextRelatedItem {
  key: string;
  citationKey: string | null;
  title: string | null;
}

/**
 * Publication date, mirroring the contract's four variants. `toString` is
 * non-enumerable so a spread or `JSON.stringify` sees the data properties
 * alone, while `String(date)` still yields something renderable — the shape
 * ZotLit's frontmatter expressions assume.
 */
export type NoteContextDate =
  | { kind: 'date'; value: string; year: number; month: number; day: number; raw: string }
  | { kind: 'yearMonth'; value: string; year: number; month: number; day: null; raw: string }
  | { kind: 'year'; value: null; year: number; month: null; day: null; raw: string }
  | { kind: 'text'; value: null; text: string; year: number | null; month: null; day: null; raw: string };

/** An attachment, already mapped to the template vocabulary. */
export interface NoteContextAttachment {
  key: string;
  indexedKey: string;
  filename: string | null;
  contentType: string | null;
  linkMode: string;
  backlink: string;
  filePath: string | null;
  fileLink: LinkHelper;
}

/** One annotation, already mapped to the template vocabulary. */
export interface NoteContextAnnotation {
  imgLink: LinkHelper | null;
  comment: string | null;
  fileLink: LinkHelper;
  backlink: string;
  parentItem: NoteContext | null;
  parentAttachment: NoteContextAttachment;
  key: string;
  indexedKey: string;
  libraryID: number;
  type: string;
  text: string | null;
  commentHtml: string | null;
  colorHex: string | null;
  colorName: string | null;
  pageLabel: string | null;
  page: number | null;
  authorName: string | null;
  isExternal: boolean;
  dateAdded: string;
  dateModified: string;
  tags: NoteContextTag[];
}

/**
 * A child note. ZotLit's contract exposes these as links only; OUR path also
 * carries the note's Markdown `text`, which is what makes a separate "insert
 * Zotero notes" pass unnecessary.
 */
export interface NoteContextNote {
  key: string;
  indexedKey: string;
  title: string | null;
  noteLink: LinkHelper | null;
  /** The note's Markdown body. `null` when only the link was fetched. */
  text: string | null;
  /**
   * The note's raw HTML, kept so a render can re-run {@link noteHtmlToMarkdown}
   * at a requested heading level. Not part of ZotLit's contract.
   */
  html?: string | null;
}

/** Optional child data and vault context the entry alone cannot supply. */
export interface NoteContextChildren {
  attachments?: NoteContextAttachment[];
  annotations?: NoteContextAnnotation[];
  notes?: NoteContextNote[];
  /** Vault-relative path of the literature note, once it is known. */
  notePath?: string | null;
}

/**
 * The `item` root our note templates receive. Core fields mirror the contract;
 * item-type-specific and `extra`-derived fields are extras on the index
 * signature (`originalDate`, `conferenceName`, …).
 */
export interface NoteContext {
  // Identity
  key: string;
  groupID: number | null;
  libraryID: number;
  indexedKey: string;
  itemType: string;
  dateAdded: string;
  dateModified: string;
  backlink: string;
  weblink: string | null;
  notePath: string | null;
  noteLink: LinkHelper;

  // Bibliographic
  title: string | null;
  shortTitle: string | null;
  abstract: string | null;
  containerTitle: string | null;
  citationKey: string | null;
  citekey: string | null;
  date: NoteContextDate | null;
  DOI: string | null;
  url: string | null;
  ISBN: string | null;
  ISSN: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  place: string | null;
  edition: string | null;
  language: string | null;
  /** Item-type-specific fields the ZotLit templates read by these names. */
  series: string | null;
  seriesNumber: string | null;
  numberOfVolumes: string | null;
  extra: ItemExtra | null;

  // People, tags, membership
  creators: NoteContextCreator[];
  primaryCreatorType: string | null;
  authors: NoteContextCreator[];
  authorsShort: string;
  tags: NoteContextTag[];
  collections: NoteContextCollection[];

  // Children
  annotations: NoteContextAnnotation[];
  attachments: NoteContextAttachment[];
  notes: NoteContextNote[];
  relatedItems: NoteContextRelatedItem[];

  // Item-type-specific and extra-derived fields.
  [key: string]: unknown;
}

// ─── CSL → Zotero item type ─────────────────────────────────────────────────

/**
 * Preferred Zotero item type for a CSL type. Several Zotero types share one CSL
 * type (e.g. `podcast`/`radioBroadcast`/`tvBroadcast` → `broadcast`), so the
 * reverse mapping is a choice; each value round-trips back through
 * {@link ZOTERO_TYPE_TO_CSL} to the same CSL type.
 */
const CSL_TO_ZOTERO_ITEM_TYPE: Record<string, string> = {
  'graphic': 'artwork',
  'song': 'audioRecording',
  'bill': 'bill',
  'post-weblog': 'blogPost',
  'book': 'book',
  'chapter': 'bookSection',
  'legal_case': 'case',
  'software': 'computerProgram',
  'paper-conference': 'conferencePaper',
  'dataset': 'dataset',
  'entry-dictionary': 'dictionaryEntry',
  'document': 'document',
  'personal_communication': 'letter',
  'entry-encyclopedia': 'encyclopediaArticle',
  'motion_picture': 'videoRecording',
  'post': 'forumPost',
  'hearing': 'hearing',
  'interview': 'interview',
  'article-journal': 'journalArticle',
  'article-magazine': 'magazineArticle',
  'manuscript': 'manuscript',
  'map': 'map',
  'article-newspaper': 'newspaperArticle',
  'patent': 'patent',
  'broadcast': 'tvBroadcast',
  'article': 'preprint',
  'speech': 'presentation',
  'report': 'report',
  'standard': 'standard',
  'legislation': 'statute',
  'thesis': 'thesis',
  'webpage': 'webpage',
};

/** Map a cached CSL `type` back to its Zotero `itemType` (best effort). */
export function cslTypeToZoteroItemType(cslType: unknown): string {
  const t = typeof cslType === 'string' && cslType ? cslType : 'document';
  return CSL_TO_ZOTERO_ITEM_TYPE[t] ?? t;
}

// ─── Creators ───────────────────────────────────────────────────────────────

/**
 * CSL role (the key a creator list is stored under) → Zotero `creatorType`.
 * The cache groups creators by CSL role, so this is how we recover a Zotero
 * role name. Where several Zotero types share a CSL role (e.g. `interviewee`
 * and `author` both collapse to `author`), the canonical one wins.
 */
const CSL_ROLE_TO_ZOTERO: Record<string, string> = {
  author: 'author',
  editor: 'editor',
  translator: 'translator',
  contributor: 'contributor',
  'container-author': 'bookAuthor',
  'collection-editor': 'seriesEditor',
  director: 'director',
  interviewer: 'interviewer',
  composer: 'composer',
  producer: 'producer',
  'script-writer': 'scriptwriter',
  'reviewed-author': 'reviewedAuthor',
  performer: 'performer',
  lyricist: 'wordsBy',
  recipient: 'recipient',
  witness: 'witness',
  illustrator: 'illustrator',
  'editorial-director': 'editorialDirector',
};

/**
 * Roles in the order we emit `creators`. The cache groups by role, so Zotero's
 * own interleaved order is not recoverable; this keeps the common
 * author-then-editor shape stable.
 */
const CREATOR_ROLE_ORDER = [
  'author',
  'editor',
  'translator',
  'contributor',
  'director',
  'container-author',
  'collection-editor',
  'interviewer',
  'composer',
  'producer',
  'script-writer',
  'reviewed-author',
  'performer',
  'lyricist',
  'illustrator',
  'editorial-director',
  'recipient',
  'witness',
];

/**
 * Zotero's primary creator type per `itemType`. Only the well-known exceptions
 * are listed; everything else is `author`. Cosmetic for our templates, but the
 * contract wants a type-derived value rather than a data-derived one.
 */
const PRIMARY_CREATOR_TYPE: Record<string, string> = {
  artwork: 'artist',
  audioRecording: 'performer',
  computerProgram: 'programmer',
  film: 'director',
  interview: 'interviewer',
  map: 'cartographer',
  patent: 'inventor',
  podcast: 'author',
  presentation: 'presenter',
  radioBroadcast: 'director',
  tvBroadcast: 'director',
  videoRecording: 'director',
};

function toCreator(name: CSLName, role: string): NoteContextCreator {
  const family = typeof name.family === 'string' ? name.family : '';
  const given = typeof name.given === 'string' ? name.given : '';
  const literal = typeof name.literal === 'string' && name.literal ? name.literal : null;
  const fullName = literal ?? [given, family].filter(Boolean).join(' ');
  return { family, given, literal, role, fullName };
}

/** Every creator on the entry, grouped by CSL role and flattened. */
export function entryCreators(entry: CachedEntry): NoteContextCreator[] {
  const out: NoteContextCreator[] = [];
  const seen = new Set<string>();
  const emit = (roleKey: string) => {
    const list = entry[roleKey];
    if (!Array.isArray(list)) return;
    const role = CSL_ROLE_TO_ZOTERO[roleKey] ?? roleKey;
    for (const name of list as CSLName[]) {
      if (!name || typeof name !== 'object') continue;
      out.push(toCreator(name, role));
    }
    seen.add(roleKey);
  };
  for (const roleKey of CREATOR_ROLE_ORDER) emit(roleKey);
  // Any other CSL role the entry carries (e.g. a future field) after the known
  // ones, so nothing is silently dropped.
  for (const key of Object.keys(entry)) {
    if (seen.has(key)) continue;
    if (Array.isArray(entry[key]) && key !== 'author') emit(key);
  }
  return out;
}

/** The role Zotero treats as primary for this item type. */
export function primaryCreatorTypeFor(itemType: string): string | null {
  return PRIMARY_CREATOR_TYPE[itemType] ?? 'author';
}

/** `"Smith"`, `"Smith and Jones"`, `"Smith et al."` */
export function formatAuthorsShort(
  creators: NoteContextCreator[],
  primaryRole: string | null
): string {
  const authors = creators.filter((c) => !primaryRole || c.role === primaryRole);
  const list = authors.length ? authors : creators;
  const surname = (c: NoteContextCreator) =>
    c.literal || c.family || c.fullName || '';
  if (list.length === 0) return '';
  if (list.length === 1) return surname(list[0]);
  if (list.length === 2) return `${surname(list[0])} and ${surname(list[1])}`;
  return `${surname(list[0])} et al.`;
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** A finite integer, or null. */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * A standalone 4-digit year in 1000–2999, matching the contract's text-variant
 * heuristic. Used to recover a year from an unparseable date string.
 */
function standaloneYear(text: string): number | null {
  const m = /(?:^|[^\d])([12]\d{3})(?:[^\d]|$)/.exec(text);
  return m ? Number(m[1]) : null;
}

function withToString<T extends object>(date: T, text: string): T {
  Object.defineProperty(date, 'toString', {
    value: () => text,
    enumerable: false,
    configurable: true,
  });
  return date;
}

/**
 * Parse a CSL `issued` value (or an `{raw}`/`{literal}` shape) into the
 * contract's date variants. Returns `null` when there is nothing to parse.
 */
export function toContextDate(issued: unknown): NoteContextDate | null {
  if (issued == null) return null;

  if (typeof issued === 'string') {
    const text = issued.trim();
    if (!text) return null;
    const year = standaloneYear(text);
    return year == null
      ? withToString<NoteContextDate>(
          { kind: 'text', value: null, text, year: null, month: null, day: null, raw: text },
          text
        )
      : withToString<NoteContextDate>(
          { kind: 'year', value: null, year, month: null, day: null, raw: text },
          String(year)
        );
  }

  const obj = issued as Record<string, unknown>;
  const raw =
    typeof obj.raw === 'string'
      ? obj.raw
      : typeof obj.literal === 'string'
        ? obj.literal
        : '';
  const parts = Array.isArray(obj['date-parts'])
    ? (obj['date-parts'] as unknown[])[0]
    : undefined;
  const arr = Array.isArray(parts) ? parts : [];
  const year = num(arr[0]);
  const month = num(arr[1]);
  const day = num(arr[2]);

  if (year == null) {
    const text = raw.trim();
    if (!text) return null;
    const y = standaloneYear(text);
    return y == null
      ? withToString<NoteContextDate>(
          { kind: 'text', value: null, text, year: null, month: null, day: null, raw: text },
          text
        )
      : withToString<NoteContextDate>(
          { kind: 'year', value: null, year: y, month: null, day: null, raw: text },
          String(y)
        );
  }

  const rawOut = raw || String(year);
  if (month != null && day != null) {
    const value = `${year}-${pad2(month)}-${pad2(day)}`;
    return withToString<NoteContextDate>(
      { kind: 'date', value, year, month, day, raw: rawOut },
      value
    );
  }
  if (month != null) {
    const value = `${year}-${pad2(month)}`;
    return withToString<NoteContextDate>(
      { kind: 'yearMonth', value, year, month, day: null, raw: rawOut },
      value
    );
  }
  return withToString<NoteContextDate>(
    { kind: 'year', value: null, year, month: null, day: null, raw: rawOut },
    String(year)
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────

/** A non-empty string, or null. Coerces numbers (volume, edition, …). */
function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v ? v : null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/**
 * A field Zotero can store HTML in (title, short title, abstract), converted to
 * Markdown so italics etc. survive wherever a template puts it. Deliberately NOT
 * escaped: a template may place the value in frontmatter (where it can hold
 * intentional `[[wikilinks]]`) or in the body (where it should be wrapped with
 * the `escape_md` helper). Escaping is a destination decision, not a field one,
 * so the context never assumes where the value is used.
 */
function mdField(v: unknown): string | null {
  const s = str(v);
  if (s == null) return null;
  return htmlToMarkdownText(s) || null;
}

/** Personal library in Zotero is library/group id 1. */
function isPersonal(groupID: unknown): boolean {
  return groupID == null || groupID === 1;
}

/** `KEY` for the personal library, `KEYgGROUPID` for a group library. */
export function indexedKeyFor(key: string, groupID: number | null): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

/** Zotero's desktop deep link to the item. */
export function backlinkFor(key: string, groupID: number | null): string {
  return groupID == null
    ? `zotero://select/library/items/${key}`
    : `zotero://select/groups/${groupID}/items/${key}`;
}

/**
 * Zotero's web-library URL. `null` for a personal library: the URL needs the
 * synchronised user ID, which the CSL cache does not carry.
 */
export function weblinkFor(key: string, groupID: number | null): string | null {
  if (groupID == null || !key) return null;
  return `https://www.zotero.org/groups/${groupID}/items/${key}`;
}

/** An Obsidian link to the note, or a callable returning null when unknown. */
export function noteLinkFor(notePath: string | null | undefined): LinkHelper {
  if (!notePath) return () => null;
  const base = notePath.replace(/\.md$/, '');
  const defaultAlias = base.split('/').pop() ?? base;
  return (alias, subpath) => {
    const target = subpath ? `${base}#${subpath}` : base;
    return `[[${target}|${alias ?? defaultAlias}]]`;
  };
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Assemble the `item.*` context from a cached entry. `children` is optional:
 * the entry alone yields a complete context with empty child arrays, which is
 * what a render-only unit test needs.
 */
export function buildNoteContext(
  entry: PartialCSLEntry | CachedEntry | null | undefined,
  children: NoteContextChildren = {}
): NoteContext {
  const e = (entry ?? {}) as CachedEntry;

  const rawGroup = e.groupID;
  const groupID = isPersonal(rawGroup) ? null : (rawGroup as number);
  const libraryID = groupID ?? 1;
  const key = str(e._zoteroKey) ?? str(e.key) ?? '';
  const itemType = cslTypeToZoteroItemType(e.type);

  const creators = entryCreators(e);
  const primaryCreatorType = primaryCreatorTypeFor(itemType);
  const authors = creators.filter((c) => c.role === primaryCreatorType);

  const notePath = children.notePath ?? null;

  const ctx: NoteContext = {
    key,
    groupID,
    libraryID,
    indexedKey: indexedKeyFor(key, groupID),
    itemType,
    dateAdded: str(e._dateAdded) ?? str(e.dateAdded) ?? '',
    dateModified: str(e._dateModified) ?? str(e.dateModified) ?? '',
    backlink: backlinkFor(key, groupID),
    weblink: weblinkFor(key, groupID),
    notePath,
    noteLink: noteLinkFor(notePath),

    title: mdField(e.title),
    shortTitle: mdField(e['title-short']),
    abstract: mdField(e.abstract),
    containerTitle: str(e['container-title']),
    citationKey: str(e.id),
    citekey: str(e.id),
    date: toContextDate(e.issued),
    DOI: str(e.DOI),
    url: str(e.URL),
    ISBN: str(e.ISBN),
    ISSN: str(e.ISSN),
    volume: str(e.volume),
    issue: str(e.issue),
    pages: str(e.page),
    publisher: str(e.publisher),
    place: str(e['publisher-place']),
    edition: str(e.edition),
    language: str(e.language),
    series: str(e['collection-title']),
    seriesNumber: str(e['collection-number']),
    numberOfVolumes: str(e['number-of-volumes']),
    extra: parseExtra(e._extra),

    creators,
    primaryCreatorType,
    authors: authors.length ? authors : creators,
    authorsShort: formatAuthorsShort(creators, primaryCreatorType),
    tags: (Array.isArray(e._tags) ? (e._tags as unknown[]) : [])
      .filter((t): t is string => typeof t === 'string' && !!t)
      .map((name) => ({ name, type: 'unknown' as const })),
    collections: [],

    annotations: children.annotations ?? [],
    attachments: children.attachments ?? [],
    notes: children.notes ?? [],
    relatedItems: [],
  };

  // Recognised `extra` keys become context properties (`Original Date: 1950` →
  // `originalDate`), but only where the entry has no value: a real Zotero field
  // is authoritative, and `extra` is the fallback the cheater syntax exists for.
  const extra = ctx.extra;
  if (extra) {
    for (const [extraKey, value] of Object.entries(extra.fields)) {
      const prop = extraKeyToContextProperty(extraKey);
      if (!prop) continue;
      const current = ctx[prop];
      if (current == null || current === '') ctx[prop] = value;
    }
  }

  return ctx;
}
