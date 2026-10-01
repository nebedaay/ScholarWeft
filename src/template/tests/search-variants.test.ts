import {
  canonicalForm,
  isVariantWord,
  sameVariantWord,
  spellingVariants,
} from '../search-variants';
import { matchTerm } from '../search-match';
import { passesCoverage, scoreEntry } from '../search-score';

const entry = (title: string) => ({
  citekey: 'x',
  title,
  authorText: '',
  abstract: null,
  venueText: null,
});

describe('search-variants — sameVariantWord', () => {
  it('folds the verified British/American pairs', () => {
    expect(sameVariantWord('color', 'colour')).toBe(true);
    expect(sameVariantWord('colour', 'color')).toBe(true);
    expect(sameVariantWord('polarized', 'polarised')).toBe(true);
    expect(sameVariantWord('analyse', 'analyze')).toBe(true);
    expect(sameVariantWord('analyzed', 'analysed')).toBe(true);
    expect(sameVariantWord('mediaeval', 'medieval')).toBe(true);
    expect(sameVariantWord('encyclopaedia', 'encyclopedia')).toBe(true);
  });

  it('folds inflections of a stem, not just the bare word', () => {
    expect(sameVariantWord('colors', 'colours')).toBe(true);
    expect(sameVariantWord('coloring', 'colouring')).toBe(true);
    expect(sameVariantWord('organizations', 'organisations')).toBe(true);
    expect(sameVariantWord('behavioral', 'behavioural')).toBe(true);
    expect(sameVariantWord('polarizing', 'polarising')).toBe(true);
  });

  it('does NOT fold look-alikes that are not variant pairs', () => {
    // The `ae`→`e` trap the stem list exists to avoid.
    expect(sameVariantWord('aegean', 'egean')).toBe(false);
    expect(sameVariantWord('caesar', 'cesar')).toBe(false);
    // Ordinary near-misses.
    expect(sameVariantWord('color', 'collar')).toBe(false);
    expect(sameVariantWord('labor', 'label')).toBe(false);
    // Different inflections of the SAME stem are not the same word.
    expect(sameVariantWord('colour', 'colours')).toBe(false);
    expect(sameVariantWord('analyze', 'analyzed')).toBe(false);
  });

  it('is symmetric and reflexive', () => {
    const words = [
      'color', 'colour', 'colors', 'colours', 'polarize', 'polarise',
      'analyse', 'analyze', 'aesthetic', 'esthetic', 'organise', 'organize',
    ];
    for (const a of words) {
      expect(sameVariantWord(a, a)).toBe(true);
      for (const b of words) {
        expect(sameVariantWord(a, b)).toBe(sameVariantWord(b, a));
      }
    }
  });
});

describe('search-variants — canonicalForm', () => {
  it('reduces both spellings to one canonical key', () => {
    expect(canonicalForm('colour')).toBe('color');
    expect(canonicalForm('color')).toBe('color');
    expect(canonicalForm('polarised')).toBe('polarized');
    expect(canonicalForm('colours')).toBe('colors');
    expect(canonicalForm('organisations')).toBe('organizations');
  });

  it('leaves unknown words untouched', () => {
    expect(canonicalForm('aegean')).toBe('aegean');
    expect(canonicalForm('caesar')).toBe('caesar');
    expect(canonicalForm('colorful')).toBe('colorful');
  });
});

describe('search-variants — spellingVariants', () => {
  it('returns exactly the other spelling, with no junk', () => {
    expect(spellingVariants('color')).toEqual(['colour']);
    expect(spellingVariants('colour')).toEqual(['color']);
    expect(spellingVariants('colors')).toEqual(['colours']);
    expect(spellingVariants('colours')).toEqual(['colors']);
    expect(spellingVariants('polarized')).toEqual(['polarised']);
    expect(spellingVariants('analyzed')).toEqual(['analysed']);
    expect(spellingVariants('organization')).toEqual(['organisation']);
    expect(spellingVariants('mediaeval')).toEqual(['medieval']);
  });

  it('folds the stem of DERIVED words the closed inflection list omits', () => {
    // These are outside TAILS, so only the leading-stem rotation can relate
    // them — this is what keeps `color` and `colour` from diverging.
    expect(spellingVariants('colorful')).toEqual(['colourful']);
    expect(spellingVariants('colourful')).toEqual(['colorful']);
    expect(spellingVariants('colorless')).toEqual(['colourless']);
    expect(spellingVariants('neighbourly')).toEqual(['neighborly']);
    expect(spellingVariants('organizational')).toEqual(['organisational']);
    expect(spellingVariants('colourization')).toEqual(['colorization']);
  });

  it('never emits the term itself, a bare stem, or a doubled-e form', () => {
    for (const term of ['colors', 'colours', 'polarized', 'analysed', 'organizations']) {
      const got = spellingVariants(term);
      expect(got).not.toContain(term);
      for (const v of got) {
        expect(v).not.toMatch(/ee/);
        expect(isVariantWord(v)).toBe(true);
        expect(sameVariantWord(term, v)).toBe(true);
      }
    }
  });

  it('returns nothing for a word that is not a known variant', () => {
    expect(spellingVariants('aegean')).toEqual([]);
    expect(spellingVariants('caesar')).toEqual([]);
    expect(spellingVariants('')).toEqual([]);
    // `emphasis` must not be read as a form of `emphasise`.
    expect(spellingVariants('emphasis')).toEqual([]);
  });

  it('never folds an e-dropped stem that is itself a word', () => {
    // `emphasis` (from `emphasise`) and `analyses` are traps for naive folding.
    expect(isVariantWord('emphasis')).toBe(false);
    expect(sameVariantWord('emphasis', 'emphasise')).toBe(false);
  });
});

describe('search-variants — prefix symmetry (color vs colour)', () => {
  const cases: Array<[string, string]> = [
    ['The Color of Law', 'color'],
    ['The Colour of Law', 'colour'],
    ['Colorful Histories', 'colour'],
    ['Colourful Histories', 'color'],
    ['Colors and Colours', 'colour'],
    ['Colours and Colors', 'color'],
    ['Coloring Outside the Lines', 'colouring'],
    ['Colouring Outside the Lines', 'coloring'],
    ['Neighbourly Relations', 'neighbor'],
    ['Neighborly Relations', 'neighbour'],
    ['Organisational Behaviour', 'organizational'],
    ['Organizational Behaviour', 'organisational'],
  ];

  it('matches the other spelling for derived and inflected forms', () => {
    for (const [title, q] of cases) {
      expect(matchTerm(title, q)).not.toBeNull();
    }
  });

  it('gives `color` and `colour` the SAME match for every field spelling', () => {
    const fields = [
      'color', 'colour', 'colors', 'colours', 'colored', 'coloured',
      'coloring', 'colouring', 'colorful', 'colourful', 'colorless',
      'colourless', 'colorization', 'colourization',
    ];
    for (const field of fields) {
      const text = `The ${field} Book`;
      expect(!!matchTerm(text, 'color')).toBe(!!matchTerm(text, 'colour'));
    }
  });

  it('still refuses the aegean/caesar look-alikes', () => {
    expect(matchTerm('Aegean Civilisation', 'color')).toBeNull();
    expect(matchTerm('Caesar and Rome', 'colour')).toBeNull();
  });
});

describe('search-variants — end-to-end search', () => {
  it('matches the other spelling as a whole word', () => {
    expect(matchTerm('The Colour of Law', 'color')?.strength).toBe('word');
    expect(matchTerm('The Color of Law', 'colour')?.strength).toBe('word');
    expect(matchTerm('Polarised Light', 'polarized')?.strength).toBe('word');
    expect(matchTerm('Analyse This', 'analyze')?.strength).toBe('word');
  });

  it('does not match the aegean/caesar look-alikes', () => {
    expect(matchTerm('Aegean Civilisation', 'egean')).toBeNull();
    expect(matchTerm('Caesar and Rome', 'cesar')).toBeNull();
  });

  it('scores a variant match through the normal pipeline', () => {
    expect(passesCoverage(scoreEntry(entry('The Colour of Law'), 'color'))).toBe(true);
    expect(passesCoverage(scoreEntry(entry('Colonisation and its Legacies'), 'colonization'))).toBe(true);
    expect(passesCoverage(scoreEntry(entry('Aegean Civilisation'), 'egean'))).toBe(false);
  });

  it('the pre-filter substring gate admits the other spelling', () => {
    const hay = 'the colour of law';
    expect(hay.includes('color')).toBe(false);
    expect(spellingVariants('color').some((v) => hay.includes(v))).toBe(true);
  });
});
