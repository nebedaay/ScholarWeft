import { locatorToTerm, locators } from './locators';
import { maskCodeRegions } from './code-mask';

export enum SegmentType {
  at = 'at',
  key = 'key',
  curlyBracket = 'curlyBracket',

  // In brackets
  suppressor = 'suppressor',
  bracket = 'bracket',
  prefix = 'prefix',
  suffix = 'suffix',
  locatorSuffix = 'locatorSuffix',
  locator = 'locator',
  locatorLabel = 'locatorLabel',
  separator = 'separator',

  // A `[[@key|reference]]` / `[[@key|ref]]` (or a bracket container with such a
  // member) inserts the full bibliography entry instead of an in-text citation.
  // The marker segment is zero-value and only distinguishes the group's data
  // from an otherwise-identical plain citation.
  reference = 'reference',
}

/** The alias values that switch a linked citation into a full-reference
 *  insertion. Matched case-insensitively against the trimmed alias. */
export const referenceAliasRe = /^(reference|ref)$/i;

/** A parsed citation group plus out-of-band reference metadata. */
export type CitationSegments = Segment[] & {
  /** True when this group inserts full reference(s) rather than a citation. */
  reference?: boolean;
  /** Original-text range of the driving `[[…]]` link / bracket container. */
  referenceRange?: [number, number];
};

export interface Segment {
  type: SegmentType;
  from: number;
  to: number;
  val: string;
}

interface State {
  inBrackets: boolean;
  inExplicitKey: boolean;
  inExplicitLocator: boolean;
  inKey: boolean;
  inLink: boolean;
  // True if we are inside a wikilink ([[...]]) that contains an alias pipe
  // e.g. [[@key|Alias]]. When this is true, we should ignore this bracketed
  // segment entirely so Obsidian can render the alias natively.
  inLinkHasAlias: boolean;
  // True when inside a wikilink whose target is "@key (space and other text)"
  // — e.g. [[@key - transcription]], the vault convention for derived files.
  // These are native wikilinks, NOT citations: a space after the key means
  // the filename is a derivative, not the literature note.
  inLinkDerived: boolean;
  inSuffix: boolean;
  seekingSuffix: boolean;
  seekingLocator: boolean;
  encounteredKey: boolean;
  shouldCancelSeek: boolean;
  // Index of the last ';' that was appended to a suffix (not emitted as a
  // separator). Used to suppress the "prev===';' starts a prefix" heuristic
  // when the semicolon was not actually a citation separator.
  semicolonAppendedAt: number;
  segment: Segment[];
  currentSegment: Segment;
  bracketDepth: number;
}

function newState(): State {
  return {
    bracketDepth: 0,
    inBrackets: false,
    inKey: false,
    inExplicitKey: false,
    inExplicitLocator: false,
    inSuffix: false,
    inLink: false,
    inLinkHasAlias: false,
    inLinkDerived: false,
    seekingSuffix: false,
    seekingLocator: false,
    encounteredKey: false,
    shouldCancelSeek: false,
    semicolonAppendedAt: -1,
    segment: [] as Segment[],
    currentSegment: null as Segment,
  };
}

const alphaNumeric = /[\p{L}\p{N}]/u;
const punct = /[:.#$%&\-+?<>~_/]/;
const nonKeyPunct = /\p{P}/u;
const space = /[ \t\v]/;
const preKey = /[ \t\v[\-\r\n;]/;
const locatorRe =
  /^((?:[[(]?[a-z\p{N}]+[\])]?[–—:-][[(]?[a-z\p{N}]+[\])]?(?:[–—][[(]?[a-z\p{N}]+[\])]?)?|[a-z\p{N}()[\]]*\p{N}+[a-z\p{N}()[\]]*|[mdclxvi]+(?![a-z\p{L}]|\.\s*\p{N}))(?:[ \t]*,[ \t]*(?:[[(]?[a-z\p{N}]+[\])]?[–—:-][[(]?[a-z\p{N}]+[\])]?(?:[–—][[(]?[a-z\p{N}]+[\])]?)?|[a-z\p{N}()[\]]*\p{N}+[a-z\p{N}()[\]]*|[mdclxvi]+(?![a-z\p{L}]|\.\s*\p{N})))*)/iu;

function isTerminus(s?: string) {
  return !s || s === '\r' || s === '\n';
}

function isValidPreKey(s?: string) {
  return !s || preKey.test(s);
}

export { mergeCompoundCitations } from './compound';

export function getSegmentData(segments: Segment[]) {
  let key: string;
  let locator: string;
  let locatorLabel: string;
  let prefix: string;
  let suffix: string;

  for (const seg of segments) {
    if (seg.type === SegmentType.prefix) {
      prefix = seg.val;
      continue;
    }

    if (seg.type === SegmentType.locator) {
      locator = seg.val;
      suffix = '';
      continue;
    }

    if (seg.type === SegmentType.locatorLabel) {
      locatorLabel = seg.val;
      continue;
    }

    if (seg.type === SegmentType.key) {
      key = seg.val;
      continue;
    }

    if (seg.type === SegmentType.suffix) {
      suffix = seg.val;
      continue;
    }
  }

  return {
    key,
    locator,
    locatorLabel,
    prefix,
    suffix,
  };
}

const parsePossibleLocator = (state: State) => {
  const segments: Segment[] = [];

  // The suffix segment always includes the separator that introduced it:
  //   ' p. 27'   (space before the label)
  //   ', p. 27'  (comma + space)
  //   ', 27'     (bare number — pandoc treats this as a PAGE locator)
  // Strip the leading separator first so the anchored locators/locatorRe
  // regexes can match the rest. The separator itself is kept as
  // locatorSuffix so the rendered citation still shows ", 27".
  const val = state.currentSegment.val;
  const sepMatch = val.match(/^([ \t]*[,;]?[ \t]*)/);
  const sep = sepMatch ? sepMatch[0] : '';
  const rest = val.slice(sep.length);
  let index = state.currentSegment.from + sep.length;

  if (sep) {
    segments.push({
      from: state.currentSegment.from,
      to: index,
      val: sep,
      type: SegmentType.locatorSuffix,
    });
  }

  const match = rest.match(locators);
  if (match) {
    const sp0 = match[1];
    const label = match[2];
    const sp1 = match[3];

    if (sp0) {
      segments.push({
        from: index,
        to: index + sp0.length,
        val: sp0,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp0.length;
    }

    segments.push({
      from: index,
      to: index + label.length,
      val: label,
      type: SegmentType.locatorLabel,
    });
    index = index + label.length;

    if (sp1) {
      segments.push({
        from: index,
        to: index + sp1.length,
        val: sp1,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp1.length;
    }

    const sliced = rest.slice(match.index + match[0].length);
    const locMatch = sliced.match(locatorRe);
    if (locMatch) {
      const loc = locMatch[1];
      segments.push({
        from: index,
        to: index + loc.length,
        val: loc,
        type: SegmentType.locator,
      });
      index = index + loc.length;

      const suffix = sliced.slice(locMatch.index + locMatch[0].length);
      if (suffix) {
        segments.push({
          from: index,
          to: index + suffix.length,
          val: suffix,
          type: SegmentType.suffix,
        });
      }
    } else {
      return [];
    }
  } else {
    // No explicit label (e.g. "p." / "chap."). Pandoc treats a bare number /
    // range / roman numeral after the comma as a PAGE locator, so mirror that:
    //   [@key, 27]   -> locator "27"   with implicit label "page"
    //   [@key, 155–56] -> locator "155–56" (page)
    //   [@key, xvii] -> locator "xvii" (roman page)
    // This makes citeproc render it via the CSL style (normalized) instead of
    // as raw suffix text, matching the Word-plugin / pandoc behaviour.
    //
    // IMPORTANT: a bare SPACE separator (no comma) means PROSE, not a
    // locator — e.g. "[[@key|@ discusses this]]" must keep "discusses this"
    // as a plain suffix ("(Key 2020 discusses this)"), NOT a locator. Without
    // this guard, the roman-numeral alternative in locatorRe matches "di" of
    // "discusses" (d/i are roman numerals) and mangles the suffix.
    const bare = rest.match(locatorRe);
    if (!bare) return [];
    const loc = bare[1];
    // No comma in the separator ⇒ the "locator" must start with a digit (a
    // real number/range); letters-only (incl. roman) after a bare space is
    // prose. With a comma, letters/roman are allowed (", xvii").
    if (!/,/.test(sep) && !/\p{N}/u.test(loc)) return [];

    segments.push({
      from: index,
      to: index + loc.length,
      val: loc,
      type: SegmentType.locator,
    });
    index = index + loc.length;

    // Explicit page label so citeproc knows the locator type even though the
    // source omitted it (pandoc's default). Zero-width: no text of its own.
    segments.push({
      from: index,
      to: index,
      val: 'page',
      type: SegmentType.locatorLabel,
    });

    const suffix = rest.slice(bare.index + bare[0].length);
    if (suffix) {
      segments.push({
        from: index,
        to: index + suffix.length,
        val: suffix,
        type: SegmentType.suffix,
      });
    }
  }
  return segments;
};

const parseExplicitLocator = (state: State) => {
  const match = state.currentSegment.val.match(locators);
  const segments: Segment[] = [];
  if (match) {
    const sp0 = match[1];
    const label = match[2];
    const sp1 = match[3];
    let index = state.currentSegment.from;

    if (sp0) {
      segments.push({
        from: index,
        to: index + sp0.length,
        val: sp0,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp0.length;
    }

    segments.push({
      from: index,
      to: index + label.length,
      val: label,
      type: SegmentType.locatorLabel,
    });
    index = index + label.length;

    if (sp1) {
      segments.push({
        from: index,
        to: index + sp1.length,
        val: sp1,
        type: SegmentType.locatorSuffix,
      });
      index = index + sp1.length;
    }

    const sliced = state.currentSegment.val.slice(
      match.index + match[0].length
    );
    if (sliced) {
      segments.push({
        from: index,
        to: index + sliced.length,
        val: sliced,
        type: SegmentType.locator,
      });
    } else {
      return [];
    }
  } else {
    // Forced locator with no label (`{2:41-43}` or `{, 2:41-43}`): the whole
    // block is the locator. Strip a leading separator so `{, 2:41-43}` yields
    // locator `2:41-43`, not `, 2:41-43`.
    const m = state.currentSegment.val.match(/^([ \t]*[,;]?[ \t]*)([\s\S]*)$/);
    if (m && m[2]) {
      state.currentSegment.from += m[1].length;
      state.currentSegment.val = m[2];
    }
    state.currentSegment.type = SegmentType.locator;
  }
  return segments;
};

export interface Citation {
  prefix?: string;
  suffix?: string;
  infix?: string;
  locator?: string;
  label?: string;
  'suppress-author'?: boolean;
  'author-only'?: boolean;
  composite?: boolean;
  id: string;
}

export interface CitationGroup {
  data: Segment[];
  citations: Citation[];
  from: number;
  to: number;
  /** True when the group inserts the full bibliography entry (the
   *  `[[@key|reference]]` / `ref` form) rather than an in-text citation. */
  reference?: boolean;
}

export interface RenderedCitation extends CitationGroup {
  val: string;
  noteIndex?: number;
  note?: string;
}

/**
 * Split a raw locator VALUE that begins with a label into its first labeled
 * part (`vol. 2, p. 41-43` → label `vol.`, value `2`, rest `, p. 41-43`).
 * A forced-locator block (`{vol. 2, p. 41-43}`) reaches `getCitations` as ONE
 * label-less locator value; this recovers the chain so volume:page can combine,
 * exactly as it does for the unbraced form. Returns null when no leading label
 * is present (`{ii, A, D-Z}`), leaving the value as a literal locator.
 */
function splitLeadingLocatorLabel(
  value: string
): { label: string; value: string; rest: string } | null {
  const m = value.match(locators);
  if (!m) return null;
  const after = value.slice(m.index + m[0].length);
  const lm = after.match(locatorRe);
  if (!lm) return null;
  return {
    label: m[2],
    value: lm[1],
    rest: after.slice(lm.index + lm[0].length),
  };
}

/**
 * Split a raw locator VALUE at its first `, <label> <value>` continuation
 * (`2, p. 41-43` → value `2`, rest `, p. 41-43`). Covers a forced-locator block
 * whose content already had its leading label consumed by the state machine
 * (`{vol. 2, p. 41-43}` → label `vol.`, value `2, p. 41-43`). A comma list
 * WITHOUT a label (`30-33, 40-44`) has no continuation and is left intact.
 */
function splitLocatorValueContinuation(
  value: string,
  label: string | undefined
): { value: string; rest: string } | null {
  // Only meaningful for a VOLUME followed by a PAGE — that is the one pair
  // combineLocators contracts. A page LIST (`pp. iv, vi-xi`) must stay intact.
  if (!isVolumeLabel(label)) return null;
  let i = value.indexOf(',');
  while (i !== -1) {
    const rest = value.slice(i);
    const parts = parseFollowingLocatorParts(rest).parts;
    if (parts.length && isPageLabel(parts[0].label)) {
      return { value: value.slice(0, i).trim(), rest };
    }
    i = value.indexOf(',', i + 1);
  }
  return null;
}

export function getCitations(
  segments: Segment[],
  locale: string = 'en-US'
): CitationGroup {
  const cites: Citation[] = [];
  // Reference groups carry their flag out-of-band (the marker segment is added
  // by getCitationSegments). Reading it here keeps getCitations usable on plain
  // segment arrays in tests.
  const reference = (segments as CitationSegments)?.reference === true;

  let key: string;
  let prefix: string;
  let suffix: string;
  let infix: string;
  let locator: string;
  let label: string;

  let suppressAuthor = false;
  let onlyAuthor = false;
  let composite = false;
  // True once a `;` separator has split this group — the `@author [p. 30; … @b]`
  // form needs no further split (the separator already did it), so the inner
  // `at` must not split again.
  let sawSeparator = false;

  const push = () => {
    // A trailing whitespace-separated '-' is the author-in-text flag (the
    // pandoc `@key -` form). Process it FIRST — before locator combination —
    // because when the group also carries a locator the dash sits at the end of
    // the whole suffix (`vol. 2, p. 41-43 -`), and `combineLocators` would
    // otherwise consume that suffix and leave the dash unhandled. On the first
    // citation it makes the whole group narrative (composite); elsewhere it is
    // dropped. The marker itself is never shown.
    if (suffix && /(^|\s)-\s*$/.test(suffix)) {
      if (cites.length === 0) composite = true;
      suffix = suffix.replace(/\s*-\s*$/, '');
      if (!suffix.trim()) suffix = undefined;
    }

    // A forced-locator block (`{vol. 2, p. 41-43}`) arrives as ONE label-less
    // locator value. Recover its leading label + value + following parts so the
    // volume:page combination applies, exactly as for the unbraced chain.
    if (!label && locator) {
      const split = splitLeadingLocatorLabel(locator);
      if (split) {
        label = split.label;
        locator = split.value;
        suffix = (split.rest || '') + (suffix ?? '');
      }
    }
    // A locator VALUE may still carry a `, <label> <value>` continuation
    // (`{vol. 2, p. 41-43}` → value `2, p. 41-43`); move it to the suffix so
    // combineLocators sees it.
    if (locator) {
      const cont = splitLocatorValueContinuation(locator, label);
      if (cont) {
        locator = cont.value;
        suffix = cont.rest + (suffix ?? '');
      }
    }

    // Combine a multi-part locator "vol. X, p. Y" into the single Chicago
    // locator "X:Y". Zotero allows only ONE locator per citation item, and
    // Chicago renders volume:page as "1:113" — so `vol. I, p. 113` becomes
    // locator "1:113" (roman volume converted to arabic), label "page".
    // Every volume synonym resolves to the same CSL term (see isVolumeLabel),
    // so `v. 2, p. 200–201` behaves exactly like `vol. 2, …`.
    const combined = combineLocators(label, locator, suffix);
    if (combined) {
      locator = combined.locator;
      label = combined.label;
      suffix = combined.suffix;
    }

    const cite: Citation = {
      id: key,
    };

    if (prefix?.trim()) cite.prefix = prefix.trim();
    if (suffix?.trim()) cite.suffix = suffix.trim();
    if (infix?.trim()) cite.infix = infix.trim();
    if (locator) cite.locator = locator;
    if (label && locatorToTerm[locale] && locatorToTerm[locale][label]) {
      cite.label = locatorToTerm[locale][label];
    }
    if (composite) cite.composite = composite;
    else if (suppressAuthor) cite['suppress-author'] = suppressAuthor;
    else if (onlyAuthor) cite['author-only'] = onlyAuthor;

    composite = false;
    onlyAuthor = false;
    suppressAuthor = false;

    cites.push(cite);
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    switch (seg.type) {
      case SegmentType.at:
        if (i === 0) {
          composite = true;
          continue;
        }
        // Pandoc's `@author [bracket]` — a BARE narrative citation immediately
        // followed by a bracketed citation (`@smith2025 [see also @jones2000]`,
        // `@a [@b]`) — arrives as ONE segment run whose first segment is a bare
        // `at`. Split at the FIRST inner `at` so the leading key becomes its own
        // narrative (author-only) citation and the bracketed citation a second
        // item. `@a [p. 30]` has no inner `at` → stays ONE citation (locator on
        // `a`). `@a [p. 30; see also @b]` DOES have a `;` separator, which
        // already split the group, so we must not split again (that duplicated
        // `a`). Linked/containered groups start with `bracket:[`, never this.
        if (
          !sawSeparator &&
          segments[0].type === SegmentType.at &&
          key !== undefined &&
          // A `-@key` inside the bracket is a suppress-author CONTINUATION of
          // the leading citation (`@key [-@key, p. 30]` = one citation, the
          // plugin's convention), not a second work — do not split there.
          segments[i - 1]?.type !== SegmentType.suppressor
        ) {
          // Prose between the leading key and the bracket's `@key` (e.g.
          // `[see also @b]`) is the NEW item's prefix, not the narrative's
          // suffix — lift it off before pushing the narrative citation.
          const carried = suffix ?? prefix;
          suffix = undefined;
          push();
          prefix = carried;
          locator = undefined;
          label = undefined;
          infix = undefined;
          onlyAuthor = false;
          suppressAuthor = false;
          composite = false;
        }
        continue;
      case SegmentType.suppressor:
        if (composite) {
          suffix = undefined;
          locator = undefined;
          label = undefined;
          composite = false;
          onlyAuthor = true;
          push();
        }
        suppressAuthor = true;
        continue;
      case SegmentType.separator:
        push();
        prefix = undefined;
        suffix = undefined;
        locator = undefined;
        label = undefined;
        infix = undefined;
        onlyAuthor = false;
        suppressAuthor = false;
        composite = false;
        sawSeparator = true;
        continue;
      case SegmentType.key:
        key = seg.val;
        continue;
      case SegmentType.prefix:
        prefix = seg.val;
        continue;
      case SegmentType.suffix:
        suffix = seg.val;
        continue;
      case SegmentType.locator:
        locator = seg.val;
        continue;
      case SegmentType.locatorLabel:
        label = seg.val;
        continue;
    }
  }

  push();

  return {
    data: segments,
    citations: cites,
    from: segments[0].from,
    to: segments[segments.length - 1].to,
    reference: reference || undefined,
  };
}

/**
 * True when a parsed locator label names a VOLUME in any of its forms.
 *
 * The parser reads the label token verbatim ("vol.", "volume", "v.", localized
 * spellings), and `label` here may be either a raw token or an already-mapped
 * CSL term. Both `expandAlias` and `getCitations` must recognize the whole
 * family so that `vol. 2, p. 3`, `volume 2, p. 3`, `v. 2, p. 3` and `vols. 2,
 * p. 3` are all treated identically (pandoc accepts every volume abbreviation).
 * English forms are matched directly (covering locales where the label is left
 * unmapped); localized forms resolve through `locatorToTerm` for the locale.
 */
export function isVolumeLabel(label: string | undefined, locale = 'en-US'): boolean {
  if (!label) return false;
  const trimmed = label.trim().toLowerCase();
  // Direct English spellings/abbreviations, singular and plural. `v.`/`vv.`
  // are verse in CSL, but the vault writes them for volume (the two share the
  // abbreviation); a leading volume token followed by a page locator is
  // unambiguously a volume:page citation, so treat them as volume here.
  if (
    /^(v|vv|vo|vlm|vlms|vol|vols|volume|volumes|tom|tome|tomes|band|bd|bde|bind)$/.test(
      trimmed.replace(/\.$/, '')
    )
  ) {
    return true;
  }
  // Localized forms (e.g. "m" in ar, "جلد" in fa, "т" in uk) via the map.
  const term = locatorToTerm[locale]?.[trimmed] ?? locatorToTerm[locale]?.[trimmed.replace(/\.$/, '')];
  return term === 'volume';
}

/** True when a parsed label is (or defaults to) the PAGE locator. */
function isPageLabel(label: string | undefined, locale = 'en-US'): boolean {
  if (!label) return true; // an unlabeled locator defaults to page
  return label === 'page' || locatorToTerm[locale]?.[label] === 'page';
}

/**
 * Combine a volume locator followed by a page locator into the single Chicago
 * "volume:page" locator (e.g. `vol. I, p. 113` → `locator "1:113"`, label
 * "page"). Zotero/citeproc allow only ONE locator per citation item, and
 * Chicago renders it as `1:113`. Accepts every volume synonym (isVolumeLabel)
 * and `p.`/`pp.` (with or without a period) after the comma. Returns null when
 * the shape does not match, so the caller keeps the original suffix.
 */
export function combineVolumePage(
  label: string | undefined,
  locator: string | undefined,
  suffix: string | undefined,
  locale = 'en-US'
): { locator: string; label: string } | null {
  if (!locator || !suffix || !isVolumeLabel(label, locale)) return null;
  const m = suffix.match(/^,\s*p{1,2}\.?\s*(\S.*)$/i);
  if (!m) return null;
  return { locator: `${romanToArabic(locator)}:${m[1].trim()}`, label: 'page' };
}

/** One labeled locator part parsed from a citation suffix. */
interface LocatorPart {
  /** Raw label token as written (`vol.`, `p.`, `chapter`, or `''`). */
  label: string;
  value: string;
  /** Offset in the parsed string where the part's separator starts, and just
   *  past its value. */
  start: number;
  end: number;
}

/**
 * Parse the labeled locator parts after the first in a citation suffix — the
 * `, vol. 2–6, chapter 10–13 and *passim*` tail. Stops at the first chunk that
 * is not `, <label> <value>` (prose such as `and *passim*`), which is returned
 * as `tail`. Values use the same `locatorRe` as the first part, so a
 * comma-joined number list stays one value and a following label is not
 * swallowed.
 */
function parseFollowingLocatorParts(
  suffix: string
): { parts: LocatorPart[]; tail: string } {
  const parts: LocatorPart[] = [];
  let cursor = 0;
  while (cursor < suffix.length) {
    const rest = suffix.slice(cursor);
    const sep = rest.match(/^[ \t]*[;,]?[ \t]*/);
    if (!sep || !/[;,]/.test(sep[0])) break; // parts are comma/semicolon separated
    const sepLen = sep[0].length;
    const afterSep = rest.slice(sepLen);
    const labelMatch = afterSep.match(locators);
    if (!labelMatch) break;
    const valStart = sepLen + labelMatch[0].length;
    const valueMatch = suffix.slice(cursor + valStart).match(locatorRe);
    if (!valueMatch) break;
    parts.push({
      label: labelMatch[2],
      value: valueMatch[1],
      start: cursor,
      end: cursor + valStart + valueMatch[0].length,
    });
    cursor = cursor + valStart + valueMatch[0].length;
  }
  return { parts, tail: suffix.slice(cursor) };
}

/**
 * Combine a MULTI-PART locator chain to what CSL/Zotero can hold: one colon
 * locator plus an explicit suffix. Pandoc/CSL allow only ONE locator per
 * citation item, so the plugin picks the volume+page pair (the only nesting
 * pair Chicago contracts to `V:P`) and leaves every other division EXPLICIT in
 * the suffix, in source order:
 *
 *   vol. 2, p. 69            -> locator "2:69",   label page
 *   vol. 2, p. 69, line 35   -> locator "2:69",   suffix ", line 35"
 *   p. i–iv, vol. 2–6, chapter 10–13 and *passim*
 *                            -> locator "2–6:i–iv", suffix ", chapter 10–13 and *passim*"
 *
 * Returns null when there is no volume+page pair, so the caller keeps the
 * plain single-locator + suffix parse (e.g. `p. 15, line 10`).
 */
export function combineLocators(
  label: string | undefined,
  locator: string | undefined,
  suffix: string | undefined,
  locale = 'en-US'
): { locator: string; label: string; suffix?: string } | null {
  if (!locator) return null;
  const first: LocatorPart = {
    label: label ?? '',
    value: locator,
    start: 0,
    end: 0,
  };
  const parsed = suffix
    ? parseFollowingLocatorParts(suffix)
    : { parts: [] as LocatorPart[], tail: '' };
  const all = [first, ...parsed.parts];

  const isPage = (l: string) =>
    !l || l === 'page' || locatorToTerm[locale]?.[l] === 'page';
  const isVol = (l: string) => isVolumeLabel(l, locale);

  // Volume:page is combined ONLY when they ADJACENT (`vol. 2, p. 69`). An
  // intervening part makes the chain non-adjacent and is left alone
  // (`vol. 2, chap. 4, p. 69` → `2:69, chap. 4` would be illogical — a volume
  // and a chapter shown like a volume and a page). Pandoc/CSL have no form for
  // three locators anyway, so the whole chain stays as parsed: page locator +
  // explicit suffix.
  const volIdx = all.findIndex((p) => isVol(p.label));
  const pageIdx = all.findIndex((p) => isPage(p.label));
  if (volIdx === -1 || pageIdx === -1 || volIdx === pageIdx) return null;
  if (pageIdx - volIdx !== 1) return null;

  const combined = `${romanToArabic(all[volIdx].value)}:${all[pageIdx].value}`;

  // Any further divisions stay explicit, in source order, using the label
  // token as written (no CSL localization — the third locator is a suffix).
  // Normalize a numeric/roman RANGE's hyphen to an en dash, matching how
  // citeproc/pandoc render locator ranges (`10-13` → `10–13`).
  const enDash = (v: string) =>
    v.replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, '\u2013');
  const others = all.filter((_, i) => i !== volIdx && i !== pageIdx);
  const text = others
    .map((p) => (p.label ? `${p.label} ${enDash(p.value)}` : enDash(p.value)))
    .join(', ');
  const newSuffix = (text ? ', ' + text : '') + parsed.tail;
  return {
    locator: combined,
    label: 'page',
    suffix: newSuffix.trim() ? newSuffix : undefined,
  };
}

/** Convert a roman numeral string (I, IV, X, …) to an arabic number, or
 *  return the input unchanged when it isn't a roman numeral. */
function romanToArabic(s: string): string {
  const map: Record<string, number> = {
    I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
  };
  const up = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(up)) return s;
  let total = 0;
  let prev = 0;
  for (let i = up.length - 1; i >= 0; i--) {
    const v = map[up[i]];
    if (v < prev) total -= v;
    else { total += v; prev = v; }
  }
  return String(total);
}

/**
 * Expand an alias string the same way the pandoc export filter does: every
 * '@'-token is replaced by the link's own citekey. A bare '@' (followed by a
 * delimiter such as space, ',', ';', or the end of the alias) is the shorthand
 * proxy and also expands — unambiguous because citekeys always have letters
 * after the '@'. A trailing whitespace-separated '-' (the author-in-text flag)
 * is deliberately kept in the text so the state machine can see it and mark
 * the citation as narrative (composite).
 *
 * Multi-part locators of the form `vol. X, p. Y` (or `pp. Y-Z`) are combined
 * into the single Chicago-style locator `X:Y` — Zotero allows only ONE locator
 * per citation item, and Chicago renders volume:page as "1:113". The volume
 * numeral is converted to arabic ("I" → "1"). A standalone `vol. X` keeps its
 * volume label.
 *
 *   'see also @, 6'   ->  'see also @key, 6'   (bare @ is the proxy)
 *   'see also @@, 6'  ->  'see also @key, 6'   (legacy @@ shorthand)
 *   '@other, p. 5'    ->  '@key, p. 5'   (link key wins over alias keys)
 *   '@, vol. I, p. 113' -> '@key, 1:113'  (combined Chicago locator)
 *   '@key -'          ->  '@key -'       (flag survives for getCitations)
 *   '-@key'           ->  '-@key'        (suppressed author survives)
 */
export function expandAlias(alias: string, linkKey: string): string {
  // Replace every `@`-token with the link key. `{` is EXCLUDED from the token
  // body, so a brace immediately after the proxy survives and becomes a
  // forced-locator block: `@{vol. 2, p. 41-43}` → `@key{vol. 2, p. 41-43}`
  // (the proxy expands, the braces stay). The old `@[^\s,;]*` consumed the `{`
  // and left a stray `}`. A bare `@{}` likewise becomes `@key{}`.
  const expanded = alias.replace(/@[^\s,;{]*/g, '@' + linkKey);
  // Combine "vol. X, p. Y" / "vol. X, pp. Y-Z" into "X:Y" / "X:Y-Z".
  // Handles both arabic and roman volume numerals (roman → arabic). EVERY
  // volume synonym (vol./vols./volume/volumes/v./vv./bd./Bd./band/bind/tome)
  // is accepted so the alias and segment paths agree (see isVolumeLabel).
  // The page capture stops at `}` so a forced-locator block isn't overrun.
  return expanded.replace(
    /(^|[\s,({])(?:vols?|volumes?|vv?|bd|bde|band|bind|tomes?|tom)\.?\s*([IVXLCDM]+|\d+),\s*p{1,2}\.?\s*([^\s}]+)/gi,
    (_m, pre: string, vol: string, page: string) =>
      `${pre}${romanToArabic(vol)}:${page}`
  );
}

export interface ContainerMember {
  key: string;
  alias?: string;
}

export interface MergedContainer {
  /** The merged citation expression, e.g. `[@a; @b]`. */
  expr: string;
  /** Members in document order (the renderer decides how to display them). */
  members: ContainerMember[];
  /** True when at least one member uses the `reference`/`ref` alias, so the
   *  whole container inserts full references rather than a citation. */
  reference: boolean;
}

/** Members inside a container: wikilinks `[[@key|alias]]` and plain
 *  `[@key, suffix]` citations, in order. */
const containerMemberRe =
  /\[\[@([^|\]\s]+)(?:\|([\s\S]*?))?\]\]|\[@([^\]\s,;]+)([^\]]*)\]/g;

/**
 * Parse ONE multi-member container — the outer-bracket form
 *
 *   [ [[@a|see also @@, 3]]; [[@b]]; [[@c]] ]
 *
 * — into its members plus a merged citation expression `[see also @a, 3; @b; @c]`.
 * This is the single source of truth for container parsing: `transformLinkAliases`
 * (parsing/live preview) and the reading-mode post-processor both call it, and
 * renderers branch on `reference` rather than re-detecting the alias.
 *
 * A `reference`/`ref` member marks the whole container as a REFERENCE list.
 * Reference containers are permissive: everything between the members (`;`,
 * labels, prose) is discarded and each member contributes its own citekey, so
 * `[[@a|reference]] [[@b]]`, `[[@a|reference]]; see [[@b]]`, etc. all parse the
 * same way. Renderers then show the full entries instead of the in-text
 * citation. A container with no reference member keeps its historical rule:
 * `[ … ]` is permissive (text between members ignored, plain `[@key]` members
 * allowed, a single member collapses to `[@a]`).
 */
export function mergeContainerExpression(
  containerText: string
): MergedContainer | null {
  const isBracket =
    containerText.startsWith('[') &&
    containerText.endsWith(']') &&
    containerText[1] !== '[';
  if (!isBracket) return null;
  const content = containerText.slice(1, containerText.length - 1);

  // Collect the members first so a reference member can make the whole
  // container permissive regardless of what surrounds it.
  const members: {
    key: string;
    alias?: string;
    ref: boolean;
    start: number;
    end: number;
  }[] = [];
  containerMemberRe.lastIndex = 0;
  let m: RegExpExecArray;
  while ((m = containerMemberRe.exec(content))) {
    if (m[1] !== undefined) {
      // [[@key|alias]] member.
      const alias = m[2];
      members.push({
        key: m[1],
        alias,
        ref: alias !== undefined && referenceAliasRe.test(alias.trim()),
        start: m.index,
        end: m.index + m[0].length,
      });
    } else {
      // Plain [@key, suffix] member; the suffix becomes an alias-style suffix.
      const tail = (m[4] ?? '').trim();
      members.push({
        key: m[3],
        alias: tail ? `@@${tail}` : undefined,
        ref: false,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  if (members.length < 1) return null;

  const publicMembers: ContainerMember[] = members.map((x) => ({
    key: x.key,
    alias: x.alias,
  }));

  if (members.some((x) => x.ref)) {
    // Reference container: strip everything between the members.
    const expr = members.map((x) => '@' + x.key).join('; ');
    return { expr: '[' + expr + ']', members: publicMembers, reference: true };
  }

  // Citation container.
  let expr = '';
  for (let i = 0; i < members.length; i++) {
    const mem = members[i];
    const aliasText = mem.alias ?? '@' + mem.key;
    if (i > 0) expr += '; ';
    expr += expandAlias(aliasText, mem.key);
  }
  return { expr: '[' + expr + ']', members: publicMembers, reference: false };
}

/**
 * Pre-scan for aliased citation wikilinks of the form `[[@key|alias]]` and
 * rewrite them into plain bracket citations `[alias]` so the existing state
 * machine parses the alias text as a citation expression:
 *
 *   [[@smith1992|see also @@, 6]]  ->  [see also @smith1992, 6]
 *
 * Inside the alias, EVERY '@'-token (including the `@@` shorthand) expands to
 * the link's own citekey, so key conflicts resolve in favour of the link (the
 * autocompleted target is trusted; an alias key is assumed to be a typo).
 * A trailing whitespace-separated '-' is the author-in-text flag, kept in the
 * text for getCitations to interpret:
 *
 *   [[@smith1992|@smith1992 -]]    ->  [@smith1992 -]  (narrative citation)
 *
 * Outer-bracket multi-work containers are merged into a single citation:
 *
 *   [ [[@a]]; [[@b|see also @@, 3]] ] -> [see also @a, 3; @b]
 *
 * When `linkCiteKey` is provided (reading mode, where Obsidian renders only
 * the alias text inside an <a> element and the raw `[[@key|…]]` markup is
 * unavailable), the same token and trailing-dash rules apply to the bare text.
 *
 * Returns the rewritten text plus an index map from rewritten position back to
 * original position, so segment offsets can be restored after parsing.
 */
function transformLinkAliases(
  str: string,
  linkCiteKey?: string
): { text: string; map: number[]; referenceRanges: Array<[number, number]> } {
  const out: string[] = [];
  const map: number[] = [];
  // Original-text ranges of `[[@key|reference]]` links and bracket containers
  // that contain one, so getCitationSegments can flag the parsed group.
  const referenceRanges: Array<[number, number]> = [];
  let last = 0;

  const push = (ch: string, src: number) => {
    out.push(ch);
    map.push(src);
  };

  const copyRange = (from: number, to: number) => {
    for (let i = from; i < to; i++) push(str[i], i);
  };

  // Copy an alias with every '@'-token (including a bare '@' proxy) replaced
  // by '@' + linkKey, mapping each emitted character back to the alias
  // position it came from.
  const emitExpanded = (alias: string, key: string, aliasStart: number) => {
    // Same token rule as `expandAlias`: `{` is excluded so a brace directly
    // after the proxy survives as a forced-locator block.
    const tokenRe = /@[^\s,;{]*/g;
    let cursor = 0;
    let tm: RegExpExecArray;
    while ((tm = tokenRe.exec(alias))) {
      for (let k = cursor; k < tm.index; k++) push(alias[k], aliasStart + k);
      push('@', aliasStart + tm.index);
      for (let n = 0; n < key.length; n++) push(key[n], aliasStart + tm.index + n);
      cursor = tm.index + tm[0].length;
    }
    for (let k = cursor; k < alias.length; k++) push(alias[k], aliasStart + k);
  };

  const specialRe = new RegExp(
    '\\[\\[@([^|\\]\\s]+)\\|([\\s\\S]*?)\\]\\]|' +
      '\\[\\[@([^|\\]\\s]+)\\]\\]',
    'g'
  );

  // Outer-bracket multi-citation containers: `[ ... [[@k1]] ... [[@k2]] ... ]`
  // (2+ wikilinks inside a plain bracket pair). The base parser would treat
  // the inner `[[`/`]]` as literal prefix/suffix text, so rewrite the whole
  // group into a clean pandoc multi-cite `[@k1; @k2]` — ignoring any text or
  // whitespace between the outer brackets and the inner wikilinks. Single
  // wikilinks (`[ [[@k]] ]`) collapse to `[@k]`. NOT triggered for normal
  // bracket citations (`[@a; @b]`, `[@a, p. 5]`, `[text](url)`) — those
  // contain no `[[@…]]` pattern.
  const bracketContainers: Array<{ open: number; close: number; merged: string }> = [];
  {
    let scan = 0;
    while (scan < str.length) {
      const open = str.indexOf('[', scan);
      if (open === -1) break;
      if (str[open + 1] === '[') {
        scan = open + 2;
        continue;
      }
      let depth = 0;
      let close = -1;
      for (let i = open + 1; i < str.length; i++) {
        if (str[i] === '[' && str[i + 1] === '[') {
          // Wikilink open [[ — nested inside the outer bracket pair.
          depth++;
          i++;
        } else if (str[i] === '[' && str[i + 1] !== '[') {
          // Plain citation open [@key — also nested (so `[ [@a]; [@b] ]`
          // doesn't close at the inner [@a]'s ']').
          depth++;
        } else if (str[i] === ']' && str[i + 1] === ']') {
          if (depth > 0) {
            depth--;
            i++;
          } else {
            close = i;
            break;
          }
        } else if (str[i] === ']' && str[i + 1] !== ']') {
          if (depth > 0) {
            depth--;
          } else {
            close = i;
            break;
          }
        }
      }
      if (close === -1) break;

      // Delegate member parsing (and the reference rule) to the single shared
      // container parser — the same function the reading-mode post-processor
      // uses — so citations and references stay in lock-step.
      const container = mergeContainerExpression(str.slice(open, close + 1));
      if (container) {
        bracketContainers.push({
          open,
          close,
          merged: container.expr,
        });
        if (container.reference) referenceRanges.push([open, close + 1]);
        scan = close + 1;
        continue;
      }

      scan = open + 1;
    }
  }

  let m: RegExpExecArray;

  // Emit the outer-bracket containers (in document order) interleaved with the
  // specialRe matches. The specialRe loop skips any wikilink that falls inside
  // an already-emitted container — otherwise the inner [[@key]] get rewritten a
  // second time (producing stray duplicate segments after the merged group).
  let containerIdx = 0;
  let emittedUntil = -1; // positions <= this were consumed by a container
  const isInsideEmittedContainer = (pos: number): boolean =>
    pos <= emittedUntil;

  while ((m = specialRe.exec(str))) {
    // Emit any container that starts before this specialRe match.
    while (
      containerIdx < bracketContainers.length &&
      bracketContainers[containerIdx].open < m.index
    ) {
      const c = bracketContainers[containerIdx];
      if (c.open > emittedUntil) {
        copyRange(last, c.open);
        for (let k = 0; k < c.merged.length; k++) {
          // First char maps to the outer '[', last to the outer ']' so the
          // widget covers the whole bracket group.
          push(c.merged[k], k === c.merged.length - 1 ? c.close : c.open);
        }
        last = c.close + 1;
        emittedUntil = c.close;
      }
      containerIdx++;
    }

    if (isInsideEmittedContainer(m.index)) {
      // This wikilink is part of an already-emitted outer-bracket container.
      continue;
    }

    // Plain [[@key]] (no alias) — groups 3/4; aliased [[@key|alias]] —
    // groups 1/2. Normalise both to a single bracket citation so the widget
    // range covers the FULL wikilink (starting at the first '['). Without
    // this, plain [[@key]] fell through to the base parser which produced a
    // bracket segment at from:1 — leaving the leading '[' outside the widget
    // range, which made live-preview render Obsidian's link decoration for
    // that dangling '[' instead of our citation widget.
    const full = m[0];
    const key = m[1] ?? m[3];
    const alias = m[2];
    const start = m.index;
    const end = m.index + full.length;

    // Copy everything up to and including the first '[' of '[['
    copyRange(last, start + 1);

    if (alias !== undefined) {
      const aliasStart = start + 4 + key.length; // after '[[@key|'

      if (referenceAliasRe.test(alias.trim())) {
        // `[[@key|reference]]` → a plain `[@key]` group flagged as a full
        // reference. Emit from the link's own target (not the alias) so the
        // position map stays valid regardless of alias/key lengths.
        referenceRanges.push([start, end]);
        const keyStart = start + 2; // after '[['
        for (let k = 0; k < key.length + 1; k++) {
          push(str[keyStart + k], keyStart + k); // '@' + key
        }
        push(']', end - 2);
        last = end;
        continue;
      }

      // Copy the alias, expanding every '@'-token to the link's key. A
      // trailing ' -' flag is kept so getCitations can mark the group as
      // narrative.
      emitExpanded(alias, key, aliasStart);

      // Closing ']' maps to the first ']' of ']]'
      push(']', end - 2);
    } else {
      // [[@key]] -> [@key]: copy '@key', then the closing ']' maps to the
      // first ']' of ']]'.
      const keyStart = start + 2; // after '[['
      for (let k = 0; k < key.length + 1; k++) {
        push(str[keyStart + k], keyStart + k); // '@' + key
      }
      push(']', end - 2);
    }
    last = end;
  }

  // Emit any remaining outer-bracket containers after the last specialRe match.
  while (containerIdx < bracketContainers.length) {
    const c = bracketContainers[containerIdx];
    if (c.open > emittedUntil) {
      copyRange(last, c.open);
      for (let k = 0; k < c.merged.length; k++) {
        push(c.merged[k], k === c.merged.length - 1 ? c.close : c.open);
      }
      last = c.close + 1;
      emittedUntil = c.close;
    }
    containerIdx++;
  }

  // Bare-text expansion (reading mode: content is just the anchor text)
  if (linkCiteKey) {
    let i = last;
    while (i < str.length) {
      if (str[i] === '@') {
        // Stop the token at ']' too: reading mode wraps the anchor text in
        // brackets ("[@key]"), so a token like /@[^\s,;]*/ would swallow the
        // closing bracket and break the citation.
        const token = /^@[^\s,;\]\[]*/.exec(str.slice(i));
        if (token) {
          push('@', i);
          // Map the key characters to the original positions AFTER the '@'
          // (the token body). Mapping them at 'i + n' (over the '@') made the
          // key segment's original from/to overlap the at segment, and the
          // walker's content-slicing then produced doubled '@' + trailing
          // garbage (the "[@@key4]" corruption in containers, cases 8/9).
          for (let n = 0; n < linkCiteKey.length; n++) push(linkCiteKey[n], i + 1 + n);
          i += token[0].length;
          continue;
        }
      }
      push(str[i], i);
      i++;
    }
    return { text: out.join(''), map, referenceRanges };
  }

  copyRange(last, str.length);
  return { text: out.join(''), map, referenceRanges };
}

export function getCitationSegments(
  str: string,
  ignoreLinks: boolean = false,
  expandLinkAliases: boolean = false,
  linkCiteKey?: string
): CitationSegments[] {
  return mergeAdjacentGroups(str, getCitationSegmentsRaw(str, ignoreLinks, expandLinkAliases, linkCiteKey));
}

/**
 * Merge citation groups that are ADJACENT — separated only by spaces/tabs and
 * at most ONE newline (a soft wrap), with no other text.
 *
 * `[[@a]] [[@b]]` then renders as ONE compound citation `(A 2000; B 1984)`
 * instead of two, without needing the container. The container stays as the
 * explicit form for when there IS text between members
 * (`[ [[@a]]; see [[@b]] ]`).
 *
 * A synthetic `separator` segment is inserted between the groups, exactly as
 * the container scanner does, so `getCitations` pushes the first citation before
 * parsing the second. Reference groups are left alone.
 */
function mergeAdjacentGroups(
  str: string,
  groups: CitationSegments[]
): CitationSegments[] {
  if (groups.length < 2) return groups;
  // Drop a trailing ` -` suffix (the author-in-text flag) from a group so it is
  // no longer marked `composite` — used to IGNORE a non-leading narrative when
  // it is merged into a citation run (see below). Operates on the segment
  // copies, not the source text.
  const dropNarrativeFlag = (g: CitationSegments): CitationSegments => {
    const copy: CitationSegments = g
      .filter((s) => !(s.type === SegmentType.suffix && s.val.trim() === '-'))
      .map((s) => ({ ...s }));
    return copy;
  };
  const out: CitationSegments[] = [];
  for (const group of groups) {
    const prev = out[out.length - 1];
    // A contiguous run that contains ANY `reference`/`ref` member becomes a
    // reference list — matching the explicit container rule ("a list is either
    // all citations or all references"). For such a run we ignore the other
    // members' aliases entirely (including the narrative `@ -` flag), so a
    // `[[@a|reference]] [[@b|@ -]]` run still lists both as references.
    const anyReference = !!prev?.reference || !!group.reference;
    if (
      prev &&
      prev.length > 0 &&
      group.length > 0 &&
      // Only BRACKET-style citations merge; a bare narrative `@a` does not.
      prev[0].type === SegmentType.bracket &&
      group[0].type === SegmentType.bracket
    ) {
      const prevLast = prev[prev.length - 1];
      // `to` is inclusive on some paths and exclusive on others; the char at
      // `to` disambiguates (both kinds end with `]`).
      const prevEnd =
        str[prevLast.to] === ']' ? prevLast.to + 1 : prevLast.to;
      const sep = str.slice(prevEnd, group[0].from);
      if (/^[ \t]*\n?[ \t]*$/.test(sep)) {
        const merged: CitationSegments = prev.concat();
        // The APPENDED member is never the first of the run, so its narrative
        // (` -`) flag is always dropped: a LEADING narrative stays narrative
        // (it is the `prev` group, never appended), while a narrative that is
        // not first is ignored (pandoc's `@a [b]` has no mid-list narrative).
        const appended = dropNarrativeFlag(group);
        merged.push(
          {
            type: SegmentType.separator,
            from: prevEnd,
            to: group[0].from,
            val: ';',
          },
          ...appended
        );
        if (anyReference) {
          merged.reference = true;
          // Carry the reference range so the widget / export substitution covers
          // the WHOLE run (not just the member that carried the `reference`
          // alias). Only the aliased member has a `referenceRange`, so combine
          // its start with the run's actual segment end.
          const prevStart = prev.referenceRange?.[0] ?? prev[0].from;
          const runEnd =
            str[group[group.length - 1].to] === ']'
              ? group[group.length - 1].to + 1
              : group[group.length - 1].to;
          const prevRange = prev.referenceRange;
          const groupRange = group.referenceRange;
          const combinedEnd = Math.max(
            runEnd,
            prevRange?.[1] ?? 0,
            groupRange?.[1] ?? 0
          );
          merged.referenceRange = [Math.min(prevStart, groupRange?.[0] ?? prevStart), combinedEnd];
        }
        out[out.length - 1] = merged;
        continue;
      }
    }
    out.push(group);
  }
  return out;
}

function getCitationSegmentsRaw(
  str: string,
  ignoreLinks: boolean = false,
  expandLinkAliases: boolean = false,
  linkCiteKey?: string
): CitationSegments[] {
  // A citekey inside `inline code` or a fenced block is NOT a citation: mask
  // code regions first. Masking preserves length, so every offset below still
  // maps 1:1 onto the original string, and no `@`/`[` survives in code.
  str = maskCodeRegions(str);

  // Aliased-link citations only apply when link citations are processed at
  // all (ignoreLinks === false means renderLinkCitations is on).
  if (expandLinkAliases && !ignoreLinks) {
    const { text, map, referenceRanges } = transformLinkAliases(str, linkCiteKey);
    // Use the RAW scanner here: merging before the reference flag is attached
    // would pull an ordinary citation into a `|reference` group. The public
    // wrapper merges AFTER mapping, so reference groups are skipped correctly.
    const groups = getCitationSegmentsRaw(text, ignoreLinks);
    if (!groups.length) return groups as CitationSegments[];
    return groups.map((group) => {
      const remapped = group.map((seg) => ({
        ...seg,
        from: map[seg.from],
        to: map[seg.to - 1] + 1,
      })) as CitationSegments;
      // Flag a group that came from a `[[@key|reference]]` link (or a bracket
      // container with such a member). Match by range overlap so the group owns
      // the whole original link, and add a zero-value marker segment so the
      // group's data differs from an otherwise-identical plain citation.
      const groupTo =
        remapped.length > 0 ? remapped[remapped.length - 1].to : remapped[0]?.to ?? 0;
      const groupFrom = remapped.length > 0 ? remapped[0].from : 0;
      const range = referenceRanges.find(
        ([f, t]) => f < groupTo && t > groupFrom
      );
      if (range) {
        remapped.reference = true;
        remapped.referenceRange = range;
        remapped.push({
          type: SegmentType.reference,
          from: range[0],
          to: range[1],
          val: '',
        });
      }
      return remapped;
    });
  }

  const segments: Segment[][] = [];

  let state: State = null;
  let seekState: State = null;

  const endSegment = () => {
    if (state.encounteredKey) {
      segments.push(state.segment);
    }
    state = null;
  };

  const newCurrent = (i: number, c: string, type: SegmentType): Segment => {
    return {
      from: i,
      to: i + 1,
      val: c,
      type: type,
    };
  };

  const endCurrent = (i: number) => {
    if (state.seekingLocator || seekState?.seekingLocator) {
      if (state.currentSegment.type === SegmentType.suffix) {
        const segments = parsePossibleLocator(state);
        if (segments.length) {
          state.segment.push(...segments);
          state.seekingLocator = false;
          return;
        }
      } else if (state.currentSegment.type === SegmentType.locatorSuffix) {
        const segments = parseExplicitLocator(state);
        if (segments.length) {
          state.segment.push(...segments);
          state.seekingLocator = false;
          return;
        }
      }
    }

    state.currentSegment.to = i;
    state.segment.push(state.currentSegment);
  };

  for (let i = 0, len = str.length + 1; i < len; i++) {
    const prev = str[i - 1];
    const c = str[i];
    const next = str[i + 1];

    if (c === '[') {
      if (next === '[' && !state) continue;
      if (state) state.bracketDepth++;
      if (!state || state.bracketDepth === 1) {
        if (state?.seekingSuffix) {
          seekState = state;
        }
        state = newState();
        state.bracketDepth = 1;
        state.currentSegment = newCurrent(i, c, SegmentType.bracket);
        state.inBrackets = true;
        if (prev === '[') state.inLink = true;
        continue;
      }
    }

    if (c === '@' && isValidPreKey(prev)) {
      if (seekState && state.shouldCancelSeek) {
        segments.push(seekState.segment);
        seekState = null;
      }

      if (state?.inBrackets) {
        endCurrent(i);
      } else {
        state = newState();
      }

      state.currentSegment = newCurrent(i, c, SegmentType.at);
      state.inKey = true;
      state.encounteredKey = true;
      continue;
    }

    if (state?.seekingSuffix && !space.test(c)) {
      endSegment();
      continue;
    }

    if (state?.inKey) {
      if (isTerminus(c)) {
        if (!state.inBrackets) {
          endCurrent(i);
          endSegment();
        }
        state = null;
        continue;
      }

      if (prev === '@') {
        if (alphaNumeric.test(c) || c === '_') {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.key);
          continue;
        }

        if (c === '{') {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
          state.inExplicitKey = true;
          continue;
        }

        state = null;
        continue;
      }

      if (state.inExplicitKey && c !== '}') {
        if (state.currentSegment.type !== SegmentType.key) {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.key);
          continue;
        }
        state.currentSegment.val += c;
        continue;
      }

      if (c === '}') {
        endCurrent(i);
        state.inKey = false;
        state.inExplicitKey = true;
        state.seekingLocator = true;
        if (!state.inBrackets) {
          state.segment.push(newCurrent(i, c, SegmentType.curlyBracket));
          state.seekingSuffix = true;
          state.shouldCancelSeek = true;
        } else {
          state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
          state.inSuffix = true;
        }
        continue;
      }

      if (c === '{') {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
        state.inKey = false;
        state.inSuffix = true;
        state.seekingLocator = true;
        state.inExplicitLocator = true;
        continue;
      }

      if (alphaNumeric.test(c)) {
        state.currentSegment.val += c;
        continue;
      }

      if (space.test(c)) {
        // Inside a wikilink ([[...]]), a space after the key means the target
        // is "@key (space and other text)" — a derived filename like
        // [[@key - transcription]], NOT a citation. Mark the link so the
        // closing ']' skips it entirely (native wikilink stays intact).
        if (state.inLink) state.inLinkDerived = true;

        endCurrent(i);
        state.inKey = false;
        state.seekingLocator = true;

        if (!state.inBrackets) {
          state.seekingSuffix = true;
          state.shouldCancelSeek = true;
        } else {
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
          state.inSuffix = true;
        }
        continue;
      }

      if (punct.test(c)) {
        if (isTerminus(next)) {
          if (!state.inBrackets) {
            endCurrent(i);
            endSegment();
          }
          state = null;
          continue;
        }

        if (next && punct.test(next)) {
          // Double punct
          endCurrent(i);
          state.inKey = false;
          if (!state.inBrackets) {
            endSegment();
          } else {
            state.currentSegment = newCurrent(i, c, SegmentType.suffix);
            state.inSuffix = true;
            state.seekingLocator = true;
          }
          continue;
        }

        if (space.test(next)) {
          if (!state.inBrackets) {
            endSegment();
          } else {
            endCurrent(i);
            state.inKey = false;
            state.currentSegment = newCurrent(i, c, SegmentType.suffix);
            state.inSuffix = true;
            state.seekingLocator = true;
          }
          continue;
        }

        state.currentSegment.val += c;
        continue;
      }

      if (!state.inBrackets) {
        if (nonKeyPunct.test(c)) {
          endCurrent(i);
          endSegment();
        }
        state = null;
        continue;
      }
    }

    if (state?.inBrackets) {
      if (isTerminus(c)) {
        state = null;
        continue;
      }

      // Detect alias pipe inside a wikilink. If we see a '|' while inside
      // a double-bracket link, mark this link as aliased so we can skip it
      // when the link closes. This preserves Obsidian's native alias display
      // in Live Preview and Reading view.
      if (c === '|' && state.inLink) {
        state.inLinkHasAlias = true;
      }

      if (c === ']') {
        state.bracketDepth--;
        if (state.bracketDepth === 0) {
          // Skip citation parsing for links when ignoreLinks is enabled,
          // OR when we are in a wikilink that contains an alias pipe,
          // OR when the target is a derived filename (@key - transcription).
          if (
            ignoreLinks ||
            (state.inLink && state.inLinkHasAlias) ||
            (state.inLink && state.inLinkDerived)
          ) {
            if (state.inLink || next === '(') {
              state = null;
              seekState = null;
              continue;
            }
          }

          endCurrent(i);
          state.segment.push(newCurrent(i, c, SegmentType.bracket));

          if (!seekState) {
            endSegment();
          } else {
            seekState.segment.push(...state.segment);
            segments.push(seekState.segment);
            seekState = null;
            state = null;
          }
          continue;
        }
      }

      if (c === ';') {
        // Only treat as a citation separator when an '@' (or '-@') follows
        // before the bracket closes. A semicolon with no subsequent citation
        // key is suffix/note text, not a separator — matching pandoc's behaviour
        // and fixing the case where users write prose like "[@key, see Smith; cf. Jones]".
        let j = i + 1;
        let hasFollowingKey = false;
        let depth = state.bracketDepth;
        for (; j < str.length; j++) {
          if (str[j] === '[') depth++;
          else if (str[j] === ']') {
            if (--depth === 0) break;
          } else if (str[j] === '@') {
            hasFollowingKey = true;
            break;
          }
        }
        if (hasFollowingKey) {
          state.shouldCancelSeek = false;
          endCurrent(i);
          state.inKey = false;
          state.currentSegment = newCurrent(i, c, SegmentType.separator);
        } else if (state.inKey) {
          // ';' immediately after the key with no following citation: start a suffix
          endCurrent(i);
          state.inKey = false;
          state.inSuffix = true;
          state.seekingLocator = false;
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
          state.semicolonAppendedAt = i;
        } else {
          state.currentSegment.val += c;
          state.semicolonAppendedAt = i;
        }
        continue;
      }

      if (c === '-' && next === '@') {
        state.shouldCancelSeek = false;
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.suppressor);
        continue;
      }

      if (c === '{') {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
        // A `{` while we are still looking for a locator opens pandoc's
        // explicit locator block (`{...}` forces its content to be a locator).
        // Cover both the in-bracket `[@key, {pp. 3}]` form and the linked
        // `@key {}` form (the space makes `state`, not `seekState`, the owner).
        if (state.seekingLocator || seekState?.seekingLocator) {
          state.inExplicitLocator = true;
        }
        continue;
      }

      if (c === '}') {
        if (state.inExplicitLocator) {
          if (state.currentSegment.type === SegmentType.suffix) {
            state.currentSegment.type = SegmentType.locatorSuffix;
            state.seekingLocator = false;
          } else if (state.currentSegment.type === SegmentType.curlyBracket) {
            // Empty `{}` immediately after the key is pandoc's "prevent the
            // suffix from being parsed as a locator" marker
            // (`[@smith{}, 99 years later]` → suffix ", 99 years later", no
            // locator). Nothing sits between the braces, so stop locator
            // detection and let the following text stay a suffix.
            state.seekingLocator = false;
          }
        }
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.curlyBracket);
        continue;
      }

      if (prev === '{') {
        endCurrent(i);
        if (state.seekingLocator && state.encounteredKey) {
          state.currentSegment = newCurrent(i, c, SegmentType.locatorSuffix);
        } else {
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
        }
        state.inSuffix = true;
        continue;
      }

      if (prev === '}' || prev === '{') {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.suffix);
        state.inSuffix = true;
        continue;
      }

      if (seekState) {
        if (prev === ';' && state.semicolonAppendedAt !== i - 1) {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.prefix);
          state.inSuffix = false;
          continue;
        } else if (prev === '[' && state.bracketDepth === 1) {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.suffix);
          state.inSuffix = true;
          continue;
        }
      } else {
        if (prev === '[' || (prev === ';' && state.semicolonAppendedAt !== i - 1)) {
          endCurrent(i);
          state.currentSegment = newCurrent(i, c, SegmentType.prefix);
          continue;
        }
      }

      if (state.inKey) {
        endCurrent(i);
        state.currentSegment = newCurrent(i, c, SegmentType.suffix);
        state.inSuffix = true;
        state.inKey = false;
        state.seekingLocator = true;
        continue;
      }

      state.currentSegment.val += c;
      continue;
    }

    if (!state?.seekingSuffix) {
      state = null;
    }
  }

  if (state?.seekingSuffix) {
    segments.push(state.segment);
  }

  return segments;
}
