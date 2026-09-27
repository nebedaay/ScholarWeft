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

  it('reports where the match sits, for emphasis', () => {
    const [line] = buildExcerpts(ABSTRACT, ['social', 'critique']);
    expect(line.matchLength).toBeGreaterThan(0);
    const shown = line.text.slice(
      line.matchStart,
      line.matchStart + line.matchLength
    );
    expect(shown.toLowerCase()).toBe('social');
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
    expect(e!.matchLength).toBeGreaterThan(0);
  });
});
