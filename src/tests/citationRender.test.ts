/**
 * Unit tests for the shared citation presentation (used by BOTH live preview
 * and reading mode). Locks the class/attribute contract and the content
 * builders so the two renderers cannot drift.
 */
import {
  citationSpanClass,
  citationSpanAttributes,
  renderCitationContent,
} from '../citationRender';
import type { RenderedCitation } from '../parser/parser';

const cite = (over: Partial<RenderedCitation>): RenderedCitation =>
  ({
    data: [],
    citations: [{ id: 'a' }],
    from: 0,
    to: 1,
    val: '(A 2000)',
    ...over,
  } as RenderedCitation);

describe('citationSpanClass', () => {
  it('citation vs reference vs reference list', () => {
    expect(citationSpanClass(cite({}))).toBe('sw-citation is-resolved');
    expect(
      citationSpanClass(cite({ reference: true, citations: [{ id: 'a' }] }))
    ).toBe('sw-reference');
    expect(
      citationSpanClass(
        cite({ reference: true, citations: [{ id: 'a' }, { id: 'b' }] })
      )
    ).toBe('sw-reference is-list');
  });
});

describe('citationSpanAttributes', () => {
  it('sets citekeys, source and note index', () => {
    expect(
      citationSpanAttributes(
        cite({ citations: [{ id: 'a' }, { id: 'b' }] }),
        'n.md'
      )
    ).toEqual({ 'data-citekey': 'a|b', 'data-source': 'n.md' });
    expect(
      citationSpanAttributes(cite({ note: 'N', noteIndex: 3 }), 'n.md')
    ).toEqual({
      'data-citekey': 'a',
      'data-source': 'n.md',
      'data-note-index': '3',
    });
  });
});

describe('renderCitationContent', () => {
  it('renders plain val as text', () => {
    const frag = renderCitationContent({ cite: cite({ val: '(A 2000)' }) });
    const span = document.createElement('span');
    span.appendChild(frag);
    expect(span.textContent).toBe('(A 2000)');
  });

  it('parses val containing HTML', () => {
    const frag = renderCitationContent({
      cite: cite({ val: '(A 2000, <em>passim</em>)' }),
    });
    const span = document.createElement('span');
    span.appendChild(frag);
    expect(span.querySelector('em')?.textContent).toBe('passim');
  });

  it('splits a multi-work container per member when counts match', () => {
    const frag = renderCitationContent({
      cite: cite({
        val: '(A 2000; B 1984)',
        citations: [{ id: 'a' }, { id: 'b' }],
      }),
      memberStates: [
        { isWikilink: true, hasLitNote: true },
        { isWikilink: false, hasLitNote: false },
      ],
    });
    const span = document.createElement('span');
    span.appendChild(frag);
    const members = span.querySelectorAll('span.sw-citation-member');
    expect(members.length).toBe(2);
    expect(members[0].classList.contains('is-wikilink')).toBe(true);
    expect(members[1].classList.contains('is-wikilink')).toBe(false);
    expect(span.textContent).toBe('(A 2000; B 1984)');
  });

  it('builds reference entries from HTML strings', () => {
    const frag = renderCitationContent({
      cite: cite({ reference: true, citations: [{ id: 'a' }, { id: 'b' }] }),
      referenceHtml: [
        '<div class="csl-entry">Entry A.</div>',
        '<div class="csl-entry">Entry B.</div>',
      ],
    });
    const span = document.createElement('span');
    span.appendChild(frag);
    const entries = span.querySelectorAll('span.sw-reference-entry');
    expect(entries.length).toBe(2);
    expect(entries[0].querySelector('.csl-entry')?.textContent).toBe('Entry A.');
    expect(entries[1].querySelector('.csl-entry')?.textContent).toBe('Entry B.');
  });

  it('accepts Element entries (reading mode) and marks missing ones unresolved', () => {
    const el = document.createElement('div');
    el.className = 'csl-entry';
    el.textContent = 'Entry A.';
    const frag = renderCitationContent({
      cite: cite({ reference: true, citations: [{ id: 'a' }, { id: 'b' }] }),
      referenceHtml: [el, null],
    });
    const span = document.createElement('span');
    span.appendChild(frag);
    const entries = span.querySelectorAll('span.sw-reference-entry');
    expect(entries[0].querySelector('.csl-entry')?.textContent).toBe('Entry A.');
    expect(entries[1].classList.contains('is-unresolved')).toBe(true);
    expect(entries[1].textContent).toBe('b');
  });

  it('uses raw source text when requested', () => {
    const frag = renderCitationContent({
      cite: cite({ val: '(A 2000)' }),
      sourceText: document.createTextNode('[@a]'),
      useSourceText: true,
    });
    const span = document.createElement('span');
    span.appendChild(frag);
    expect(span.textContent).toBe('[@a]');
  });
});
