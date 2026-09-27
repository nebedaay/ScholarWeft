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
/**
 * Normalise `text`, remembering which ORIGINAL index each normalised character
 * came from.
 *
 * Assuming the two agree in length is wrong: `norm()` strips combining marks,
 * so an already-decomposed sequence (`u` + U+0304) becomes one character
 * shorter and every later offset shifts. The match is then FOUND on the
 * normalised string but the emphasis is applied at the wrong place in the
 * original — which is why a diacritic match could be located and yet not
 * visibly bolded.
 */
function normaliseWithMap(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const n = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) {
      out += n[k];
      map.push(i);
    }
  }
  return { text: out, map };
}

/**
 * The ORIGINAL-text span of `term` inside `text`, or null.
 *
 * `from` is where searching may begin in the original string, so every
 * occurrence can be found rather than just the first.
 */
function findTermIn(
  text: string,
  term: string,
  from: number
): { start: number; length: number } | null {
  const needle = norm(term);
  if (!needle) return null;
  const source = text.slice(from);
  const { text: normalised, map } = normaliseWithMap(source);
  const at = normalised.indexOf(needle);
  if (at === -1) return null;
  const lastIndex = Math.min(at + needle.length - 1, map.length - 1);
  const start = from + map[at];
  let end = from + map[lastIndex] + 1; // inclusive → exclusive
  // Extend over any COMBINING MARKS that follow, so a decomposed character is
  // emphasised whole rather than bolded up to its accent.
  while (end < text.length && /[\u0300-\u036f]/.test(text[end])) end++;
  if (end <= start) return null;
  return { start, length: end - start };
}

export interface TermSpan {
  start: number;
  length: number;
}

/**
 * Every non-overlapping span in `text` where one of `terms` appears, in order.
 *
 * Shared by the excerpt builder and the field highlighter (author, title,
 * citekey), so "where does this term appear" has ONE definition. Overlaps are
 * resolved longest-first, so emphasising a short term inside a longer one does
 * not leave a stray fragment bolded.
 */
export function findTermSpans(
  text: string | null | undefined,
  terms: readonly string[]
): TermSpan[] {
  if (!text || terms.length === 0) return [];
  const found: TermSpan[] = [];
  for (const term of terms) {
    if (!term) continue;
    // Find every occurrence, not just the first, using the offset-mapped
    // search so emphasis lands on the right characters when diacritics are
    // involved.
    let from = 0;
    for (;;) {
      const hit = findTermIn(text, term, from);
      if (!hit) break;
      found.push(hit);
      from = hit.start + Math.max(hit.length, 1);
    }
  }
  const sorted = found
    .filter((s) => s.length > 0 && s.start + s.length <= text.length)
    .sort((a, b) => a.start - b.start || b.length - a.length);
  const out: TermSpan[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start < prev.start + prev.length) continue; // overlaps
    if (prev && s.start === prev.start) continue;
    out.push(s);
  }
  return out;
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
    const hit = findTermIn(text, term, 0);
    if (!hit) continue;
    const first = words.findIndex((w) => w.start >= hit.start);
    if (first === -1) continue;
    const end = hit.start + hit.length;
    let last = first;
    while (last + 1 < words.length && words[last + 1].start < end) last++;
    spans.push({ from: first, to: last });
  }
  if (spans.length === 0) return [];

  // Candidate windows, one per term plus each pair's span. Grouping is chosen
  // by TERM COUNT rather than position alone: a slightly longer excerpt that
  // covers three terms is more illustrative than two short lines covering two
  // and one.
  const candidates: Array<{ from: number; to: number; terms: number[] }> = [];
  for (let i = 0; i < spans.length; i++) {
    candidates.push({ from: spans[i].from, to: spans[i].to, terms: [i] });
  }
  // Every contiguous run of terms, so a group spanning several is considered.
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const group = spans.slice(i, j + 1);
      candidates.push({
        from: Math.min(...group.map((s) => s.from)),
        to: Math.max(...group.map((s) => s.to)),
        terms: group.map((_, k) => i + k),
      });
    }
  }

  // A window must fit a line once context is added; longer groups are only
  // viable when the terms sit close together.
  /**
   * How wide a candidate's excerpt would be, in characters.
   *
   * The user's preference: a slightly longer excerpt that covers MORE terms
   * beats two short lines covering fewer, because the most illustrative text is
   * the best. So width is a SOFT limit — a window may exceed it when doing so
   * gathers more terms, and only gives way when it would be unreasonably long.
   */
  const widthOf = (c: { from: number; to: number }) =>
    words
      .slice(Math.max(0, c.from - context), Math.min(words.length - 1, c.to + context) + 1)
      .map((w) => w.word)
      .join(' ').length;

  /** Absolute ceiling: never show a line longer than this, however many terms. */
  const hardWidth = Math.round(width * 1.6);

  // Prefer windows covering MORE terms; break ties by the tighter span, so a
  // compact excerpt wins over a sprawling one with the same coverage.
  const ranked = candidates
    .filter((c) => widthOf(c) <= hardWidth)
    .sort(
      (a, b) =>
        b.terms.length - a.terms.length ||
        (a.to - a.from) - (b.to - b.from) ||
        a.from - b.from
    );

  // Greedily take the best windows, preferring those that cover terms NOT yet
  // shown. Without that preference a window covering only already-shown terms
  // could take the last slot, and a term with no window of its own would be
  // dropped silently.
  const chosen: Array<{ from: number; to: number }> = [];
  const covered = new Set<number>();
  while (chosen.length < maxLines && covered.size < spans.length) {
    const best = ranked.find((c) => c.terms.some((t) => !covered.has(t)));
    if (!best) break;
    chosen.push({
      from: Math.max(0, best.from - context),
      to: Math.min(words.length - 1, best.to + context),
    });
    for (const t of best.terms) covered.add(t);
  }

  // Any term still uncovered gets its own line if room remains — better to show
  // it than to drop it.
  for (let i = 0; i < spans.length && chosen.length < maxLines; i++) {
    if (covered.has(i)) continue;
    chosen.push({
      from: Math.max(0, spans[i].from - context),
      to: Math.min(words.length - 1, spans[i].to + context),
    });
    covered.add(i);
  }

  const merged = chosen.sort((a, b) => a.from - b.from);

  return merged.slice(0, maxLines).map((span) => {
    let from = span.from;
    let to = span.to;
    /** Which terms appear within [from,to], by word index. */
    const keepsAllTerms = () =>
      spans.every(
        (s) =>
          s.to < from ||
          s.from > to ||
          (s.from >= from && s.to <= to)
      );
    // Trim toward the comfortable width, but NEVER at the cost of a matched
    // term: the most illustrative text is the text that contains the match.
    let joined = words.slice(from, to + 1).map((w) => w.word).join(' ');
    while (joined.length > width && to - from > 1) {
      const mid = Math.floor((from + to) / 2);
      const tryFrom = mid - from > to - mid ? from + 1 : from;
      const tryTo = tryFrom === from ? to - 1 : to;
      const candidateFrom = tryFrom;
      const candidateTo = tryTo;
      const before = { from, to };
      from = candidateFrom;
      to = candidateTo;
      if (!keepsAllTerms()) {
        // Shrinking would drop a match; stop here rather than lose it.
        from = before.from;
        to = before.to;
        break;
      }
      joined = words.slice(from, to + 1).map((w) => w.word).join(' ');
    }
    const prefix = from > 0 ? '… ' : '';
    const suffix = to < words.length - 1 ? ' …' : '';
    const body = joined;
    // EVERY term's match inside the trimmed line, so a line containing several
    // matched words emphasises all of them rather than just the first.
    const matches = terms
      .map((t) => findTermIn(body, t, 0))
      .filter((m): m is { start: number; length: number } => !!m)
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
