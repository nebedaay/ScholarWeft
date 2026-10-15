export interface CSLName {
  family?: string;
  given?: string;
  literal?: string;
}

/** A CSL date: a parsed range, or the raw string when it could not be parsed. */
export interface CSLDate {
  'date-parts'?: number[][];
  raw?: string;
}

/**
 * The parts of citeproc's `Engine` this plugin uses.
 *
 * `citeproc` ships no typings, so `CSL.Engine` is untyped and every `engine.x`
 * would be an unsafe member access. Declaring the surface keeps the calls typed
 * (and documents what the plugin actually relies on).
 */
export interface CslEngine {
  opt: {
    lang?: string;
    /** citeproc's citation class: `note` for note styles, else `in-text`. */
    xclass?: 'note' | 'in-text';
    development_extensions?: { wrap_url_and_doi?: boolean };
    [key: string]: unknown;
  };
  updateItems(ids: string[]): void;
  retrieveItem(id: string): PartialCSLEntry | undefined;
  makeBibliography(): [
    { bibstart?: string; bibend?: string; entry_ids?: string[][] },
    string[],
  ] | false;
  rebuildProcessorState(
    cites: unknown[],
    mode: string,
    uncited?: string[]
  ): Array<[string, number, string]>;
  makeCitationCluster(items: unknown[]): string;
}

export interface PartialCSLEntry {
  id: string;
  title: string;
  groupID?: number;
  /** CSL issued date. */
  issued?: CSLDate;
  /** CSL author list — used by Fuse title-biased search. */
  author?: CSLName[];
  /** CSL editor list. */
  editor?: CSLName[];
  /** Which source this entry was loaded from. Internal — not a CSL field. */
  _source?: 'bib' | 'zotero';
  /** ISO dateModified from Zotero, used to resolve cross-group duplicates. */
  _dateModified?: string;
  /** Internal Zotero item key (8-char, e.g. "ABC12345"). Used to write the
   *  zotero-key frontmatter field that ZotLit needs to index a literature note. */
  _zoteroKey?: string;
  /** Zotero item version — increments on every change to the item. Used for
   *  per-entry cache invalidation (only notes citing a changed entry re-render). */
  _version?: number;
  /** Zotero's `extra` free text (parsed on demand by `bib/extra.ts`). Internal. */
  _extra?: string;
  /** Zotero tag strings. Internal — CSL has no equivalent. */
  _tags?: string[];
  /** Zotero collection KEYS the item belongs to. Internal. */
  _collections?: string[];
  /** Zotero `dateAdded`. Internal. */
  _dateAdded?: string;
  /** Ordered creators with Zotero's OWN `creatorType`. Internal: richer than the
   *  CSL role groups, which collapse two pairs and lose cross-role order.
   *  Structurally identical to `template/context`'s `CachedCreator`, so a plain
   *  `PartialCSLEntry` stays assignable to its `CachedEntry`. */
  _creators?: Array<{
    role: string;
    family?: string;
    given?: string;
    literal?: string;
  }>;
  /** A CSL entry carries far more than the fields named here — every CSL field
   *  the mapper fills, and the runtime-chosen creator roles (`author`, …). */
  [key: string]: unknown;
}

export type CSLList = PartialCSLEntry[];
