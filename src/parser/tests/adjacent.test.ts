import { getCitationSegments, getCitations } from '../parser';

/** Citekeys per group, in order. */
const cites = (text: string): string[][] =>
  getCitationSegments(text, false, true).map((g) =>
    getCitations(g).citations.map((c) => c.id)
  );

describe('contiguous citations merge into one compound citation', () => {
  it('merges whitespace-separated bracket citations (linked and pandoc)', () => {
    expect(cites('[[@a]] [[@b]]')).toEqual([['a', 'b']]);
    expect(cites('[[@a]]\t[[@b]]')).toEqual([['a', 'b']]);
    expect(cites('[@a] [@b]')).toEqual([['a', 'b']]);
    expect(cites('[[@a]] [@b]')).toEqual([['a', 'b']]);
  });

  it('merges across a single newline (soft wrap)', () => {
    expect(cites('[[@a]]\n[[@b]]')).toEqual([['a', 'b']]);
  });

  it('merges three or more adjacent citations', () => {
    expect(cites('[[@a]] [[@b]] [[@c]]')).toEqual([['a', 'b', 'c']]);
  });

  it('does NOT merge across a blank line or with text between', () => {
    expect(cites('[[@a]]\n\n[[@b]]')).toEqual([['a'], ['b']]);
    expect(cites('[[@a]] and [[@b]]')).toEqual([['a'], ['b']]);
    expect(cites('[[@a]], [[@b]]')).toEqual([['a'], ['b']]);
  });

  it('does not merge when a bare narrative citation is adjacent', () => {
    expect(cites('[[@a]] @b')).toEqual([['a'], ['b']]);
  });

  it('keeps a LEADING linked narrative, merging the rest (pandoc @a [b])', () => {
    // A narrative first member makes the run narrative; `A 2000 (B 1984)`.
    expect(cites('[[@a|@ -]] [[@b]]')).toEqual([['a', 'b']]);
  });

  it('ignores a NON-leading linked narrative (the @ - is dropped)', () => {
    // "a narrative stuck between citations is a mistake" — merge as ordinary.
    expect(cites('[[@a]] [[@b|@ -]]')).toEqual([['a', 'b']]);
    expect(cites('[[@a]] [[@b|@ -]] [[@c]]')).toEqual([['a', 'b', 'c']]);
  });

  it('merges a reference insertion into a contiguous reference list', () => {
    // Any `reference` member makes the whole run a reference list (values are
    // keys; the reference flag is asserted in reference.test.ts).
    expect(cites('[[@a]] [[@b|reference]]')).toEqual([['a', 'b']]);
  });

  it('leaves the explicit container unchanged', () => {
    expect(cites('[ [[@a]] [[@b]] ]')).toEqual([['a', 'b']]);
  });
});
