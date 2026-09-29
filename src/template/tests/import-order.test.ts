import { sortImportEntries, type SortableEntry } from '../import-order';

const e = (
  id: string,
  o: Partial<SortableEntry> = {}
): SortableEntry => ({ id, ...o });

const ids = (list: SortableEntry[]) => list.map((x) => x.id);

const authors = [
  e('c', { author: [{ family: 'Curie' }], title: 'C', issued: { 'date-parts': [[1990]] } }),
  e('a', { author: [{ family: 'Austen' }], title: 'A', issued: { 'date-parts': [[1813]] } }),
  e('b', { author: [{ family: 'Bourdieu' }], title: 'B', issued: { 'date-parts': [[1984]] } }),
];

describe('sortImportEntries()', () => {
  it('relevance keeps the input order untouched', () => {
    expect(ids(sortImportEntries(authors, 'relevance'))).toEqual(['c', 'a', 'b']);
  });

  it('author sorts family A→Z (ascending)', () => {
    expect(ids(sortImportEntries(authors, 'author', 'asc'))).toEqual(['a', 'b', 'c']);
  });

  it('author descending reverses the order', () => {
    expect(ids(sortImportEntries(authors, 'author', 'desc'))).toEqual(['c', 'b', 'a']);
  });

  it('author breaks ties by title, then year, then date added', () => {
    const list = [
      e('z', { author: [{ family: 'Smith' }], title: 'Zeta', issued: { 'date-parts': [[2001]] } }),
      e('y1', { author: [{ family: 'Smith' }], title: 'Alpha', issued: { 'date-parts': [[2000]] } }),
      e('y0', { author: [{ family: 'Smith' }], title: 'Alpha', issued: { 'date-parts': [[1990]] } }),
    ];
    expect(ids(sortImportEntries(list, 'author', 'asc'))).toEqual(['y0', 'y1', 'z']);
  });

  it('a corporate (literal) creator sorts by its name', () => {
    const list = [
      e('x', { author: [{ family: 'Zed' }] }),
      e('w', { author: [{ literal: 'ACME Corp' }] }),
    ];
    expect(ids(sortImportEntries(list, 'author', 'asc'))).toEqual(['w', 'x']);
  });

  it('sorts a case by its court when it has no creator', () => {
    const list = [
      e('zed', { author: [{ family: 'Zed' }] }),
      e('beta', { title: 'Beta v. State', authority: 'Beta Court' }),
      e('alpha', { title: 'Alpha v. State', authority: 'Alpha Court' }),
    ];
    expect(ids(sortImportEntries(list, 'author', 'asc'))).toEqual([
      'alpha',
      'beta',
      'zed',
    ]);
  });

  it('date added sorts oldest→newest ascending, newest first descending', () => {
    const list = [
      e('old', { _dateAdded: '2020-01-01T00:00:00Z' }),
      e('new', { _dateAdded: '2024-06-01T00:00:00Z' }),
      e('mid', { _dateAdded: '2022-03-01T00:00:00Z' }),
    ];
    expect(ids(sortImportEntries(list, 'dateAdded', 'asc'))).toEqual(['old', 'mid', 'new']);
    expect(ids(sortImportEntries(list, 'dateAdded', 'desc'))).toEqual(['new', 'mid', 'old']);
  });

  it('puts entries with no author AND no title last, in either direction', () => {
    const list = [
      e('stub', {}),
      e('real', { author: [{ family: 'Zed' }], title: 'Z' }),
      e('titled', { title: 'A' }),
    ];
    expect(ids(sortImportEntries(list, 'author', 'asc'))).toEqual([
      'titled',
      'real',
      'stub',
    ]);
    expect(ids(sortImportEntries(list, 'author', 'desc'))).toEqual([
      'real',
      'titled',
      'stub',
    ]);
  });

  it('puts entries with no date added last', () => {
    const list = [
      e('nodate', { author: [{ family: 'A' }], title: 'A' }),
      e('dated', { _dateAdded: '2024-01-01T00:00:00Z' }),
    ];
    expect(ids(sortImportEntries(list, 'dateAdded', 'asc'))).toEqual(['dated', 'nodate']);
    expect(ids(sortImportEntries(list, 'dateAdded', 'desc'))).toEqual(['dated', 'nodate']);
  });

  it('does not mutate the input array', () => {
    const input = authors.slice();
    sortImportEntries(input, 'author', 'asc');
    expect(ids(input)).toEqual(['c', 'a', 'b']);
  });
});
