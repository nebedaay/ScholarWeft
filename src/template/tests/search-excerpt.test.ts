import {
  EXCERPT_WIDTH,
  buildExcerpts,
  excerptForResult,
} from '../search-excerpt';

const ABSTRACT =
  'This essay examines the Maghrebian subject at length and, after a good ' +
  'deal of discussion of unrelated matters, turns finally to social critique ' +
  'in practice and to its limits.';

describe('buildExcerpts()', () => {
  it('needs no excerpt when the text is absent', () => {
    expect(buildExcerpts(null, ['x'])).toEqual([]);
    expect(buildExcerpts('', ['x'])).toEqual([]);
  });

  it('returns nothing when no term is present', () => {
    expect(buildExcerpts(ABSTRACT, ['zebra'])).toEqual([]);
  });

  it('merges terms found CLOSE TOGETHER into one line', () => {
    // The user's spec: if they are close, one line contains both.
    const lines = buildExcerpts(ABSTRACT, ['social', 'critique']);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('social critique');
  });

  it('gives separate lines for terms in DIFFERENT parts', () => {
    const lines = buildExcerpts(ABSTRACT, ['maghrebian', 'critique']);
    expect(lines).toHaveLength(2);
    expect(lines[0].text.toLowerCase()).toContain('maghrebian');
    expect(lines[1].text.toLowerCase()).toContain('critique');
  });

  it('reports EVERY match in the line, for emphasis', () => {
    const [line] = buildExcerpts(ABSTRACT, ['social', 'critique']);
    expect(line.matches.length).toBeGreaterThan(0);
    // Both terms are matched and within one merged line, so BOTH are reported.
    const shown = line.matches.map((m) =>
      line.text.slice(m.start, m.start + m.length).toLowerCase()
    );
    expect(shown).toContain('social');
    expect(shown).toContain('critique');
  });

  it('reports several matches when many terms share a line', () => {
    const text = 'A study of women, authority, Senegal and Islam in practice.';
    const [line] = buildExcerpts(text, ['women', 'authority', 'senegal', 'islam']);
    expect(line.matches).toHaveLength(4);
    const shown = line.matches.map((m) =>
      line.text.slice(m.start, m.start + m.length).toLowerCase()
    );
    expect(shown).toEqual(['women', 'authority', 'senegal', 'islam']);
  });

  it('keeps a line within a sensible width', () => {
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ') + ' target ' + Array.from({ length: 80 }, (_, i) => `z${i}`).join(' ');
    const [line] = buildExcerpts(long, ['target']);
    expect(line.text.length).toBeLessThanOrEqual(EXCERPT_WIDTH + 6); // + ellipses
    expect(line.text).toContain('target');
  });

  it('marks truncation with ellipses', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') + ' target ' + Array.from({ length: 60 }, (_, i) => `z${i}`).join(' ');
    const [line] = buildExcerpts(long, ['target']);
    expect(line.text.startsWith('…')).toBe(true);
    expect(line.text.endsWith('…')).toBe(true);
  });

  it('caps the number of lines', () => {
    const text = ['alpha', 'beta', 'gamma'].map((w) => `${w} ${'filler '.repeat(12)}`).join(' ');
    const lines = buildExcerpts(text, ['alpha', 'beta', 'gamma'], { maxLines: 2 });
    expect(lines).toHaveLength(2);
  });

  it('is diacritic-insensitive', () => {
    expect(buildExcerpts('A study of négritude.', ['negritude'])).toHaveLength(1);
    expect(buildExcerpts('A study of negritude.', ['négritude'])).toHaveLength(1);
  });
});

describe('excerptForResult() — the render decision', () => {
  const item = {
    abstract: 'A long discussion that eventually turns to the Maghrebian subject.',
  };

  it('returns an excerpt for a matched term', () => {
    const e = excerptForResult(item, ['maghrebian']);
    expect(e).not.toBeNull();
    expect(e!.text.toLowerCase()).toContain('maghrebian');
  });

  it('returns null when the tier is not `@@@` (no terms recorded)', () => {
    // `@@` collects no terms, so its results show no excerpt.
    expect(excerptForResult(item, [])).toBeNull();
  });

  it('returns null when the item has no abstract', () => {
    expect(excerptForResult({ abstract: null }, ['maghrebian'])).toBeNull();
    expect(excerptForResult({}, ['maghrebian'])).toBeNull();
  });

  it('returns null when the term is absent from the abstract', () => {
    expect(excerptForResult(item, ['zebra'])).toBeNull();
  });

  it('does not depend on a Fuse `matches` array', () => {
    // The original bug: the excerpt rendered only on the branch that had
    // `matches`, but searchTier results carry none, so it never appeared.
    // This function takes only the ITEM and the terms — nothing else.
    const e = excerptForResult(item, ['maghrebian']);
    expect(e!.matches.length).toBeGreaterThan(0);
  });
});

describe('excerpts use the MATCHED terms, not the raw query', () => {
  const abs =
    'This article examines how women negotiate religious authority within Islam.';

  it('explains a match for an unbroken query via the words that matched', () => {
    // `islamwomenauthority` appears in no abstract; the run SPLITS into words
    // that do. The excerpt must show those, exactly as the search matched them.
    expect(excerptForResult({ abstract: abs }, ['islamwomenauthority'])).toBeNull();
    const e = excerptForResult({ abstract: abs }, ['islam', 'women', 'authority']);
    expect(e).not.toBeNull();
    expect(e!.text.toLowerCase()).toMatch(/women|authority|islam/);
  });

  it('produces a line for each term found apart', () => {
    const long = `${'filler '.repeat(40)} islam ${'filler '.repeat(40)} authority`;
    expect(buildExcerpts(long, ['islam', 'authority'])).toHaveLength(2);
  });
});
