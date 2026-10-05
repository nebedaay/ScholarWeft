/**
 * Shared citation PRESENTATION: the span's class/attributes and the DOM for its
 * contents (the rendered citation value, or a reference group's entries). Used
 * by BOTH live preview (`CiteWidget.toDOM` in `editorExtension.ts`) and reading
 * mode (`buildCitationSpan` in `markdownPostprocessor.ts`) so the two modes
 * produce identical markup.
 *
 * Only the OUTER wrapper differs by design: reading mode wraps the content in an
 * `<a class="internal-link">` (Obsidian's own reading-mode click handler), while
 * live preview keeps the span and navigates via a `mousedown` listener because
 * CodeMirror removes the widget on click.
 */
import { RenderedCitation } from './parser/parser';

/** The span class for a citation (or reference) group. */
export function citationSpanClass(cite: RenderedCitation): string {
  return cite.reference
    ? 'sw-reference' + (cite.citations.length > 1 ? ' is-list' : '')
    : 'sw-citation is-resolved';
}

/** `data-citekey` / `data-source` / optional `data-note-index`. */
export function citationSpanAttributes(
  cite: RenderedCitation,
  sourcePath?: string
): Record<string, string> {
  const attr: Record<string, string> = {
    'data-citekey': cite.citations.map((c) => c.id).join('|'),
    'data-source': sourcePath ?? '',
  };
  if (cite.note) attr['data-note-index'] = cite.noteIndex.toString();
  return attr;
}

/** Per-member link/note state for a multi-work container (live preview). */
export interface MemberState {
  isWikilink: boolean;
  hasLitNote: boolean;
}

export interface CitationContentOptions {
  cite: RenderedCitation;
  /**
   * For a reference group: the resolved `.csl-entry` per citation, in order.
   * Reading mode passes Elements from `getBibForCiteKey`; live preview passes
   * cached HTML strings. Either may be missing (renders the citekey).
   */
  referenceHtml?: (string | Element | null | undefined)[];
  /** Multi-work container: per-member classes. */
  memberStates?: MemberState[];
  /** Reading mode only: the raw source text to fall back to when
   *  `renderCitationsReadingMode` is off. */
  sourceText?: Node;
  /** When true (and `sourceText` is set) render the raw source, not `val`. */
  useSourceText?: boolean;
}

/**
 * Build the citation span's INNER content as a fragment. Callers create the
 * wrapper (span + optional anchor), set the class/attributes from the helpers
 * above, then append this.
 */
export function renderCitationContent(
  opts: CitationContentOptions
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const { cite } = opts;

  if (cite.reference) {
    cite.citations.forEach((c, i) => {
      const item = document.createElement('span');
      item.className = 'sw-reference-entry';
      item.setAttribute('data-citekey', c.id);

      const raw = opts.referenceHtml?.[i];
      let entry: Element | null = null;
      if (raw instanceof Element) {
        entry = raw.querySelector('.csl-entry') ?? raw;
      } else if (typeof raw === 'string' && raw) {
        const parsed = new DOMParser().parseFromString(raw, 'text/html');
        entry =
          parsed.querySelector('.csl-entry') ?? parsed.body.firstElementChild;
      }
      if (entry) {
        item.appendChild(entry.cloneNode(true));
      } else {
        item.classList.add('is-unresolved');
        item.textContent = c.id;
      }
      frag.appendChild(item);
    });
    return frag;
  }

  if (opts.useSourceText && opts.sourceText) {
    frag.appendChild(opts.sourceText.cloneNode(true));
    return frag;
  }

  const val = cite.val ?? '';
  if (/</.test(val)) {
    const parsed = new DOMParser().parseFromString(val, 'text/html');
    frag.append(...Array.from(parsed.body.childNodes));
    return frag;
  }
  // Multi-work container: split per member so each carries its own
  // is-wikilink / has-lit-note class. Only when the part count matches.
  const states = opts.memberStates;
  if (states && states.length > 1 && states.length === cite.citations.length) {
    const parts = val.split(/;\s+/);
    if (parts.length === states.length) {
      parts.forEach((part, i) => {
        const m = states[i];
        const cls = ['sw-citation-member'];
        if (m.isWikilink) cls.push('is-wikilink');
        if (m.hasLitNote) cls.push('has-lit-note');
        const ms = document.createElement('span');
        ms.className = cls.join(' ');
        ms.textContent = part;
        frag.appendChild(ms);
        if (i < parts.length - 1) {
          frag.appendChild(document.createTextNode('; '));
        }
      });
      return frag;
    }
  }
  frag.appendChild(document.createTextNode(val));
  return frag;
}
