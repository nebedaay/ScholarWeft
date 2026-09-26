import {
  MIN_MATCH_CHARS,
  TIER_THRESHOLD,
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
  it('is tight enough that unrelated long titles do not rank', () => {
    // Fuse matches anything at threshold 1; these must stay well below the
    // 0.4+ values that surfaced "The Social Life of Ghosttowns in Libya".
    for (const tier of ['citekey', 'title', 'abstract'] as const) {
      expect(TIER_THRESHOLD[tier]).toBeLessThan(0.4);
    }
  });

  it('still leaves room for a misspelling', () => {
    // A one-character slip in a short query must remain matchable, so the
    // threshold cannot be so tight that only exact strings pass.
    expect(TIER_THRESHOLD.title).toBeGreaterThanOrEqual(0.2);
  });

  it('does not match single characters', () => {
    expect(MIN_MATCH_CHARS).toBeGreaterThanOrEqual(2);
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
