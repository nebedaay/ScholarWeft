/**
 * Parity harness: for a citation source string, the citations produced by
 * LIVE PREVIEW (parse the raw source directly) must equal those produced by
 * READING MODE (serialize the rendered DOM back to source, then parse). Both
 * modes share `getCitationSegments`, so this locks that the DOM round-trip does
 * not change the parse for any of the shapes we have fixed.
 */
import { domToCitationSource } from '../citationSource';
import { getCitationSegments, getCitations } from '../parser/parser';

/** Parse as live preview does: straight from the source text. */
function live(src: string) {
  return getCitationSegments(src, false, true).map((g) => getCitations(g).citations);
}

/** Parse as reading mode does: build the rendered DOM, serialize it, parse. */
function reading(html: string) {
  const p = document.createElement('p');
  p.innerHTML = html;
  const { text } = domToCitationSource(p);
  return {
    text,
    citations: getCitationSegments(text, false, true).map(
      (g) => getCitations(g).citations
    ),
  };
}

const anchor = (key: string, alias: string) =>
  `<a class="internal-link" data-href="@${key}" href="@${key}">${alias}</a>`;

describe('live preview ↔ reading mode citation parity', () => {
  const cases: [string, string][] = [
    // Narrative flag, no locator.
    ['[[@a|@ -]]', anchor('a', '@ -')],
    // Narrative + combined volume:page range (the reported bug).
    ['[[@a|@, vol. 2, p. 41–43 -]]', anchor('a', '@, vol. 2, p. 41–43 -')],
    // Linked forced-locator with braces + narrative.
    ['[[@a|@{, vol. 2, p. 41–43} -]]', anchor('a', '@{, vol. 2, p. 41–43} -')],
    ['[[@a|@{vol. 2, p. 41–43} -]]', anchor('a', '@{vol. 2, p. 41–43} -')],
    // Plain (non-linked) narrative + colon-combined locator.
    ['[@a, 2:41–43 -]', '[@a, 2:41–43 -]'],
    // Plain bracketed locator.
    ['[@a, p. 5]', '[@a, p. 5]'],
    // Suppressed author.
    ['[[@a|-@, p. 6]]', anchor('a', '-@, p. 6')],
    // Contiguous reference run.
    [
      '[[@a|ref]] [[@b]]',
      `${anchor('a', 'ref')} ${anchor('b', '@b')}`,
    ],
    // Multi-work container.
    [
      '[ [[@a]]; [[@b, p. 5]] ]',
      `[ ${anchor('a', '@a')}; ${anchor('b', '@b, p. 5')} ]`,
    ],
    // `@author [bracket]` author-in-text.
    ['@a [@b, p. 5]', '@a [@b, p. 5]'],
  ];

  for (const [src, html] of cases) {
    it(`${src}`, () => {
      const l = live(src);
      const r = reading(html);
      expect(r.citations).toEqual(l);
    });
  }
});
