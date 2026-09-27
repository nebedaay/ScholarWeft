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

  it('finds an author by first name (concatenated and spaced)', () => {
    expect(finds(cesaire, 'aimecesaire')).toBe(true);
    expect(finds(cesaire, 'aime cesaire')).toBe(true);
  });

  it('is diacritic-insensitive in both directions', () => {
    expect(finds(cesaire, 'aimecesaire')).toBe(true);
    expect(finds(cesaire, 'aimécésaire')).toBe(true);
    expect(finds('Aime Cesaire Cesaire Aime', 'aimécésaire')).toBe(true);
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
