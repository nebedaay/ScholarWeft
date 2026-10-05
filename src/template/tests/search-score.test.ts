import { citekeyMatch, passesCoverage, queryTerms, scoreEntry } from '../search-score';

const items = [
  {
    id: 'distinction',
    title: 'Distinction: A Social Critique of the Judgment of Taste',
    authorText: 'Bourdieu',
  },
  {
    id: 'interventions',
    title: 'Interventions, 1961-2001: Science sociale et action politique',
    authorText: 'Bourdieu',
  },
  { id: 'filler', title: 'Social history of a region', authorText: 'Other' },
];

function probe(query: string) {
  const n = queryTerms(query).length;
  const scored = items.map((i) => ({ i, s: scoreEntry(i, query) }));
  const pass = scored
    .filter((x) => passesCoverage(x.s, n))
    .sort((a, b) => a.s.value - b.s.value);
  console.log('query', JSON.stringify(query));
  for (const x of scored) {
    console.log(
      `   ${x.i.id} value=${x.s.value.toFixed(3)} exact=${x.s.exactPhrase} covered=${x.s.covered}/${x.s.total} passes=${passesCoverage(x.s, n)}`
    );
  }
  console.log('   ORDER:', pass.map((p) => p.i.id).join(' > ') || '(none)');
  return pass;
}

describe('probe', () => {
  it('reports ordering', () => {
    probe('social critique');
    probe('socialcritique');
    probe('bourdieu critique');
    probe('critique');
    expect(true).toBe(true);
  });

  it('ranks the exact phrase first for a spaced query', () => {
    const pass = probe('social critique');
    expect(pass[0].i.id).toBe('distinction');
  });

  it('keeps spaced narrower than single-term (AND, not OR)', () => {
    // "filler" has Social but not Critique, so a spaced query must exclude it,
    // while "social" alone may include it.
    const spaced = probe('social critique').map((p) => p.i.id);
    const single = probe('social').map((p) => p.i.id);
    expect(spaced).not.toContain('filler');
    expect(single).toContain('filler');
  });
});

describe('citekey matches record the interpreted TERMS', () => {
  const item = {
    citekey: 'certeaupracticeeverydaylife1984',
    title: 'The Practice of Everyday Life',
    authorText: 'Certeau',
  };

  it('a citekey PREFIX match records the query as ONE term', () => {
    const s = scoreEntry(item, 'certeaupracticeeveryday');
    expect(s.value).toBeLessThan(0); // the citekey band still wins
    // The joined run is no longer split into words.
    expect(s.matchedTerms).toEqual(['certeaupracticeeveryday']);
  });

  it('a SPACED citekey phrase is still a citekey match', () => {
    const s = scoreEntry(item, 'certeau practice everyday');
    expect(s.value).toBeLessThan(0);
  });

  it('an EXACT citekey match records the query term', () => {
    const s = scoreEntry(item, 'certeaupracticeeverydaylife1984');
    expect(s.matchedTerms).toEqual(['certeaupracticeeverydaylife1984']);
  });
});

describe('citekeyMatch() — literal citekey prefixes', () => {
  const key = 'smithMemory2020';

  it('matches an exact key, ignoring a leading @', () => {
    expect(citekeyMatch(key, 'smithMemory2020')?.exact).toBe(true);
    expect(citekeyMatch(key, '@smithMemory2020')?.exact).toBe(true);
    expect(citekeyMatch(key, 'SMITHMEMORY2020')?.exact).toBe(true);
  });

  it('matches any leading prefix of the key', () => {
    for (const q of ['s', 'smi', 'smithMemory', 'smithMemory202', '@smithMemory202']) {
      expect(citekeyMatch(key, q)).not.toBeNull();
      expect(citekeyMatch(key, q)!.value).toBeLessThan(0); // the citekey band
    }
  });

  it('matches the terms IN ORDER, each as a key substring', () => {
    expect(citekeyMatch('bourdieuDistinctionSocial1984', 'bourdieu dist 1984')).not.toBeNull();
  });

  it('does not match an unrelated key', () => {
    expect(citekeyMatch(key, 'jonesRitual')).toBeNull();
    expect(citekeyMatch(key, 'memorysmith')).toBeNull();
  });
});
