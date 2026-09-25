// Best-effort parsing of Zotero's free-text `extra` field.
//
// Zotero has no schema for `extra`: it holds anything that didn't fit Zotero's
// own fields, in three shapes we see in practice:
//   - `key: value` pairs (`Google-Books-ID: q7F6LWP9z9QC`, `Original Date: 1950`)
//   - free prose or HTML (`<p>Volume 29, Number 2</p>`)
//   - citeproc's "cheater" syntax (`{:original-date:}`), which is a marker with
//     no value and is therefore NOT a pair
//
// Pair rules are adapted from ZotLit (AGPL-3.0 — see NOTICE.md),
// `packages/db/src/lib/zt-extra.ts`, so the parse matches what these templates
// were written against: a line splits on its FIRST `:` or `=`, and is a pair
// only when the key starts with an ASCII letter and otherwise holds only
// letters, digits, spaces, dots, hyphens, or underscores, AND the value is
// non-empty. Anything else is kept verbatim as a text row so no prose is lost.
//
// Known CSL field names and their normalisation are likewise from ZotLit,
// `packages/db/src/lib/zt-extra-to-csl.ts`.

/** A parsed `key: value` row. */
export interface ExtraLinePair {
  /** Verbatim source line. */
  readonly raw: string;
  /** Parsed key, trimmed. */
  readonly key: string;
  /** Parsed value, trimmed; never empty on a pair row. */
  readonly value: string;
}

/** A prose, blank, or valueless row (e.g. `{:original-date:}`). */
export interface ExtraLineText {
  /** Verbatim source line. */
  readonly raw: string;
  /** Always null — a text row carries no key. */
  readonly key: null;
}

export type ExtraLine = ExtraLinePair | ExtraLineText;

/** Structured view of the `extra` field. */
export interface ItemExtra {
  /** Original field text verbatim, for a full round-trip. */
  readonly raw: string;
  /**
   * First value per key, for the common-case lookup (`extra.fields['musical-style']`).
   * First-wins: a repeated key keeps its first occurrence. Scan `lines` to
   * recover every value of a repeated key.
   */
  readonly fields: Record<string, string>;
  /** Every source row, in order — the source of truth `fields` derives from. */
  readonly lines: ExtraLine[];
}

/**
 * A line is a pair when its first `:` or `=` is preceded by a key that starts
 * with an ASCII letter and otherwise contains only letters, digits, spaces,
 * dots, hyphens, or underscores. The value keeps any later `:` / `=` (so
 * `URL: https://…` and `Pages: 10:20` survive intact).
 */
const EXTRA_PAIR_RE = /^([A-Za-z][\w .-]*?)\s*[:=]\s*(.+)$/;

/**
 * CSL fields Zotero recognises in `extra`.
 *
 * From ZotLit's `EXTRA_CSL_FIELDS` (AGPL-3.0), which mirrors Zotero's own
 * cheater-syntax handling. A key in this set is understood by citeproc, so it
 * is exposed as a real field rather than as a custom one.
 */
const EXTRA_CSL_FIELDS = new Set([
  'abstract', 'accessed', 'annote', 'archive', 'archive-place', 'author',
  'authority', 'call-number', 'chapter-number', 'citation-label',
  'citation-number', 'collection-editor', 'collection-number',
  'collection-title', 'composer', 'container', 'container-author',
  'container-title', 'container-title-short', 'dimensions', 'director',
  'edition', 'editor', 'editorial-director', 'event', 'event-date',
  'event-place', 'first-reference-note-number', 'genre', 'illustrator',
  'interviewer', 'issue', 'issued', 'jurisdiction', 'keyword', 'language',
  'locator', 'medium', 'note', 'number', 'number-of-pages',
  'number-of-volumes', 'original-author', 'original-date',
  'original-publisher', 'original-publisher-place', 'original-title', 'page',
  'page-first', 'publisher', 'publisher-place', 'recipient', 'references',
  'reviewed-author', 'reviewed-title', 'scale', 'section', 'source', 'status',
  'submitted', 'title', 'title-short', 'translator', 'type', 'version',
  'volume', 'year-suffix',
]);

/** Acronyms that stay uppercase (matching our CSL entries and Zotero's export). */
const UPPERCASE_FIELDS = new Set(['doi', 'isbn', 'issn', 'pmcid', 'pmid', 'url']);

/**
 * Parse an `extra` field. Returns `null` for absent/empty input so templates can
 * test for it (`item.extra?.fields`), matching ZotLit's contract where `extra`
 * is `ItemExtra | null`.
 */
export function parseExtra(extra: string | null | undefined): ItemExtra | null {
  if (!extra || !extra.trim()) return null;

  const lines: ExtraLine[] = [];
  const fields: Record<string, string> = {};

  for (const raw of extra.split(/\r?\n/)) {
    const m = EXTRA_PAIR_RE.exec(raw);
    if (!m) {
      // Prose, blank, or a valueless marker such as `{:original-date:}`.
      lines.push({ raw, key: null });
      continue;
    }
    const key = m[1].trim();
    const value = m[2].trim();
    if (!key || !value) {
      lines.push({ raw, key: null });
      continue;
    }
    lines.push({ raw, key, value });
    // First-wins, so a repeated key keeps its first occurrence.
    if (!(key in fields)) fields[key] = value;
  }

  return { raw: extra, fields, lines };
}

/**
 * Normalise an `extra` key to its CSL field name, or `null` when the key is not
 * a CSL field (i.e. it is the user's own custom property).
 *
 * `original date` → `original-date`, `Archive Location` → `archive_location`,
 * `doi` → `DOI`.
 */
export function extraKeyToCslField(key: string): string | null {
  const normalized = key.toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'archive-location') return 'archive_location';
  if (UPPERCASE_FIELDS.has(normalized)) return normalized.toUpperCase();
  if (EXTRA_CSL_FIELDS.has(normalized)) return normalized;
  return null;
}

/**
 * The context property a recognised `extra` field is exposed under.
 *
 * The template contract is camelCase (`originalDate`, `containerTitle`), so a
 * CSL field name is converted: `original-date` → `originalDate`. Acronyms stay
 * uppercase (`DOI`), and the one underscored field (`archive_location`) becomes
 * `archiveLocation`. Returns `null` for a non-CSL key.
 */
export function extraKeyToContextProperty(key: string): string | null {
  const csl = extraKeyToCslField(key);
  if (!csl) return null;
  if (/^[A-Z]+$/.test(csl)) return csl; // DOI, ISBN, ISSN, PMID, PMCID, URL
  return csl
    .split(/[-_]/)
    .map((part, i) =>
      i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join('');
}
