jest.mock(
  'obsidian',
  () => ({
    Notice: class {},
    TFile: class {},
  }),
  { virtual: true }
);

import { rewriteLinkedToPandoc } from '../linkedToPandoc';

const r = (s: string) => rewriteLinkedToPandoc(s).out;

describe('rewriteLinkedToPandoc()', () => {
  it('converts a single linked citation', () => {
    expect(r('See [[@smith2020]].')).toBe('See [@smith2020].');
  });

  it('converts the narrative form to a bare @key', () => {
    expect(r('[[@key|@ -]] argues')).toBe('@key argues');
  });

  it('keeps prefix / suffix and suppress-author forms', () => {
    expect(r('[[@key|see @, p. 6]]')).toBe('[see @key, p. 6]');
    expect(r('[[@key|-@, p. 6]]')).toBe('[-@key, p. 6]');
  });

  it('converts a container to ONE compound citation', () => {
    expect(r('[ [[@a]]; [[@b]] ]')).toBe('[@a; @b]');
  });

  describe('contiguous citations (no container)', () => {
    it('becomes ONE bracketed compound, not several', () => {
      expect(r('[[@a]] [[@b]]')).toBe('[@a; @b]');
    });

    it('does not leave the first citation as a link', () => {
      const out = r('x [[@a]] [[@b]] y');
      expect(out).toBe('x [@a; @b] y');
      expect(out).not.toContain('[[');
    });

    it('handles three members', () => {
      expect(r('[[@a]] [[@b]] [[@c]]')).toBe('[@a; @b; @c]');
    });

    it('merges across a single newline (a soft wrap)', () => {
      expect(r('[[@a]]\n[[@b]]')).toBe('[@a; @b]');
    });

    it('carries per-member suffixes into the compound', () => {
      expect(r('[[@a|@, p. 3]] [[@b]]')).toBe('[@a, p. 3; @b]');
    });

    it('does NOT merge a narrative citation into the brackets', () => {
      // `[[@a|@ -]]` becomes a bare `@a`, which is not a bracket — so it stays
      // outside the compound, exactly as pandoc requires.
      expect(r('[[@a|@ -]] [[@b]]')).toBe('@a [@b]');
    });
  });

  it('leaves full-reference insertions untouched', () => {
    expect(r('[[@a|reference]]')).toBe('[[@a|reference]]');
    expect(r('[[@a|ref]]')).toBe('[[@a|ref]]');
    // A reference insertion next to an ordinary citation: the first is left,
    // the second still converts (they are separate citations).
    expect(r('[[@a|ref]] [[@b]]')).toBe('[[@a|ref]] [@b]');
  });

  it('ignores links inside code', () => {
    expect(r('`[[@a]]`')).toBe('`[[@a]]`');
    expect(r('```\n[[@a]]\n```')).toBe('```\n[[@a]]\n```');
  });

  it('reports no change when there is nothing to convert', () => {
    expect(rewriteLinkedToPandoc('plain text').changed).toBe(false);
    expect(rewriteLinkedToPandoc('[@a]').changed).toBe(false);
  });

  it('agrees with the export converter (one shared pipeline)', () => {
    // Both paths run `convertLinksToPandoc`; a note that is reverted and then
    // exported must produce the same pandoc text.
    const { convertCitationsInText } = require('../convertCitations');
    for (const src of [
      '[[@a]] [[@b]]',
      '[ [[@a]]; [[@b]] ]',
      '[[@a]] [[@b]] [[@c]]',
      'See [[@smith2020]].',
      '[[@key|@ -]] argues',
      '[[@key|see @, p. 6]]',
      '[[@a|@, p. 3]] [[@b]]',
    ]) {
      expect(rewriteLinkedToPandoc(src).out).toBe(convertCitationsInText(src));
    }
  });
});
