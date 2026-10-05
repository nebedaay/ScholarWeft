import {
  insertsNoteOnInsertion,
  linkedCitekeysIn,
  sweepsNoteOnResolve,
} from '../missing-notes';

describe('linkedCitekeysIn', () => {
  it('finds bare and aliased linked citations, de-duplicated, in order', () => {
    const text =
      'See [[@smith2020]] and [[@jones1999|Jones, p. 5]], plus [[@smith2020]] again.';
    expect(linkedCitekeysIn(text)).toEqual(['smith2020', 'jones1999']);
  });

  it('ignores plain and bare citations', () => {
    expect(linkedCitekeysIn('see [@smith2020] and @jones1999')).toEqual([]);
  });

  it('excludes derived-file links (a space after the key)', () => {
    expect(linkedCitekeysIn('[[@smith2020 - transcription]]')).toEqual([]);
    expect(linkedCitekeysIn('[[@smith2020]] [[@smith2020 - translation]]')).toEqual([
      'smith2020',
    ]);
  });
});

describe('missing-linked-note predicates', () => {
  it('inserts on insertion for `all` and `onInsert`, not `never`', () => {
    expect(insertsNoteOnInsertion('all')).toBe(true);
    expect(insertsNoteOnInsertion('onInsert')).toBe(true);
    expect(insertsNoteOnInsertion('never')).toBe(false);
    expect(insertsNoteOnInsertion(undefined)).toBe(false);
  });

  it('sweeps on resolve only for `all`', () => {
    expect(sweepsNoteOnResolve('all')).toBe(true);
    expect(sweepsNoteOnResolve('onInsert')).toBe(false);
    expect(sweepsNoteOnResolve('never')).toBe(false);
    expect(sweepsNoteOnResolve(undefined)).toBe(false);
  });
});
