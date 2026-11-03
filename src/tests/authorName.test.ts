import { normalizeAuthorName } from '../authorName';

describe('normalizeAuthorName()', () => {
  it('matches punctuation, spacing, case, diacritics and ayn/hamza variants', () => {
    expect(normalizeAuthorName('[Niasse], Ibrāhīm b. ʿAbd Allāh')).toBe(
      normalizeAuthorName('-Niasse-, Ibrahim b. Abd Allah')
    );
    expect(normalizeAuthorName('Émile')).toBe(normalizeAuthorName('Emile'));
    expect(normalizeAuthorName('ʿAbdullāh')).toBe(normalizeAuthorName('Abdullah'));
    expect(normalizeAuthorName('‘Abdullāh')).toBe(normalizeAuthorName('Abdullah'));
    expect(normalizeAuthorName('de Saussure')).toBe(
      normalizeAuthorName('De Saussure')
    );
  });

  it('does not collapse different name order or initials into full names', () => {
    expect(normalizeAuthorName('Ali, Muhammad')).not.toBe(
      normalizeAuthorName('Muhammad Ali')
    );
    expect(normalizeAuthorName('J. Smith')).not.toBe(
      normalizeAuthorName('John Smith')
    );
  });
});
