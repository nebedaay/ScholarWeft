import { passesCoverage, queryTerms, scoreEntry, spacingConfidence } from '../search-score';

const distinction = {
  citekey: 'bourdieuDistinctionSocial1984',
  title: 'Distinction: A Social Critique of the Judgment of Taste',
  authorText: 'Bourdieu, Pierre',
  abstract: null,
  venueText: null,
};
const other = {
  citekey: 'otherTheory1989',
  title: 'Social Theory and Modern Sociology',
  authorText: 'Giddens, Anthony',
  abstract: null,
  venueText: null,
};
const library = [distinction, other];

describe('spaced terms are the (only) multi-word syntax', () => {
  it('finds the entry for a spaced prefix pair', () => {
    const s = scoreEntry(distinction, 'soc cri', {});
    expect(passesCoverage(s)).toBe(true);
  });

  it('a joined run is NOT interpreted as several words', () => {
    // `soccri` is now just a word nobody has.
    expect(passesCoverage(scoreEntry(distinction, 'soccri', {}))).toBe(false);
  });

  it('ranks a fuller prefix above a shorter one', () => {
    const long = scoreEntry(distinction, 'social cri', {}).value;
    const short = scoreEntry(distinction, 'soc cri', {}).value;
    // More of each word typed is more confidence.
    expect(long).toBeLessThanOrEqual(short);
  });
});

describe('queryTerms', () => {
  it('splits on whitespace and punctuation, keeping hyphens', () => {
    expect(queryTerms('bourdieu social critique')).toEqual(['bourdieu', 'social', 'critique']);
    expect(queryTerms('anti-colonial')).toEqual(['anti-colonial']);
    expect(queryTerms('smith, research; 2005')).toEqual(['smith', 'research', '2005']);
  });
});

describe('spacingConfidence', () => {
  it('trusts the spaced form slightly more than a joined run', () => {
    expect(spacingConfidence('social critique')).toBe(0);
    expect(spacingConfidence('socialcritique')).toBeGreaterThan(0);
  });
});

describe('AND semantics', () => {
  it('requires every term (spaced is narrower, not wider)', () => {
    const one = scoreEntry(distinction, 'social', {});
    const two = scoreEntry(other, 'social bourdieu', {});
    // `other` has "social" but not Bourdieu → not a match.
    expect(passesCoverage(one)).toBe(true);
    expect(passesCoverage(two)).toBe(false);
  });
});
