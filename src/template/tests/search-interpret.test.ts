import { interpretationsFor, isSearchableQuery, queryShape } from '../search-interpret';
import { passesCoverage, scoreEntry } from '../search-score';

/**
 * The invariant this module exists to guarantee: spaced and unspaced forms of
 * the same query go through ONE pipeline, so they search the same interpretation
 * space and return the same result SET (ranked slightly differently).
 *
 * Previously the spaced form searched per-term while the unspaced form searched
 * nothing interpretable, so the two returned systematically different sets.
 */
const items: Record<string, { title: string; authorText: string }> = {
  distinction: {
    title: 'Distinction: A Social Critique of the Judgment of Taste',
    authorText: 'Bourdieu',
  },
  interventions: {
    title: 'Interventions, 1961-2001: Science sociale et action politique',
    authorText: 'Bourdieu',
  },
  crises: { title: 'Social Crises In Ancient Times', authorText: 'Someone' },
  soccer: {
    title: 'Soccer Is Almost Crying In Time Of Questioning',
    authorText: 'X',
  },
};

/** Mirrors bibManager.searchTier's merge: best interpretation wins. */
function search(query: string): Array<{ id: string; value: number }> {
  const out: Array<{ id: string; value: number }> = [];
  for (const [id, entry] of Object.entries(items)) {
    let best = Number.POSITIVE_INFINITY;
    for (const interp of interpretationsFor(entry, query)) {
      const s = scoreEntry(entry, interp.terms.join(' '));
      if (passesCoverage(s)) best = Math.min(best, s.value + interp.penalty);
    }
    if (Number.isFinite(best)) out.push({ id, value: best });
  }
  return out.sort((a, b) => a.value - b.value);
}

describe('queryShape()', () => {
  it('splits on whitespace and joins for the run', () => {
    expect(queryShape('bourdieu critique')).toEqual({
      words: ['bourdieu', 'critique'],
      spaced: true,
      run: 'bourdieucritique',
    });
    expect(queryShape('bourdieucritique')).toEqual({
      words: ['bourdieucritique'],
      spaced: false,
      run: 'bourdieucritique',
    });
  });
});

describe('interpretationsFor()', () => {
  it('gives a spaced query its words', () => {
    const i = interpretationsFor(items.distinction, 'bourdieu critique');
    expect(i[0].kind).toBe('words');
    expect(i[0].terms).toEqual(['bourdieu', 'critique']);
  });

  it('splits an unspaced run into the same words', () => {
    const i = interpretationsFor(items.distinction, 'bourdieucritique');
    const split = i.find((x) => x.kind === 'split');
    expect(split?.terms).toEqual(['bourdieu', 'critique']);
  });

  it('does not split a run whose words are not in the entry', () => {
    const i = interpretationsFor(items.crises, 'bourdieucritique');
    expect(i.some((x) => x.kind === 'split')).toBe(false);
  });

  it('uses chunks only when no coherent split exists', () => {
    const chunked = interpretationsFor(
      { title: 'Distinction: A Social Critique of the Judgment of Taste', authorText: '' },
      'soccri'
    );
    expect(chunked.some((x) => x.kind === 'chunks')).toBe(true);
  });

  it('never chunk-reads a coherent run (the soccer case)', () => {
    const i = interpretationsFor(items.soccer, 'socialcritique');
    expect(i.some((x) => x.kind === 'chunks')).toBe(false);
  });

  it('returns an empty list for an empty query', () => {
    expect(interpretationsFor(items.distinction, '   ')).toEqual([]);
  });
});

describe('spaced and unspaced search the same space', () => {
  it('returns the same result SET for both forms', () => {
    const spaced = search('bourdieu critique').map((r) => r.id);
    const joined = search('bourdieucritique').map((r) => r.id);
    expect(joined).toEqual(spaced);
    expect(spaced).toEqual(['distinction']);
  });

  it('ranks them only slightly differently', () => {
    const spaced = search('bourdieu critique')[0].value;
    const joined = search('bourdieucritique')[0].value;
    expect(Math.abs(spaced - joined)).toBeLessThan(0.1);
  });

  it('considers every entry under both forms (no candidate divergence)', () => {
    // The old bug: the joined form rejected entries before evaluating them.
    for (const q of ['bourdieu critique', 'bourdieucritique']) {
      for (const entry of Object.values(items)) {
        expect(interpretationsFor(entry, q).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('isSearchableQuery()', () => {
  it('accepts words and runs of usable length', () => {
    expect(isSearchableQuery('social')).toBe(true);
    expect(isSearchableQuery('soc cri')).toBe(true);
    expect(isSearchableQuery('soccri')).toBe(true);
  });

  it('rejects empty and too-short input', () => {
    expect(isSearchableQuery('')).toBe(false);
    expect(isSearchableQuery('  ')).toBe(false);
    expect(isSearchableQuery('so')).toBe(false);
  });
});

describe('the space rules out combining across the boundary', () => {
  it('lets an UNSPACED run span two entry words', () => {
    // `bourdieucritique` may combine "Bour" + "Dieucritique" — a combination
    // spanning what would have been two separate terms.
    const t = { title: 'Bour Dieucritique Studies', authorText: '' };
    const i = interpretationsFor(t, 'bourdieucritique');
    expect(i.some((x) => x.kind === 'split' && x.terms.join(' ') === 'bour dieucritique')).toBe(
      true
    );
  });

  it('does NOT let a spaced query span the same boundary', () => {
    // `bour dieucritique` requires those exact two terms to exist.
    const t = { title: 'Bour Dieucritique Studies', authorText: '' };
    const i = interpretationsFor(t, 'bour dieucritique');
    expect(i).toHaveLength(1);
    expect(i[0].kind).toBe('words');
    expect(i[0].terms).toEqual(['bour', 'dieucritique']);
  });

  it('offers chunking when the run splits into MULTIPLE word prefixes', () => {
    // `soccri` → "Soc" + "Cri": distinct from searching it as one word, so the
    // chunk reading is added. A single-chunk reading is the same as `words` and
    // is de-duplicated away.
    const t = { title: 'Social Critique In Question', authorText: '' };
    const i = interpretationsFor(t, 'soccri');
    expect(i.some((x) => x.kind === 'chunks')).toBe(true);
  });
});
