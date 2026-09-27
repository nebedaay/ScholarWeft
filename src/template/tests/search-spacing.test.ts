import {
  hasCoherentSplit,
  looksLikeAbbreviation,
  passesCoverage,
  prefixChunks,
  queryTerms,
  scoreEntry,
  spacingConfidence,
} from '../search-score';

const distinction = {
  id: 'bourdieuDistinction1984',
  title: 'Distinction: A Social Critique of the Judgment of Taste',
  authorText: 'Bourdieu',
};
const other = {
  id: 'other',
  title: 'Social Theory and Modern Sociology',
  authorText: 'Someone',
};
const library = [distinction, other];

function search(query: string) {
  return library
    .map((e) => ({ e, s: scoreEntry(e, query, { includeAbstract: false }) }))
    .filter((x) => passesCoverage(x.s))
    .sort((a, b) => a.s.value - b.s.value)
    .map((x) => x.e.id);
}

describe('spaced vs concatenated are interpreted the same', () => {
  it('returns the same set and order for both forms', () => {
    // `other` matches only "social", so an AND over three words excludes it —
    // and BOTH forms must agree on that.
    const spaced = search('bourdieu social critique');
    const joined = search('bourdieusocialcritique');
    expect(spaced).toEqual(joined);
    expect(spaced).toEqual(['bourdieuDistinction1984']);
  });

  it('accepts an item matching a subset when the query is a single term', () => {
    // Sanity check that the AND above is doing work: one word keeps `other`.
    expect(search('social')).toContain('other');
  });

  it('weights the spaced form marginally more (a tiebreak, not a reorder)', () => {
    const spaced = scoreEntry(distinction, 'bourdieu social critique');
    const joined = scoreEntry(distinction, 'bourdieusocialcritique');
    expect(spaced.value).toBeLessThan(joined.value);
    // Small on purpose: it must not reorder genuinely different matches.
    expect(joined.value - spaced.value).toBeLessThan(0.05);
  });

  it('reports the spacing confidence difference', () => {
    expect(spacingConfidence('bourdieu social critique')).toBe(0);
    expect(spacingConfidence('bourdieusocialcritique')).toBeGreaterThan(0);
  });
});

describe('looksLikeAbbreviation()', () => {
  it('accepts an unbroken run of letters', () => {
    expect(looksLikeAbbreviation('soccri')).toBe(true);
    expect(looksLikeAbbreviation('socthe')).toBe(true);
  });

  it('rejects a spaced query (that is words, not fragments)', () => {
    expect(looksLikeAbbreviation('bourdieu social critique')).toBe(false);
    expect(looksLikeAbbreviation('social critique')).toBe(false);
  });
});

describe('prefix chunks vs coherent words', () => {
  it('never chunk-matches a spaced query of real words', () => {
    // A spaced query is an explicit statement of word boundaries, so it must
    // not be reinterpreted as bour+dieu+soc+ial+... fragments.
    const spaced = scoreEntry(distinction, 'social critique');
    expect(spaced.prefixChunks).toBe(false);
  });

  it('does chunk-match an unbroken abbreviation', () => {
    const joined = scoreEntry(
      { title: distinction.title, authorText: 'Other' },
      'soccri'
    );
    expect(joined.prefixChunks).toBe(true);
  });

  it('still rejects interior fragments in the unbroken form', () => {
    expect(prefixChunks(distinction.title, 'ocique').full).toBe(false);
  });
});

describe('spaced prefix fragments (soc cri)', () => {
  it('matches word prefixes across separate terms, without chunk matching', () => {
    // A space means two words, so `soc` + `cri` is read as prefixes of two
    // words in the title — no abbreviation alignment needed.
    const s = scoreEntry(distinction, 'soc cri');
    expect(s.covered).toBe(2);
    expect(s.prefixChunks).toBe(false);
    expect(passesCoverage(s)).toBe(true);
  });

  it('rejects an item matching only one of the two prefixes', () => {
    const s = scoreEntry(other, 'soc cri');
    expect(passesCoverage(s)).toBe(false);
  });

  it('ranks longer prefixes above shorter ones and above an unbroken run', () => {
    // More of each word typed = more confidence: social cri > soccri > soc cri.
    const long = scoreEntry(distinction, 'social cri').value;
    const joined = scoreEntry(distinction, 'soccri').value;
    const short = scoreEntry(distinction, 'soc cri').value;
    expect(long).toBeLessThan(joined);
    expect(joined).toBeLessThan(short);
  });

  it('treats both fragment forms as finding the same item', () => {
    expect(passesCoverage(scoreEntry(distinction, 'soc cri'))).toBe(true);
    expect(passesCoverage(scoreEntry(distinction, 'soccri'))).toBe(true);
  });
});

describe('coherent splits beat chunk interpretations', () => {
  const soccer = {
    title: 'Soccer Is Almost Crying In Time Of Questioning',
    authorText: 'X',
  };

  it('does NOT chunk-match a run that splits into real words', () => {
    // `socialcritique` = social + critique, so it must never be read as
    // "Soc|cer is| cri|ing in| ti|me of| que|stioning".
    const s = scoreEntry(soccer, 'socialcritique');
    expect(s.prefixChunks).toBe(false);
    expect(passesCoverage(s)).toBe(false);
  });

  it('still chunk-matches a run with no coherent split', () => {
    // `soccri` has no whole-word reading anywhere, so abbreviation is the
    // only interpretation available.
    const s = scoreEntry(distinction, 'soccri');
    expect(s.prefixChunks).toBe(true);
  });

  it('returns the words of a coherent split, or null', () => {
    expect(
      hasCoherentSplit(
        'Distinction: A Social Critique of the Judgment of Taste',
        'socialcritique'
      )
    ).toEqual(['social', 'critique']);
    expect(hasCoherentSplit('Distinction: A Social Critique', 'soccri')).toBeNull();
  });
});
