import { matchTerm, adjacentChain, interiorWeight, queryAtoms, containsLiteral, foldDiacritics, normTerm, foldWithMap } from '../search-match';
import { scoreEntry, passesCoverage, queryTerms } from '../search-score';
import { sameVariantWord } from '../search-variants';
import { matchesWord } from '../search-score';

describe('matchTerm — whole / prefix / start-aligned interior', () => {
  const title = 'Anticapitalism and the Critique of Colonialism';

  it('matches whole words and prefixes', () => {
    expect(matchTerm(title, 'anticapitalism')?.strength).toBe('word');
    expect(matchTerm(title, 'anticap')?.strength).toBe('prefix');
  });

  it('matches a start-aligned interior morpheme (capi in anti|capitalism)', () => {
    // "capi" begins right after "anti" — a morpheme start.
    expect(matchTerm(title, 'capi')?.strength).toBe('interior');
    // "capitalism" is the trailing part of a known compound.
    expect(matchTerm(title, 'capitalism')?.strength).toBe('interior');
  });

  it('does NOT match a mid-word fragment (loni, ntic)', () => {
    expect(matchTerm(title, 'loni')).toBeNull();
    expect(matchTerm(title, 'ntic')).toBeNull();
  });

  it('rejects a 3-letter mid-word fragment', () => {
    expect(matchTerm(title, 'ica')).toBeNull();
    expect(matchTerm(title, 'cap')).toBeNull();
    expect(matchTerm(title, 'ita')).toBeNull();
  });

  it('finds a prefix of a whole word (colo → colonialism)', () => {
    expect(matchTerm(title, 'colo')?.strength).toBe('prefix');
  });
});

describe('interiorWeight', () => {
  it('scales from just above zero at 4 to parity at 6', () => {
    expect(interiorWeight(4)).toBeLessThan(interiorWeight(5));
    expect(interiorWeight(5)).toBeLessThan(interiorWeight(6));
    expect(interiorWeight(6)).toBe(1);
    expect(interiorWeight(9)).toBe(1);
  });
});

describe('adjacentChain — phrase adjacency', () => {
  const title = 'Intercultural Critical Analysis and Multicultural Crises';

  it('chains a short second term to the FOLLOWING word', () => {
    // "cultural cri" → "critical" immediately follows "cultural"? Not here —
    // "critical" follows "intercultural", which PREFIX-matches "cultural".
    expect(adjacentChain(title, ['intercultural', 'cri'])).toBe(2);
  });

  it('reports only the first term as found when the second is not adjacent', () => {
    // "cultural" is present, but "acri" does not begin the NEXT word, so no
    // full chain: the value is 1 (one term matched), not 2.
    expect(adjacentChain('cultural breakdowns and acrimony', ['cultural', 'acri'])).toBe(1);
  });

  it('chains a contiguous phrase', () => {
    expect(adjacentChain('A Social Critique of Taste', ['social', 'cri'])).toBe(2);
  });
});

describe('orthographic variants', () => {
  it('treats colour/color and colonisation/colonization as equal', () => {
    expect(sameVariantWord('colour', 'color')).toBe(true);
    expect(sameVariantWord('colonisation', 'colonization')).toBe(true);
    expect(matchesWord('The Color of Law', 'colour')).toBe(true);
    expect(matchesWord('Colonisation and its Legacies', 'colonization')).toBe(true);
  });

  it('does not fold unrelated words', () => {
    expect(sameVariantWord('color', 'collar')).toBe(false);
    expect(sameVariantWord('labor', 'label')).toBe(false);
  });
});

describe('quoted literal terms', () => {
  const title = 'Anticolonial Thought and Anti-Witchcraft in Colonialism';

  it('parses quoted and unquoted atoms', () => {
    expect(queryAtoms('"anticolon" Africa')).toEqual([
      { text: 'anticolon', literal: true },
      { text: 'africa', literal: false },
    ]);
    expect(queryAtoms("'anti witch' colony")).toEqual([
      { text: 'anti witch', literal: true },
      { text: 'colony', literal: false },
    ]);
  });

  it('treats an UNCLOSED double quote as a literal run to the end', () => {
    // The intent of `@"postcolonial Afri` while typing is clear.
    expect(queryAtoms('"postcolonial Afri')).toEqual([
      { text: 'postcolonial afri', literal: true },
    ]);
    // A closed quote after it still parses normally.
    expect(queryAtoms('"postcolonial" Afri')).toEqual([
      { text: 'postcolonial', literal: true },
      { text: 'afri', literal: false },
    ]);
  });

  it('does NOT treat an unclosed SINGLE quote specially (apostrophes)', () => {
    // `ma'ani` uses `'` as a transliteration barrier, not a quote delimiter.
    expect(queryAtoms("ma'ani")).toEqual([{ text: 'maani', literal: false }]);
    expect(queryAtoms("'anti colonial")).toEqual([
      { text: 'anti', literal: false },
      { text: 'colonial', literal: false },
    ]);
  });

  it('matches a quoted term literally, not as separated words', () => {
    expect(containsLiteral(title, 'anticolonial')).toBe(true);
    // "anti-witchcraft … colonialism" — the literal string is absent.
    expect(containsLiteral(title, 'anti-witchcraft colonialism')).toBe(false);
  });

  it('scores an unclosed quote as a literal phrase', () => {
    const e = {
      citekey: 'x',
      title: 'Postcolonial African Literature',
      authorText: '',
      abstract: null,
      venueText: null,
    };
    const s = scoreEntry(e, '"postcolonial Afri', {});
    expect(passesCoverage(s)).toBe(true);
    expect(s.matchedTerms).toEqual(['postcolonial afri']);
    // The words apart in a different order are not the literal phrase.
    expect(
      passesCoverage(
        scoreEntry(
          { ...e, title: 'Postcolonialism and African' },
          '"postcolonial African',
          {}
        )
      )
    ).toBe(false);
  });

  it('normalises case and diacritics in unquoted terms', () => {
    expect(queryAtoms('Café')).toEqual([{ text: 'cafe', literal: false }]);
    expect(queryAtoms('José María')).toEqual([
      { text: 'jose', literal: false },
      { text: 'maria', literal: false },
    ]);
    expect(queryAtoms('"Café"')).toEqual([{ text: 'cafe', literal: true }]);
  });

  it('folds scholarly Arabic transliteration diacritics', () => {
    // NFD alone leaves the spacing modifier letters for hamza/ʿayn, so a
    // hamza-less query never matched the transliterated field.
    expect(foldDiacritics('rasāʾil')).toBe('rasail');
    expect(foldDiacritics('maʿānī')).toBe('maani');
    expect(foldDiacritics('Jawāhir')).toBe('Jawahir');
    // Underdots and macrons, the more common case, still fold.
    expect(foldDiacritics('Ẓāhir')).toBe('Zahir');
    expect(foldDiacritics('ḥadīth')).toBe('hadith');
  });

  it('folds every spelling of hamza / ʿayn to the same search form', () => {
    // The point of the fold: the transliterated spelling and the apostrophe
    // spelling must meet in the middle, whichever glyph the source used.
    expect(normTerm('rasāʾil')).toBe('rasail');
    expect(normTerm("rasa'il")).toBe('rasail');
    // The phonetic modifier letters some conventions use instead of ʾ / ʿ.
    expect(normTerm('rasāᶜil')).toBe('rasail');
    expect(normTerm('maᵓānī')).toBe('maani');
    expect(normTerm('maʿānī')).toBe('maani');
    expect(normTerm("ma'ani")).toBe('maani');
    // Curly vs straight apostrophe, and the grave/accent lookalikes.
    expect(normTerm('wa’l')).toBe(normTerm("wa'l"));
    expect(normTerm('wa`l')).toBe(normTerm('wa´l'));
    expect(queryAtoms('Rasāʾil')).toEqual([{ text: 'rasail', literal: false }]);
    expect(queryAtoms('Maʿānī')).toEqual([{ text: 'maani', literal: false }]);
    // A hamza/apostrophe word stays ONE term (the straight apostrophe is not a
    // separator once it is a barrier).
    expect(queryAtoms("ma'ani")).toEqual([{ text: 'maani', literal: false }]);
    expect(queryAtoms("rasa'il")).toEqual([{ text: 'rasail', literal: false }]);
  });

  it('collapses a doubled long vowel for every vowel', () => {
    // Macron (ā) and doubling (aa) are the same long vowel in different
    // conventions, so they must reach the same form.
    expect(normTerm('jawaahir')).toBe(normTerm('jawāhir'));
    expect(normTerm('Kitaab')).toBe('kitab');
    expect(normTerm('Khaleel')).toBe('khalel');
    expect(normTerm('Kareem')).toBe('karem');
    expect(normTerm('soofi')).toBe('sofi');
    expect(normTerm('Sufii')).toBe('sufi');
    expect(normTerm('Sufuul')).toBe('suful');
    // Shadda (a doubled CONSONANT) is a different phenomenon — it must stay.
    expect(normTerm('Muḥammad')).toBe('muhammad');
    expect(normTerm('Allah')).toBe('allah');
  });

  it('does not collapse across a removed hamza / ʿayn', () => {
    // `tasāʾala` has a hamza BETWEEN two short a's. Removing it first and then
    // collapsing `aa` would wrongly give `tasala`; keeping the barrier through
    // the collapse preserves the seam.
    expect(normTerm('tasāʾala')).toBe('tasaala');
    expect(normTerm("tasa'ala")).toBe('tasaala');
    expect(normTerm('tasala')).toBe('tasala');
    expect(normTerm('tasāʾala')).not.toBe(normTerm('tasala'));
    // A double that is NOT across a hamza still collapses.
    expect(normTerm('rasaail')).toBe('rasail');
    expect(normTerm('rasāʾil')).toBe('rasail');
    // KNOWN LIMIT: a hamza-less + macron-less spelling is ambiguous and reads
    // as a doubled long vowel, so `maani` alone does not reach `maʿānī`.
    expect(normTerm('maani')).toBe('mani');
  });

  it('foldWithMap agrees with normTerm (the drift guard)', () => {
    // Scoring uses `normTerm`; highlighting uses `foldWithMap`. If the fold is
    // changed in one place and not the other, this fails, so the two cannot
    // silently disagree about what a term matches.
    const samples = [
      'Jawāhir al-rasāʾil',
      'maʿānī',
      'tasāʾala',
      "tasa'ala",
      'jawaahir',
      'rasaail',
      'wa’l-khamsūn',
      "ma'ani",
      'Muḥammad',
      'Ẓāhir',
      'Café',
      'Al-Khūʾī Abū',
      'jidaa',
      'anti-colonial',
      '',
    ];
    for (const s of samples) {
      expect(foldWithMap(s).text).toBe(normTerm(s));
      expect(foldWithMap(s, { dropHyphens: true }).text).toBe(
        normTerm(s).replace(/[-\u2010\u2011]/g, '')
      );
    }
  });
});

describe('matchesWord with quoted form via scoreEntry', () => {
  it('a quoted term does not match the scattered words', () => {
    const e = {
      citekey: 'x',
      title: 'Anti-Witchcraft and Colonialism',
      authorText: '',
      abstract: null,
      venueText: null,
    };
    // Unquoted "anticolonial" is a prefix/morpheme question; quoted is literal.
    expect(containsLiteral(e.title, 'anticolonial')).toBe(false);
    expect(containsLiteral('Anticolonial Thought', 'anticolonial')).toBe(true);
  });
});

describe('quoted queries through scoreEntry', () => {
  const A = { citekey: 'a', title: 'Anticolonial Thought in Africa', authorText: 'Smith', abstract: null, venueText: null };
  const B = { citekey: 'b', title: 'Anti-Witchcraft Movements and Postcolonial Theory', authorText: 'Jones', abstract: null, venueText: null };

  it('matches the literal string only', () => {
    expect(passesCoverage(scoreEntry(A, '"anticolonial"'))).toBe(true);
    expect(passesCoverage(scoreEntry(B, '"anticolonial"'))).toBe(false);
  });

  it('mixes a quoted literal with an unquoted term (case-insensitive)', () => {
    const s = scoreEntry(A, '"anticolon" Africa');
    expect(passesCoverage(s)).toBe(true);
    expect(s.covered).toBe(2);
    expect(passesCoverage(scoreEntry(B, '"anticolon" africa'))).toBe(false);
  });

  it('a quoted term does not chunk-match scattered words', () => {
    expect(passesCoverage(scoreEntry(B, '"anticolon"'))).toBe(false);
  });
});


describe('hyphens are within-word markers (not separators)', () => {
  it('keeps anti-colonial as ONE compound atom', () => {
    expect(queryAtoms('anti-colonial')).toEqual([
      { text: 'anti-colonial', literal: false, hyphenated: true },
    ]);
    expect(queryTerms('anti-colonial')).toEqual(['anti-colonial']);
  });

  it('keeps a QUOTED hyphenated run literal', () => {
    expect(queryAtoms('"anti-colonial"')).toEqual([
      { text: 'anti-colonial', literal: true },
    ]);
  });

  it('does not split a hyphen into separate terms', () => {
    const scattered = {
      citekey: 'x',
      title: 'Anti-Aging Products in Colonial New England',
      authorText: '',
      abstract: null,
      venueText: null,
    };
    // `anti` in "Anti-Aging" and `colonial` in "Colonial" belong to unrelated
    // words: a hyphenated query must NOT match them.
    expect(passesCoverage(scoreEntry(scattered, 'anti-colonial', {}))).toBe(false);
  });

  it('matches both the hyphenated and the joined spelling', () => {
    const hyphenated = { citekey: 'a', title: 'Anti-Colonial Critique', authorText: '', abstract: null, venueText: null };
    const joined = { citekey: 'b', title: 'Anticolonial Thought', authorText: '', abstract: null, venueText: null };
    expect(passesCoverage(scoreEntry(hyphenated, 'anti-colonial', {}))).toBe(true);
    expect(passesCoverage(scoreEntry(joined, 'anti-colonial', {}))).toBe(true);
  });
});

describe('compound spelling equivalence (anti-colonial ≡ anticolonial)', () => {
  const hy = { citekey: 'h', title: 'Anti-Colonial Critique', authorText: '', abstract: null, venueText: null };
  const jo = { citekey: 'j', title: 'Anticolonial Thought', authorText: '', abstract: null, venueText: null };
  const scatter = { citekey: 'b', title: 'Anti-Aging Cream in Colonial Societies', authorText: '', abstract: null, venueText: null };

  it('both spellings find both spellings', () => {
    for (const q of ['anticolonial', 'anti-colonial']) {
      expect(passesCoverage(scoreEntry(hy, q, {}))).toBe(true);
      expect(passesCoverage(scoreEntry(jo, q, {}))).toBe(true);
    }
  });

  it('ranks the exact spelling above the variant', () => {
    // The hyphen/joined equivalence is handled by `matchTerm`, so no special
    // compound path is needed; the exact spelling just matches the exact phrase.
    expect(scoreEntry(hy, 'anti-colonial', {}).value).toBeLessThan(
      scoreEntry(jo, 'anti-colonial', {}).value
    );
    expect(scoreEntry(jo, 'anticolonial', {}).value).toBeLessThan(
      scoreEntry(hy, 'anticolonial', {}).value
    );
  });

  it('rejects the split reading (anti … colonial in unrelated words)', () => {
    for (const q of ['anticolonial', 'anti-colonial']) {
      expect(passesCoverage(scoreEntry(scatter, q, {}))).toBe(false);
    }
  });
});

describe('citekey band ignores spaces and @', () => {
  const e = {
    citekey: 'bourdieuDistinctionSocial1984',
    title: 'Distinction: A Social Critique',
    authorText: 'Bourdieu, Pierre',
    abstract: null,
    venueText: null,
  };
  const v = (q: string) => scoreEntry(e, q, {}).value;

  it('ranks a spaced citekey prefix in the top band', () => {
    expect(v('bourdieudist')).toBeLessThan(0);
    expect(v('bourdieu dist')).toBeLessThan(0);
    expect(v('@bourdieu dist')).toBeLessThan(0);
  });

  it('an exact citekey outranks a prefix', () => {
    expect(v('bourdieudistinctionsocial1984')).toBeLessThan(v('bourdieu dist'));
  });

  it('a non-contiguous join is a WEAKER citekey match, not a content match', () => {
    // "1984" is not adjacent to "dist" in the key, so this is not the
    // contiguous prefix, but the terms DO read onto the key in order — top
    // band, below the contiguous prefix.
    const ordered = v('bourdieu dist 1984');
    const prefix = v('bourdieu dist');
    expect(ordered).toBeLessThan(0);
    expect(prefix).toBeLessThan(ordered);
  });

  it('a longer prefix (more specific) outranks a shorter one', () => {
    expect(v('bourdieu distinc')).toBeLessThan(v('bourdieu d'));
  });
});

describe('citekey ordered-subsequence match', () => {
  const e = {
    citekey: 'bourdieuDistinctionSocial1984',
    title: 'Distinction',
    authorText: 'Bourdieu, Pierre',
    abstract: null,
    venueText: null,
  };
  const noise = {
    citekey: 'unrelatedThing2000',
    title: 'Bourdieu, Distinction, and Social Theory in the 1984 Debate',
    authorText: 'Other',
    abstract: null,
    venueText: null,
  };

  it('puts a spaced phrase that reads onto the key in the top band', () => {
    const v = scoreEntry(e, 'bourdieu dist 1984', {}).value;
    expect(v).toBeLessThan(0);
    // And well above an entry that merely contains all three terms.
    expect(v).toBeLessThan(scoreEntry(noise, 'bourdieu dist 1984', {}).value);
  });

  it('orders exact > contiguous prefix > ordered subsequence', () => {
    const exact = scoreEntry(e, 'bourdieudistinctionsocial1984', {}).value;
    const prefix = scoreEntry(e, 'bourdieu dist', {}).value;
    const ordered = scoreEntry(e, 'bourdieu dist 1984', {}).value;
    expect(exact).toBeLessThan(prefix);
    expect(prefix).toBeLessThan(ordered);
    expect(ordered).toBeLessThan(0);
  });

  it('ignores too-short terms', () => {
    // "d" alone must not qualify a key via the ordered path.
    const short = { citekey: 'x1984', title: 'x', authorText: '', abstract: null, venueText: null };
    expect(scoreEntry(short, 'd 1984', {}).value).toBeGreaterThan(0);
  });
});
