import { interpretationsFor } from '../search-interpret';
import { passesCoverage, scoreEntry } from '../search-score';

/**
 * Reported: "Author/title search doesn't seem to search author first name.
 * `aimecesaire` and `aimécésaire` only turn up something with Aimé Césaire in
 * the title, not works BY Aimé Césaire."
 *
 * So every creator name field must be searchable, not just the family name.
 * `authorText` here mirrors what `authorTextOf()` in bibManager builds.
 */
function finds(
  authorText: string,
  query: string,
  includeAbstract = false
): boolean {
  const entry = { title: 'Discourse on Colonialism', authorText };
  return interpretationsFor(entry, query, { includeAbstract }).some((i) =>
    passesCoverage(
      scoreEntry(entry, i.terms.join(' '), { includeAbstract })
    )
  );
}

describe('creator names are all searchable', () => {
  // "Aimé Césaire" as bibManager emits it: name as written, then each part.
  const cesaire = 'Aimé Césaire Césaire Aimé';

  it('finds an author by first name', () => {
    expect(finds(cesaire, 'aime cesaire')).toBe(true);
  });

  it('is diacritic-insensitive in both directions', () => {
    expect(finds(cesaire, 'aime cesaire')).toBe(true);
    expect(finds(cesaire, 'aimé césaire')).toBe(true);
    expect(finds('Aime Cesaire Cesaire Aime', 'aimé césaire')).toBe(true);
  });

  it('finds by first name alone and family name alone', () => {
    expect(finds(cesaire, 'aime')).toBe(true);
    expect(finds(cesaire, 'cesaire')).toBe(true);
  });

  it('finds a literal / corporate creator with no family name', () => {
    expect(finds('UNESCO', 'unesco')).toBe(true);
  });

  it('finds an editor, not only an author', () => {
    // bibManager appends editor names to the same searchable text.
    expect(finds('Mary Shelley Shelley Mary John Smith Smith John', 'john')).toBe(
      true
    );
    expect(finds('Mary Shelley Shelley Mary John Smith Smith John', 'shelley')).toBe(
      true
    );
  });
});

describe('diacritics in the abstract', () => {
  it('matches with and without accents in either direction', () => {
    const entry = {
      title: 'Discourse on Colonialism',
      authorText: 'Aimé Césaire Césaire Aimé',
      abstract: 'On négritude and the Maghrébian question.',
    };
    const q = (query: string) =>
      interpretationsFor(entry, query, { includeAbstract: true }).some((i) =>
        passesCoverage(
          scoreEntry(entry, i.terms.join(' '), { includeAbstract: true })
        )
      );
    expect(q('negritude')).toBe(true);
    expect(q('négritude')).toBe(true);
    expect(q('maghrebian')).toBe(true);
    expect(q('maghrébian')).toBe(true);
  });
});

describe('undivided (single-field) creator names', () => {
  // In Zotero a creator may be a SINGLE field — `{ literal: 'UNESCO' }` in CSL,
  // stored on the parent name element rather than as given/family children.
  // authorTextOf() places the literal first, then any split parts.

  it('finds an undivided corporate name', () => {
    expect(finds('UNESCO', 'unesco')).toBe(true);
  });

  it('finds an undivided personal name', () => {
    expect(finds('Aristotle', 'aristotle')).toBe(true);
  });

  it('finds an undivided name by prefix', () => {
    expect(finds('UNESCO', 'unes')).toBe(true);
  });

  it('finds both undivided and split names on the same entry', () => {
    const mixed = 'UNESCO Aimé Césaire Césaire Aimé';
    expect(finds(mixed, 'unesco')).toBe(true);
    expect(finds(mixed, 'aime cesaire')).toBe(true);
    expect(finds(mixed, 'cesaire')).toBe(true);
  });

  it('is diacritic-insensitive for undivided names too', () => {
    expect(finds('Césaire', 'cesaire')).toBe(true);
    expect(finds('Cesaire', 'césaire')).toBe(true);
  });
});
