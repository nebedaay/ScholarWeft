/**
 * Reading-mode DOM → citation-source serialization.
 *
 * Live preview reads the raw Markdown source directly and hands it to
 * `getCitationSegments`. Reading mode has no source — Obsidian gives an
 * already-parsed DOM — so historically it re-derived a citation expression in
 * FOUR ad-hoc pre-passes (outer-bracket containers, adjacent linked anchors,
 * reference runs, split emphasis), each of which mishandled a shape the others
 * handled. This module replaces all of them with ONE faithful serializer: turn
 * the DOM back into the Markdown source it came from, then run the SAME parser
 * live preview runs. Any merging/composition the parser does (contiguous runs,
 * `@author [bracket]`, reference runs, `{}` overrides) then applies identically
 * in both modes.
 *
 * The serializer also returns a chunk list so a parsed match (a character range
 * in the reconstructed string) can be mapped back to the DOM nodes that
 * produced it, for replacement.
 */

/** Inline formatting Obsidian renders from Markdown inside a citation. */
export const INLINE_FORMAT_TAGS = new Set(['EM', 'I', 'STRONG', 'B', 'DEL', 'S']);

/** One contiguous piece of serialized source, tied to the DOM node(s) it came
 *  from. `kind` says whether the node can be split (a text node) or is atomic
 *  (an element serialized as a unit, e.g. `[[@key|alias]]` or `*em*`). */
export interface SourceChunk {
  text: string;
  node: Node;
  kind: 'text' | 'element';
}

export interface CitationSource {
  /** The reconstructed Markdown source for the whole subtree. */
  text: string;
  chunks: SourceChunk[];
}

/**
 * Extract the citekey from a reading-mode wikilink anchor. Obsidian renders
 * `[[@key|alias]]` as `<a data-href="@key">alias</a>`; the href may include a
 * folder path and/or a `.md` extension. Returns undefined when the target is
 * not an `@citekey` note — including the vault's derived-file convention
 * `[[@key - transcription]]` (a space after the key means a derivative, not the
 * literature note), which must stay a native wikilink.
 */
export function getLinkCiteKey(a: HTMLElement): string | undefined {
  const href = a.getAttribute('data-href') || a.getAttribute('href') || '';
  const base = href.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = base.replace(/\.md$/i, '');
  if (!stem.startsWith('@')) return undefined;
  const citekey = stem.slice(1);
  if (!/^[\w:.-]+$/.test(citekey)) return undefined;
  return citekey;
}

function serializeInlineElement(tag: string, inner: string): string {
  switch (tag) {
    case 'EM':
    case 'I':
      return `*${inner}*`;
    case 'STRONG':
    case 'B':
      return `**${inner}**`;
    case 'DEL':
    case 'S':
      return `~~${inner}~~`;
    default:
      return inner;
  }
}

/**
 * Serialize a DOM subtree back to the Markdown source it was rendered from.
 *
 * - text node → verbatim
 * - citation wikilink `<a data-href="@key">alias</a>` → `[[@key|alias]]`
 *   (or `[[@key]]` when the alias is the bare key)
 * - non-citation `<a>` → its text (kept as prose, not a citation)
 * - `<em>/<i>` → `*…*`, `<strong>/<b>` → `**…**`, `<del>/<s>` → `~~…~~`
 * - `<code>/<pre>` → its text (the parser masks code regions itself)
 * - any other element (span/div/p wrappers Obsidian inserts) → recursed into
 */
export function domToCitationSource(root: Node): CitationSource {
  const chunks: SourceChunk[] = [];

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = child.nodeValue ?? '';
        if (value) chunks.push({ text: value, node: child, kind: 'text' });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName;

      // The plugin's OWN output (a citation/reference span from an earlier
      // render, or this pass's fallback) must not be re-parsed. Emitting nothing
      // for it lets the replace loop re-serialize between replacements without
      // rediscovering what it already produced.
      if (
        el.classList?.contains('sw-citation') ||
        el.classList?.contains('sw-reference') ||
        el.classList?.contains('sw-citation-formatting') ||
        el.classList?.contains('sw-citation-extra')
      ) {
        continue;
      }

      if (tag === 'CODE' || tag === 'PRE') {
        // Emit backticks/fences so the parser's `maskCodeRegions` blanks it —
        // a `[@key]` inside code is not a citation.
        const value = el.textContent ?? '';
        if (!value) continue;
        const text =
          tag === 'PRE' ? `\n\`\`\`\n${value}\n\`\`\`\n` : `\`${value}\``;
        chunks.push({ text, node: el, kind: 'element' });
        continue;
      }
      if (tag === 'A') {
        const key = getLinkCiteKey(el);
        if (key) {
          const alias = (el.textContent ?? '').trim();
          const text =
            alias === '@' + key ? `[[@${key}]]` : `[[@${key}|${alias}]]`;
          chunks.push({ text, node: el, kind: 'element' });
        } else {
          // Non-citation link: keep its text as prose.
          walk(el);
        }
        continue;
      }
      if (INLINE_FORMAT_TAGS.has(tag)) {
        chunks.push({
          text: serializeInlineElement(tag, el.textContent ?? ''),
          node: el,
          kind: 'element',
        });
        continue;
      }
      // Transparent wrapper (span/div/p/li/…) — recurse.
      walk(el);
    }
  };

  walk(root);
  return { text: chunks.map((c) => c.text).join(''), chunks };
}

/**
 * Replace the source character range `[from, to)` in the DOM with `replacement`,
 * mapping through `chunks` from `domToCitationSource`. Text nodes are split at
 * the range boundaries; element chunks are atomic (removed whole when covered).
 * Returns true when something was replaced.
 */
export function replaceSourceRange(
  root: Node,
  chunks: SourceChunk[],
  from: number,
  to: number,
  replacement: Node
): boolean {
  let offset = 0;
  const spans = chunks.map((c) => {
    const start = offset;
    offset += c.text.length;
    return { ...c, start, end: offset };
  });
  const covered = spans.filter((c) => c.end > from && c.start < to);
  if (!covered.length) return false;

  const first = covered[0];
  const last = covered[covered.length - 1];
  const hasPrefix = first.kind === 'text' && from > first.start;
  const hasSuffix = last.kind === 'text' && to < last.end;

  // Match entirely inside ONE text node: split it into prefix + replacement +
  // suffix.
  if (first === last && hasPrefix && hasSuffix) {
    const node = first.node as Text;
    const prefix = first.text.slice(0, from - first.start);
    const suffix = first.text.slice(to - first.start);
    const parent = node.parentNode;
    if (!parent) return false;
    node.nodeValue = prefix;
    const suffixNode = document.createTextNode(suffix);
    parent.insertBefore(replacement, node.nextSibling);
    parent.insertBefore(suffixNode, replacement.nextSibling);
    return true;
  }

  // Keep the text before / after the match when a boundary lands mid-text-node.
  if (hasPrefix) {
    (first.node as Text).nodeValue = first.text.slice(0, from - first.start);
  }
  if (hasSuffix) {
    (last.node as Text).nodeValue = last.text.slice(to - last.start);
  }

  const parent = first.node.parentNode;
  if (!parent) return false;

  // Insert BEFORE removing, so the reference node is still attached. Insert
  // after the kept prefix when there is one, else before the suffix (if the
  // match ended mid-node) or before the first covered node.
  let ref: Node | null;
  if (hasPrefix) ref = first.node.nextSibling;
  else if (hasSuffix) ref = last.node;
  else ref = first.node;
  parent.insertBefore(replacement, ref);

  const toRemove = covered.filter(
    (c) => !(hasPrefix && c === first) && !(hasSuffix && c === last)
  );
  for (const c of toRemove) c.node.parentNode?.removeChild(c.node);
  return true;
}
