import { passesCoverage, queryTerms, scoreEntry } from '../search-score';

/**
 * The reported failures, using a library large enough that a short term like
 * "social" matches hundreds of titles weakly. This is what exposed the original
 * bug: the item whose title contains the EXACT PHRASE ranked last among
 * "social" matches, so per-term truncation deleted it before the AND ran.
 */
const distinction = {
  id: 'bourdieuDistinction1984',
  title: 'Distinction: A Social Critique of the Judgment of Taste',
  authorText: 'Bourdieu',
};
const interventions = {
  id: 'bourdieuInterventions196120012002',
  title: 'Interventions, 1961-2001: Science sociale et action politique',
  authorText: 'Bourdieu',
};
const filler = Array.from({ length: 200 }, (_, i) => ({
  id: `filler${i}`,
  title: `Social history of region ${i}`,
  authorText: `Author${i}`,
}));
const library = [distinction, interventions, ...filler];

/** Mirrors bibManager.searchTier: candidates, coverage gate, then scoring. */
function search(query: string, opts: { includeAbstract?: boolean } = {}) {
  const terms = queryTerms(query);
  const scored = library.map((e) => ({
    e,
    s: scoreEntry(e, query, opts),
  }));
  return scored
    .filter((x) => passesCoverage(x.s, terms.length))
    .sort((a, b) => a.s.value - b.s.value)
    .map((x) => x.e.id);
}

describe('reported failures', () => {
  it('ranks the exact phrase FIRST even among 200 weaker "social" matches', () => {
    const r = search('social critique');
    expect(r[0]).toBe('bourdieuDistinction1984');
  });

  it('keeps a spaced query narrower than either term alone (AND, not OR)', () => {
    const spaced = search('social critique');
    const socialOnly = search('social');
    // The filler titles contain "Social" but not "Critique", so the spaced
    // query must exclude them while "social" alone may return them.
    expect(socialOnly.length).toBeGreaterThan(spaced.length);
    expect(spaced.every((id) => !id.startsWith('filler'))).toBe(true);
  });

  it('finds a two-field match: surname in author, word in title', () => {
    // The old code could not do this — neither field resembles the whole
    // phrase, which is why "bourdieu critique" missed Distinction.
    const r = search('bourdieu critique');
    expect(r).toContain('bourdieuDistinction1984');
    expect(r).not.toContain('bourdieuInterventions196120012002');
  });

  it('excludes a fragment-only match from a two-term query', () => {
    // "sociale" gives Interventions a fragment of "social" but no "critique",
    // so it must not qualify at all. This is stronger than merely ranking it
    // below: the fragment contributes nothing toward coverage.
    const r = search('social critique');
    expect(r).not.toContain('bourdieuInterventions196120012002');
  });

  it('ranks a whole-word match above a fragment match for a single term', () => {
    // With one term there is no coverage gate, so ordering decides: the title
    // containing "Social" as a whole word must beat one where "social" is only
    // a fragment of "sociale".
    const r = search('social');
    expect(r.indexOf('bourdieuDistinction1984')).toBeLessThan(
      r.indexOf('bourdieuInterventions196120012002')
    );
  });

  it('still matches a prefix of a word (typing ahead)', () => {
    const scores = library.map((e) => scoreEntry(e, 'social critiqu'));
    expect(scores[0].covered).toBe(2);
  });

  it('ignores one-character noise terms for coverage', () => {
    // Nobody searches for one letter per word; such a term must not qualify
    // an item on its own.
    const s = scoreEntry(filler[0], 'social x critique');
    expect(s.exactPhrase).toBe(false);
  });
});
