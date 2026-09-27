import {
  TIER_IGNORE_LOCATION,
  MIN_MATCH_CHARS,
  TIER_THRESHOLD,
  queryTerms,
  rerankKey,
  tierWeights,
} from '../search-tier';

describe('tierWeights()', () => {
  it('ranks abstract BELOW title and creators wherever it is searched', () => {
    for (const tier of ['citekey', 'title', 'abstract'] as const) {
      const w = tierWeights(tier);
      // Abstract is either not searched at all, or strictly the weakest signal.
      if (w.abstract > 0) {
        expect(w.abstract).toBeLessThan(w.title);
        expect(w.abstract).toBeLessThan(w.creators);
      } else {
        expect(w.abstract).toBe(0);
      }
    }
  });

  it('@ is citekey-dominant, @@ is title-dominant', () => {
    expect(tierWeights('citekey').citekey).toBeGreaterThan(
      tierWeights('citekey').title
    );
    expect(tierWeights('title').title).toBeGreaterThan(
      tierWeights('title').citekey
    );
  });

  it('only the @@@ tier searches the abstract at all', () => {
    expect(tierWeights('citekey').abstract).toBe(0);
    expect(tierWeights('title').abstract).toBe(0);
    expect(tierWeights('abstract').abstract).toBeGreaterThan(0);
  });
});

describe('thresholds', () => {
  it('keeps the TITLE tiers tight so unrelated long titles do not rank', () => {
    // Fuse matches anything at threshold 1; these must stay well below the
    // 0.4+ values that surfaced "The Social Life of Ghosttowns in Libya".
    expect(TIER_THRESHOLD.citekey).toBeLessThan(0.4);
    expect(TIER_THRESHOLD.title).toBeLessThan(0.4);
  });

  it('gives the ABSTRACT tier a loose threshold', () => {
    // Fuse length-normalises its score, so a real term buried in a long
    // abstract scores 0.65-0.9. A tight threshold silently drops every
    // abstract hit — the bug where "maghrebian" never found a work whose
    // abstract contains it.
    expect(TIER_THRESHOLD.abstract).toBeGreaterThan(0.6);
  });

  it('still leaves room for a misspelling', () => {
    expect(TIER_THRESHOLD.title).toBeGreaterThanOrEqual(0.2);
  });

  it('ignores match location wherever long free text is searched', () => {
    // Without ignoreLocation, Fuse's default location:0 penalises a match for
    // sitting late in a field — a length artefact, not a relevance signal.
    expect(TIER_IGNORE_LOCATION.abstract).toBe(true);
    expect(TIER_IGNORE_LOCATION.title).toBe(true);
  });

  it('does not match single characters', () => {
    expect(MIN_MATCH_CHARS).toBeGreaterThanOrEqual(2);
  });
});

describe('queryTerms()', () => {
  it('splits on whitespace', () => {
    expect(queryTerms('bourdieu critique')).toEqual(['bourdieu', 'critique']);
  });

  it('collapses extra whitespace and drops punctuation', () => {
    expect(queryTerms('  bourdieu   critique  ')).toEqual(['bourdieu', 'critique']);
    expect(queryTerms('khatibi, identity')).toEqual(['khatibi', 'identity']);
  });

  it('keeps accents and internal punctuation-free words intact', () => {
    expect(queryTerms('Müller')).toEqual(['Müller']);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(queryTerms('')).toEqual([]);
    expect(queryTerms('   ')).toEqual([]);
  });
});

describe('rerankKey()', () => {
  const base = 0.3;

  it('promotes a contiguous title match over a scattered one', () => {
    const contiguous = rerankKey(
      { title: 'French History', fuseScore: base },
      'French History'
    );
    const scattered = rerankKey(
      { title: 'History of Agriculture in France', fuseScore: base },
      'French History'
    );
    expect(contiguous).toBeLessThan(scattered);
  });

  it('demotes a hit that matched nothing contiguously (the fuzzy case)', () => {
    // This is the "Slightly" → "The Social Life of Ghosttowns in Libya" shape:
    // it reached the results on fuzziness alone.
    const fuzzy = rerankKey(
      { title: 'The Social Life of Ghosttowns in Libya', fuseScore: base },
      'Slightly'
    );
    const real = rerankKey(
      { title: 'Slightly Out of Focus', fuseScore: base },
      'Slightly'
    );
    expect(real).toBeLessThan(fuzzy);
  });

  it('ranks a title match above an abstract-only match', () => {
    const inTitle = rerankKey({ title: 'French History', fuseScore: base }, 'French History');
    const inAbstract = rerankKey(
      { title: 'Something Else Entirely', abstract: 'a study of French history', fuseScore: base },
      'French History'
    );
    expect(inTitle).toBeLessThan(inAbstract);
  });

  it('ranks a title match above an author-only match', () => {
    const inTitle = rerankKey({ title: 'French History', fuseScore: base }, 'French History');
    const inAuthor = rerankKey(
      { title: 'Something Else', authorText: 'French History', fuseScore: base },
      'French History'
    );
    expect(inTitle).toBeLessThan(inAuthor);
  });

  it('is case- and diacritic-insensitive', () => {
    const plain = rerankKey({ title: 'French History', fuseScore: base }, 'french history');
    const accent = rerankKey(
      { title: 'Frénch History', fuseScore: base },
      'French History',
      (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
    expect(plain).toBeLessThan(base + 1);
    expect(accent).toBeLessThan(base + 1);
  });

  it('leaves the order alone for an empty query', () => {
    const a = rerankKey({ title: 'A', fuseScore: 0.1 }, '');
    const b = rerankKey({ title: 'B', fuseScore: 0.2 }, '');
    expect(a).toBe(0.1);
    expect(b).toBe(0.2);
  });

  it('refines Fuse order without inverting it wholesale', () => {
    // A clearly better Fuse score can still win when both match the title, so
    // the nudge stays a nudge rather than a full rescoring.
    const better = rerankKey({ title: 'French History', fuseScore: 0.05 }, 'French History');
    const worse = rerankKey({ title: 'French History', fuseScore: 0.35 }, 'French History');
    expect(better).toBeLessThan(worse);
  });
});
