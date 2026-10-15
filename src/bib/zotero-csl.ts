import { PartialCSLEntry, CSLDate } from './types';

// Pure Zotero-item-to-CSL-JSON conversion. No I/O, no Obsidian deps.

export const ZOTERO_TYPE_TO_CSL: Record<string, string> = {
  artwork: 'graphic',
  audioRecording: 'song',
  bill: 'bill',
  blogPost: 'post-weblog',
  book: 'book',
  bookSection: 'chapter',
  case: 'legal_case',
  computerProgram: 'software',
  conferencePaper: 'paper-conference',
  dataset: 'dataset',
  dictionaryEntry: 'entry-dictionary',
  document: 'document',
  email: 'personal_communication',
  encyclopediaArticle: 'entry-encyclopedia',
  film: 'motion_picture',
  forumPost: 'post',
  hearing: 'hearing',
  instantMessage: 'personal_communication',
  interview: 'interview',
  journalArticle: 'article-journal',
  letter: 'personal_communication',
  magazineArticle: 'article-magazine',
  manuscript: 'manuscript',
  map: 'map',
  newspaperArticle: 'article-newspaper',
  note: 'document',
  patent: 'patent',
  podcast: 'broadcast',
  preprint: 'article',
  presentation: 'speech',
  radioBroadcast: 'broadcast',
  report: 'report',
  standard: 'standard',
  statute: 'legislation',
  thesis: 'thesis',
  tvBroadcast: 'broadcast',
  videoRecording: 'motion_picture',
  webpage: 'webpage',
};

/**
 * The Zotero API's shapes, as far as this mapper reads them.
 *
 * Zotero's payloads are dynamic — each item type carries its own field names —
 * so most values are optional, and a field Zotero sends as a number (some
 * version counts) is accepted as one. Typing them here is what keeps the whole
 * mapper off `any`: without it every `data.someField` is an unsafe member
 * access, which the directory's review reports by the hundred.
 */
type ZoteroField = string | number | undefined;

export interface ZoteroCreator {
  creatorType?: string;
  /** A single-field (institutional) creator. */
  name?: string;
  lastName?: string;
  firstName?: string;
}

export interface ZoteroTag {
  tag?: string;
}

export interface ZoteroItemData {
  citationKey?: string;
  deleted?: boolean;
  itemType?: string;
  /** The item's own key (the native API repeats it inside `data`). */
  key?: string;
  /** Parent item key (attachments/annotations point at theirs). */
  parentItem?: string;
  /** Attachment MIME type, e.g. `application/pdf`. */
  contentType?: string;
  /** Attachment path as the native API reports it (often absent locally). */
  path?: string;
  /** Zotero's `relations` map (used to find related items). */
  relations?: Record<string, unknown>;
  /** A child note's HTML body. */
  note?: string;
  /** A collection's name (the collections endpoint returns items). */
  name?: string;
  /** A collection's parent key, or false/null at the top level. */
  parentCollection?: string | false | null;

  // Name: every type has its own, and only case/statute/email differ from title.
  title?: ZoteroField;
  caseName?: ZoteroField;
  nameOfAct?: ZoteroField;
  subject?: ZoteroField;

  creators?: ZoteroCreator[];

  date?: ZoteroField;
  dateDecided?: ZoteroField;
  dateEnacted?: ZoteroField;
  issueDate?: ZoteroField;
  filingDate?: ZoteroField;

  publicationTitle?: ZoteroField;
  bookTitle?: ZoteroField;
  encyclopediaTitle?: ZoteroField;
  dictionaryTitle?: ZoteroField;
  blogTitle?: ZoteroField;
  websiteTitle?: ZoteroField;
  forumTitle?: ZoteroField;
  proceedingsTitle?: ZoteroField;
  programTitle?: ZoteroField;
  reporter?: ZoteroField;
  code?: ZoteroField;
  journalAbbreviation?: ZoteroField;

  volume?: ZoteroField;
  reporterVolume?: ZoteroField;
  codeVolume?: ZoteroField;
  issue?: ZoteroField;
  pages?: ZoteroField;
  firstPage?: ZoteroField;
  codePages?: ZoteroField;
  numberOfVolumes?: ZoteroField;
  numberOfPages?: ZoteroField;
  numPages?: ZoteroField;
  edition?: ZoteroField;
  publisher?: ZoteroField;
  institution?: ZoteroField;
  university?: ZoteroField;
  repository?: ZoteroField;
  organization?: ZoteroField;
  place?: ZoteroField;
  repositoryLocation?: ZoteroField;

  DOI?: ZoteroField;
  URL?: ZoteroField;
  ISBN?: ZoteroField;
  ISSN?: ZoteroField;
  abstractNote?: ZoteroField;
  language?: ZoteroField;

  thesisType?: ZoteroField;
  reportType?: ZoteroField;
  manuscriptType?: ZoteroField;
  letterType?: ZoteroField;
  mapType?: ZoteroField;
  type?: ZoteroField;

  number?: ZoteroField;
  reportNumber?: ZoteroField;
  patentNumber?: ZoteroField;
  docketNumber?: ZoteroField;
  documentNumber?: ZoteroField;
  publicLawNumber?: ZoteroField;
  billNumber?: ZoteroField;

  court?: ZoteroField;
  issuingAuthority?: ZoteroField;
  legislativeBody?: ZoteroField;
  committee?: ZoteroField;
  country?: ZoteroField;
  artworkMedium?: ZoteroField;
  interviewMedium?: ZoteroField;
  format?: ZoteroField;
  section?: ZoteroField;
  eventPlace?: ZoteroField;
  archive?: ZoteroField;
  archiveLocation?: ZoteroField;
  callNumber?: ZoteroField;
  applicationNumber?: ZoteroField;
  versionNumber?: ZoteroField;
  status?: ZoteroField;
  series?: ZoteroField;
  seriesTitle?: ZoteroField;
  seriesNumber?: ZoteroField;
  conferenceName?: ZoteroField;
  shortTitle?: ZoteroField;

  extra?: ZoteroField;
  tags?: ZoteroTag[];
  collections?: unknown[];
  dateAdded?: ZoteroField;
  dateModified?: ZoteroField;
}

/** A Zotero API item: `data` holds the fields, `key`/`version` sit alongside. */
export interface ZoteroItem {
  key?: string;
  version?: number;
  data?: ZoteroItemData;
  /** The LOCAL API exposes an attachment's file path here, not in `data.path`. */
  links?: { enclosure?: { href?: string } };
}

/** One name in a CSL creator list. */
export interface CSLCreator {
  literal?: string;
  family?: string;
  given?: string;
}

/**
 * The CSL entry this mapper assembles.
 *
 * Deliberately a loose record rather than `PartialCSLEntry`: it carries far more
 * than the shared shape (every CSL field the mapping fills, plus the internal
 * `_` extras), and several keys — the creator roles — are chosen at runtime. The
 * one place the richer object is narrowed to the shared type is the return.
 */
type BuiltCSLEntry = Record<string, unknown>;

export type { CSLDate };

export function parseZoteroDate(dateStr: string): CSLDate | undefined {
  if (!dateStr) return undefined;
  const fullMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (fullMatch) return { 'date-parts': [[+fullMatch[1], +fullMatch[2], +fullMatch[3]]] };
  const ymMatch = dateStr.match(/(\d{4})-(\d{2})/);
  if (ymMatch) return { 'date-parts': [[+ymMatch[1], +ymMatch[2]]] };
  const yMatch = dateStr.match(/(\d{4})/);
  if (yMatch) return { 'date-parts': [[+yMatch[1]]] };
  return { raw: dateStr };
}

function zoteroCreatorToCSL(creator: ZoteroCreator): CSLCreator {
  if (creator.name) return { literal: creator.name };
  const r: CSLCreator = {};
  if (creator.lastName) r.family = creator.lastName;
  if (creator.firstName) r.given = creator.firstName;
  return r;
}

const CREATOR_TYPE_TO_CSL_ROLE: Record<string, string> = {
  author: 'author',
  editor: 'editor',
  translator: 'translator',
  contributor: 'contributor',
  bookAuthor: 'container-author',
  seriesEditor: 'collection-editor',
  director: 'director',
  interviewer: 'interviewer',
  interviewee: 'author',
  composer: 'composer',
  producer: 'producer',
  scriptwriter: 'script-writer',
  reviewedAuthor: 'reviewed-author',
  performer: 'performer',
  wordsBy: 'lyricist',
  recipient: 'recipient',
  witness: 'witness',
  castMember: 'performer',
};

export function zoteroItemToCSL(
  item: ZoteroItem,
  groupId: number
): PartialCSLEntry | null {
  const data = item.data;
  if (!data?.citationKey) return null;
  // Items in the Zotero trash are not part of the library — never cite them.
  if (data.deleted) return null;

  const csl: BuiltCSLEntry = {
    id: data.citationKey,
    type: ZOTERO_TYPE_TO_CSL[data.itemType ?? ''] || 'document',
    groupID: groupId,
  };

  // Every Zotero type has its OWN name field, and only `case`, `statute` and
  // `email` differ from `title` (caseName / nameOfAct / subject). CSL puts the
  // item's name in `title` for ALL of them, so map the nearest equivalent —
  // otherwise the entry is "untitled" to the index, the search, the sort and
  // the popup's usable-entry filter.
  const title = data.title ?? data.caseName ?? data.nameOfAct ?? data.subject;
  if (title) csl.title = title;

  if (data.creators?.length) {
    const byRole: Record<string, CSLCreator[]> = {};
    for (const creator of data.creators) {
      const role =
        CREATOR_TYPE_TO_CSL_ROLE[creator.creatorType ?? ''] || 'author';
      if (!byRole[role]) byRole[role] = [];
      byRole[role].push(zoteroCreatorToCSL(creator));
    }
    for (const [role, names] of Object.entries(byRole)) csl[role] = names;
  }

  // Date: `date` for most, `dateDecided` (case), `dateEnacted` (statute),
  // `issueDate`/`filingDate` (patent).
  const date =
    data.date ?? data.dateDecided ?? data.dateEnacted ??
    data.issueDate ?? data.filingDate;
  if (date) csl.issued = parseZoteroDate(String(date));

  // `reporter` (case) and `code` (statute/bill) are the containing work, like
  // `publicationTitle` for an article.
  const containerTitle =
    data.publicationTitle ?? data.bookTitle ?? data.encyclopediaTitle ??
    data.dictionaryTitle ?? data.blogTitle ?? data.websiteTitle ??
    data.forumTitle ?? data.proceedingsTitle ?? data.programTitle ??
    data.reporter ?? data.code;
  if (containerTitle) csl['container-title'] = containerTitle;
  if (data.journalAbbreviation) csl['container-title-short'] = data.journalAbbreviation;

  const volume = data.volume ?? data.reporterVolume ?? data.codeVolume;
  if (volume) csl.volume = volume;
  if (data.issue) csl.issue = data.issue;
  const page = data.pages ?? data.firstPage ?? data.codePages;
  if (page) csl.page = page;
  if (data.numberOfVolumes) csl['number-of-volumes'] = data.numberOfVolumes;
  const numPages = data.numberOfPages ?? data.numPages;
  if (numPages) csl['number-of-pages'] = numPages;
  if (data.edition) csl.edition = data.edition;
  const publisher =
    data.publisher ?? data.institution ?? data.university ??
    data.repository ?? data.organization;
  if (publisher) csl.publisher = publisher;
  const place = data.place ?? data.repositoryLocation;
  if (place) csl['publisher-place'] = place;
  if (data.DOI) csl.DOI = data.DOI;
  if (data.URL) csl.URL = data.URL;
  if (data.ISBN) csl.ISBN = data.ISBN;
  if (data.ISSN) csl.ISSN = data.ISSN;
  if (data.abstractNote) csl.abstract = data.abstractNote;
  if (data.language) csl.language = data.language;

  // Type-specific fields that appear in a reference — the nearest equivalent of
  // title/author/date for non-publication types. First non-empty wins.
  const genre =
    data.thesisType ?? data.reportType ?? data.manuscriptType ??
    data.letterType ?? data.mapType ?? data.type;
  if (genre) csl.genre = genre;
  const number =
    data.number ?? data.reportNumber ?? data.patentNumber ??
    data.docketNumber ?? data.documentNumber ?? data.publicLawNumber ??
    data.billNumber;
  if (number) csl.number = number;
  const authority =
    data.court ?? data.issuingAuthority ?? data.legislativeBody ?? data.committee;
  if (authority) csl.authority = authority;
  if (data.country) csl.jurisdiction = data.country;
  const medium = data.artworkMedium ?? data.interviewMedium ?? data.format;
  if (medium) csl.medium = medium;
  if (data.section) csl.section = data.section;
  if (data.eventPlace) csl['event-place'] = data.eventPlace;
  if (data.archive) csl.archive = data.archive;
  if (data.archiveLocation) csl['archive_location'] = data.archiveLocation;
  if (data.callNumber) csl['call-number'] = data.callNumber;
  // A patent's application number is not a call number; keep it only as the
  // fallback when Zotero has no real call number (matches prior behaviour).
  if (data.applicationNumber && !data.callNumber) {
    csl['call-number'] = data.applicationNumber;
  }
  if (data.versionNumber) csl.version = data.versionNumber;
  if (data.status) csl.status = data.status;
  if (data.series) csl['collection-title'] = data.series;
  if (data.seriesTitle) csl['collection-title'] = data.seriesTitle;
  if (data.seriesNumber) csl['collection-number'] = data.seriesNumber;
  if (data.conferenceName) csl['event-title'] = data.conferenceName;

  // Zotero's Short Title maps to the CSL short form of the title.
  if (data.shortTitle) csl['title-short'] = data.shortTitle;

  // Retained for the note-template context (`src/template`). None of these are
  // CSL fields proper: `extra` is Zotero's free-text catch-all (parsed on
  // demand by `src/bib/extra.ts`), and tags/dateAdded have no CSL equivalent.
  // They cost nothing extra to keep — the item payload is already fetched and
  // walked here — and retaining them avoids a per-item request at import time.
  if (data.extra) csl._extra = data.extra;
  if (data.tags?.length) {
    const tags = data.tags
      .map((t) => t?.tag)
      .filter((t): t is string => typeof t === 'string' && !!t);
    if (tags.length) csl._tags = tags;
  }
  // Zotero collection KEYS the item belongs to (names live in the collection
  // index). Retained so the import dialogue can filter by collection without a
  // per-item request. Not a CSL field.
  if (Array.isArray(data.collections) && data.collections.length) {
    const keys = data.collections.filter(
      (k): k is string => typeof k === 'string' && !!k
    );
    if (keys.length) csl._collections = keys;
  }
  if (data.dateAdded) csl._dateAdded = data.dateAdded;

  // Ordered creators with Zotero's OWN `creatorType`, retained because the CSL
  // role grouping above is lossy for templates: it collapses two pairs
  // (`interviewee`→author, `castMember`→performer) and loses the cross-role
  // order Zotero shows. Better BibTeX never provides this, so the context
  // builder falls back to the CSL groups when `_creators` is absent.
  if (data.creators?.length) {
    const creators = data.creators
      .filter((c): c is ZoteroCreator => !!c && typeof c === 'object')
      .map((c) => {
        const out: CSLCreator & { role: string } = {
          role: c.creatorType || 'author',
        };
        if (c.name) out.literal = c.name;
        else {
          if (c.lastName) out.family = c.lastName;
          if (c.firstName) out.given = c.firstName;
        }
        return out;
      })
      .filter((c) => c.literal || c.family || c.given);
    if (creators.length) csl._creators = creators;
  }

  // Internal metadata — not CSL fields.
  if (data.dateModified) csl._dateModified = data.dateModified;
  // item.key is the 8-char Zotero item key (top-level, not inside data).
  // ZotLit needs this to index a literature note via the "zotero-key" frontmatter field.
  if (item.key) csl._zoteroKey = item.key;
  // item.version increments on every change to the item in Zotero. Used to
  // invalidate only the cached citations that reference this entry, instead of
  // re-rendering every note when anything in the library changes.
  if (item.version != null) csl._version = item.version;

  // The accumulator is a loose record, so the narrowing to the shared type is
  // explicit: `id` is always set (from `citationKey`), while `title` is only set
  // when the item has one — which `PartialCSLEntry` cannot express. Behaviour is
  // unchanged from the `any`-typed original; only the type is now honest.
  return csl as unknown as PartialCSLEntry;
}
