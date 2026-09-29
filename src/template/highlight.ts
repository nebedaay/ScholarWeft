import { findTermSpans } from './search-excerpt';

/**
 * The ONE search-term highlighter, shared by the `@`/`@@` suggest popup and the
 * import modal's references/excerpts. "Where does this term appear" is defined
 * by `findTermSpans`; this module turns those spans into DOM.
 *
 * Two entry points, because the inputs differ:
 *   - `appendHighlighted` — the caller has a plain STRING (a title, an excerpt).
 *   - `highlightMatchesIn` — the caller has existing MARKUP to preserve (the
 *     rendered CSL reference, whose `<i>` title must stay italic).
 */

/** Class on every emphasised match. */
export const MATCH_CLASS = 'sw-suggest-match';

/** A bold, marked match element owned by `doc`. */
function matchEl(doc: Document, text: string): HTMLElement {
  const strong = doc.createElement('strong');
  strong.className = MATCH_CLASS;
  strong.textContent = text;
  return strong;
}

/**
 * Append `text` to `el`, wrapping every span matching one of `terms` in a bold
 * `<strong>`. Plain text is appended as text, so this never interprets markup.
 */
export function appendHighlighted(
  el: HTMLElement,
  text: string,
  terms: readonly string[]
): void {
  const spans = findTermSpans(text, terms);
  if (spans.length === 0) {
    el.append(text);
    return;
  }
  const doc = el.ownerDocument;
  let at = 0;
  for (const s of spans) {
    if (s.start > at) el.append(text.slice(at, s.start));
    el.append(matchEl(doc, text.slice(s.start, s.start + s.length)));
    at = s.start + s.length;
  }
  if (at < text.length) el.append(text.slice(at));
}

/**
 * Bold matches within EVERY text node under `root`, leaving the surrounding
 * elements alone — so an italicised title stays italic and only the matched
 * words are emphasised. For content that is already DOM (the import modal's
 * rendered reference).
 */
export function highlightMatchesIn(root: HTMLElement, terms: readonly string[]): void {
  if (terms.length === 0) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) textNodes.push(node as Text);

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    const spans = findTermSpans(text, terms);
    if (spans.length === 0) continue;
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (const s of spans) {
      if (s.start > at) frag.append(text.slice(at, s.start));
      frag.append(matchEl(doc, text.slice(s.start, s.start + s.length)));
      at = s.start + s.length;
    }
    if (at < text.length) frag.append(text.slice(at));
    textNode.replaceWith(frag);
  }
}
