import { interpretationsFor, isSearchableQuery, queryShape } from '../search-interpret';

/**
 * After chunked search was removed, a query means exactly its own terms.
 * `interpretationsFor` reports that one reading; the point of keeping the
 * function is that the scorer and its callers agree on what is being searched.
 */
describe('queryShape()', () => {
  it('reports the terms, whether spaced or not', () => {
    expect(queryShape('bourdieu social critique').words).toEqual([
      'bourdieu',
      'social',
      'critique',
    ]);
    expect(queryShape('bourdieucritique').words).toEqual(['bourdieucritique']);
  });

  it('separates quoted runs from their neighbours', () => {
    expect(queryShape('"anticolon" Africa').words).toEqual(['anticolon', 'Africa']);
  });
});

describe('interpretationsFor()', () => {
  it('offers exactly the query terms, once', () => {
    const e = { title: 'A Social Critique', authorText: 'Bourdieu' };
    const interps = interpretationsFor(e, 'social critique', {});
    expect(interps).toHaveLength(1);
    expect(interps[0].terms).toEqual(['social', 'critique']);
    expect(interps[0].kind).toBe('words');
  });

  it('does NOT split an unspaced run into words any more', () => {
    const e = { title: 'A Social Critique', authorText: 'Bourdieu' };
    const interps = interpretationsFor(e, 'socialcritique', {});
    expect(interps).toHaveLength(1);
    expect(interps[0].terms).toEqual(['socialcritique']);
  });

  it('returns nothing for an empty query', () => {
    expect(interpretationsFor({ title: 'X' }, '   ', {})).toEqual([]);
  });
});

describe('isSearchableQuery()', () => {
  it('accepts any query with a term', () => {
    expect(isSearchableQuery('a')).toBe(true);
    expect(isSearchableQuery('social critique')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(isSearchableQuery('')).toBe(false);
    expect(isSearchableQuery('   ')).toBe(false);
  });
});
