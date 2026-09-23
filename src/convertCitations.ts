/**
 * In-process citation converter (the TypeScript twin of
 * scripts/convert-citations.mjs).
 *
 * The plugin converts linked-citation wikilinks to pandoc syntax BEFORE
 * pandoc runs. Historically this was spawned as `node convert-citations.mjs`;
 * doing it here instead means the plugin needs no external Node.js runtime
 * (the CLI still runs the .mjs — see `--citations-input` in
 * DocumentCompiler.py). Both use the SAME parser (`expandAlias`), so they
 * must stay behaviourally identical.
 *
 *   [[@key]]                    -> [@key]
 *   [[@key|alias]]              -> [<alias with @-tokens expanded>]
 *   [[@key|Smith's work]]       -> Smith's work [@key]   (pure text label)
 *   [ [[@a]]; [[@b]] ]          -> [@a; @b]              (container)
 *   [[@key|@key -]]             -> @key                  (narrative / author-in-text)
 *   [[@key|-@key]]              -> [-@key]               (suppress author)
 *
 * Non-citation wikilinks ([[note name]]) are left untouched.
 */
import {
  expandAlias,
  getCitationSegments,
  getCitations,
  mergeContainerExpression,
} from './parser/parser';
import type { CitationSegments } from './parser/parser';

// Matches [[@key|alias]] / [[@key]] / ⟦ (from transformLinkAliases specialRe).
const SPECIAL_RE = new RegExp(
  '\\[\\[@([^|\\]\\s]+)\\|([\\s\\S]*?)\\]\\]|' +
    '\\[\\[@([^|\\]\\s]+)\\]\\]|' +
    '\u27e6',
  'g'
);

/**
 * The plugin's author-in-text flag: a trailing whitespace-separated '-' in an
 * alias means "narrative" (author in text). Live preview drops the dash and
 * renders it as narrative — `[[@key|@ -]]` shows "Ahrens (2022)". Pandoc
 * expresses narrative as `@key` OUTSIDE the brackets (AuthorInText), so the
 * dash must be consumed and the brackets dropped; emitting it literally as
 * `[@key -]` renders the dash as a suffix ("(Ahrens 2022 -)").
 * Returns the text without the flag, plus whether the flag was present.
 */
function splitAuthorInText(expanded: string): { text: string; narrative: boolean } {
  const m = /\s+-\s*$/.exec(expanded);
  return m
    ? { text: expanded.slice(0, m.index).trimEnd(), narrative: true }
    : { text: expanded, narrative: false };
}

/**
 * Rewrite outer-bracket containers "[ ... [[@k1]] ... [[@k2]] ... ]" into a
 * single merged pandoc citation. Member parsing is delegated to the shared
 * `mergeContainerExpression` (the single container parser), so the export
 * converter and the in-app parser can't drift. Text between the outer brackets
 * is dropped (only the members are emitted).
 */
function rewriteContainers(str: string): string {
  const containers: { open: number; close: number; merged: string }[] = [];
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
        depth++;
        i++;
      } else if (str[i] === '[' && str[i + 1] !== '[') {
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

    // Member parsing is shared with the plugin parser (single source of truth).
    const container = mergeContainerExpression(str.slice(open, close + 1));
    if (container) {
      const mergedParts: string[] = [];
      let firstNarrative = false;
      for (const link of container.members) {
        const aliasText = link.alias ?? '@' + link.key;
        const a = splitAuthorInText(expandAlias(aliasText, link.key));
        if (mergedParts.length === 0 && a.narrative) firstNarrative = true;
        mergedParts.push(a.text);
      }
      // Only the FIRST member can be narrative (the plugin drops a mid-group
      // '-' flag); pandoc expresses that as `@first [rest…]`.
      const merged = firstNarrative
        ? mergedParts[0] +
          (mergedParts.length > 1 ? ' [' + mergedParts.slice(1).join('; ') + ']' : '')
        : '[' + mergedParts.join('; ') + ']';
      containers.push({ open, close, merged });
      scan = close + 1;
      continue;
    }
    scan = open + 1;
  }

  // Emit: replace each container's source range with its merged form, skipping
  // any [[@…]] wikilinks that fall inside an emitted container.
  let out = '';
  let last = 0;
  let emittedUntil = -1;
  const isInside = (pos: number) => pos <= emittedUntil;
  let ci = 0;
  let m: RegExpExecArray | null;
  SPECIAL_RE.lastIndex = 0;
  while ((m = SPECIAL_RE.exec(str))) {
    while (ci < containers.length && containers[ci].open < m.index) {
      const c = containers[ci];
      if (c.open > emittedUntil) {
        out += str.slice(last, c.open);
        out += c.merged;
        last = c.close + 1;
        emittedUntil = c.close;
      }
      ci++;
    }
    if (isInside(m.index)) continue;
    // Standalone wikilink — emit the alias-expanded citation.
    out += str.slice(last, m.index);
    const full = m[0];
    const key = m[1] ?? m[3];
    const alias = m[2];
    const aliasText = alias ?? '@' + key;
    if (alias !== undefined && !/@/.test(alias)) {
      // Pure text label (no citation material): in Obsidian this stays a simple
      // link to the literature note; an exported document can't follow the
      // wikilink, so the citation is attached: "Smith's work [@key]".
      out += alias + ' [@' + key + ']';
    } else {
      // Citation material (or plain [[@key]]): emit the expanded citation. A
      // trailing whitespace-separated '-' is the plugin's author-in-text
      // (narrative) flag — pandoc expresses narrative as `@key` outside the
      // brackets, so the dash is consumed and the brackets dropped.
      const a = splitAuthorInText(expandAlias(aliasText, key));
      out += a.narrative ? a.text : '[' + a.text + ']';
    }
    last = m.index + full.length;
  }
  while (ci < containers.length) {
    const c = containers[ci];
    if (c.open > emittedUntil) {
      out += str.slice(last, c.open);
      out += c.merged;
      last = c.close + 1;
      emittedUntil = c.close;
    }
    ci++;
  }
  out += str.slice(last);
  return out;
}

/** Convert linked-citation wikilinks in `text` to pandoc citation syntax. */
export function convertCitationsInText(text: string): string {
  const lines = text.split('\n');
  const outLines = lines.map((line) =>
    /\[\[@/.test(line) ? rewriteContainers(line) : line
  );
  return outLines.join('\n');
}

/**
 * Full-reference insertions (`[[@key|reference]]` / `[[@key|ref]]`, or a
 * bracket container with such a member) have no pandoc/Zotero equivalent, so
 * the export pre-renders each entry to plain text and substitutes it here
 * before the standard conversion. These helpers are shared by the plugin's
 * in-process export path.
 */

/** Citekeys used by full-reference insertions, in document order (deduped). */
export function collectReferenceKeys(text: string): string[] {
  const groups = (getCitationSegments(text, false, true) as CitationSegments[])
    .filter((g) => g.reference);
  const keys = new Set<string>();
  for (const g of groups) {
    for (const c of getCitations(g).citations) keys.add(c.id);
  }
  return [...keys];
}

/** Replace each full-reference insertion with text from `lookup` (by citekey).
 *  A container renders one entry per paragraph; unresolvable keys are dropped. */
export function substituteReferenceInsertions(
  text: string,
  lookup: (key: string) => string | undefined
): string {
  const groups = (getCitationSegments(text, false, true) as CitationSegments[])
    .filter((g) => g.reference);
  if (!groups.length) return text;

  const edits = groups
    .map((g) => {
      const group = getCitations(g);
      const parts = group.citations
        .map((c) => lookup(c.id))
        .filter((v): v is string => !!v);
      return {
        from: g.referenceRange?.[0] ?? group.from,
        to: g.referenceRange?.[1] ?? group.to,
        text: parts.join('\n\n'),
      };
    })
    .filter((e) => e.text)
    // Replace from the end so earlier ranges stay valid.
    .sort((a, b) => b.from - a.from);

  let out = text;
  for (const e of edits) {
    out = out.slice(0, e.from) + e.text + out.slice(e.to);
  }
  return out;
}
