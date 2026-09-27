/**
 * Excerpts showing WHERE search terms were found, for `@@@` results.
 *
 * A result from the abstract tier can be puzzling without context: the term
 * matched, but nothing in the title or author explains why. So each matched
 * term earns a line of its surrounding text.
 *
 * The user's spec, verbatim intent:
 *   - terms found close together share ONE line, so the relationship is visible;
 *   - terms in different parts of the abstract get a line each;
 *   - a few words before and after the term, whatever fits a line.
 *
 * Pure, so the layout rules are testable without rendering.
 */

/** Rough characters that fit one suggestion line. */
export const EXCERPT_WIDTH = 90;

/** Words of context kept on each side of a match. */
export const CONTEXT_WORDS = 6;

export interface Excerpt {
  /** The display text, with the match intact and surrounding context. */
  text: string;
  /**
   * EVERY match within `text`, in order, for emphasis. Carrying only the first
   * bolded one word and left the others looking like ordinary text — so a line
   * containing four matched terms appeared to contain one.
   */
  matches: Array<{ start: number; length: number }>;
}

/**
 * Should this result show an abstract excerpt, and what should it say?
 *
 * Extracted because the excerpt previously rendered only on ONE branch of the
 * suggestion renderer. `searchTier` results carry no `matches`, so they took an
 * earlier `return` and never showed one — the excerpt was dead code for exactly
 * the tier that needs it. A pure decision, applied on every render path, cannot
 * regress that way.
 */
export function excerptForResult(
  item: { abstract?: string | null },
  queryTerms: readonly string[]
): Excerpt | null {
  if (queryTerms.length === 0) return null;
  const lines = buildExcerpts(item.abstract, queryTerms);
  return lines[0] ?? null;
}


/** Split text into word tokens with their offsets. */
function tokens(text: string): Array<{ word: string; start: number }> {
  const out: Array<{ word: string; start: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ word: m[0], start: m.index });
  return out;
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Case/diacritic-insensitive first offset of `term` in `text`, or -1. */
function indexOfTerm(text: string, term: string): number {
  const at = norm(text).indexOf(norm(term));
  if (at === -1) return -1;
  // Offsets align because NFD+strip preserves length for these characters.
  return Math.min(at, text.length);
}

/**
 * Build excerpt lines for the terms found in `text`.
 *
 * Overlapping windows are MERGED into one line, which is how "close together"
 * becomes one excerpt: two terms within a couple of words of each other would
 * otherwise produce two nearly identical lines. Terms far apart keep their own
 * lines, capped at `maxLines`.
 */
export function buildExcerpts(
  text: string | null | undefined,
  terms: readonly string[],
  opts: { maxLines?: number; width?: number; contextWords?: number } = {}
): Excerpt[] {
  if (!text) return [];
  const maxLines = opts.maxLines ?? 2;
  const width = opts.width ?? EXCERPT_WIDTH;
  const context = opts.contextWords ?? CONTEXT_WORDS;

  const words = tokens(text);
  if (words.length === 0) return [];

  // Word indices covering each term, so merging works on positions not chars.
  const spans: Array<{ from: number; to: number }> = [];
  for (const term of terms) {
    if (!term) continue;
    const at = indexOfTerm(text, term);
    if (at === -1) continue;
    const first = words.findIndex((w) => w.start >= at);
    if (first === -1) continue;
    const end = at + term.length;
    let last = first;
    while (last + 1 < words.length && words[last + 1].start < end) last++;
    spans.push({ from: first, to: last });
  }
  if (spans.length === 0) return [];

  // Merge overlapping/adjacent windows: `from - context` and `to + context`.
  const windows = spans
    .map((s) => ({
      from: Math.max(0, s.from - context),
      to: Math.min(words.length - 1, s.to + context),
    }))
    .sort((a, b) => a.from - b.from);

  const merged: Array<{ from: number; to: number }> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    // Overlapping windows mean the terms are close: one line shows both.
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else merged.push({ ...w });
  }

  return merged.slice(0, maxLines).map((span) => {
    let from = span.from;
    let to = span.to;
    // Trim the window to something that fits a line, centred on the match.
    let textWords = words.slice(from, to + 1).map((w) => w.word);
    let joined = textWords.join(' ');
    while (joined.length > width && to - from > 1) {
      // Drop from whichever side is longer, to keep the match centred.
      const mid = Math.floor((from + to) / 2);
      if (mid - from > to - mid) from++;
      else to--;
      textWords = words.slice(from, to + 1).map((w) => w.word);
      joined = textWords.join(' ');
    }
    const prefix = from > 0 ? '… ' : '';
    const suffix = to < words.length - 1 ? ' …' : '';
    const body = joined;
    // EVERY term's match inside the trimmed line, so a line containing several
    // matched words emphasises all of them rather than just the first.
    const matches = terms
      .map((t) => ({ length: t.length, start: indexOfTerm(body, t) }))
      .filter((m) => m.start >= 0)
      // Longest first, so overlapping terms do not leave a bare fragment
      // emphasised when a longer match covers the same text.
      .sort((a, b) => a.start - b.start || b.length - a.length);
    const deduped: Array<{ start: number; length: number }> = [];
    for (const m of matches) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.start === m.start) continue; // keep the longer one
      if (prev && m.start < prev.start + prev.length) continue; // overlaps
      deduped.push(m);
    }
    return {
      text: `${prefix}${body}${suffix}`,
      matches: deduped.map((m) => ({
        start: m.start + prefix.length,
        length: m.length,
      })),
    };
  });
}
