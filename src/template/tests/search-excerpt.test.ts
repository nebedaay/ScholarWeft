import {
  EXCERPT_WIDTH,
  buildExcerpts,
  excerptForResult,
  findTermSpans,
} from '../search-excerpt';
import { scoreEntry } from '../search-score';

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

describe('prefer the most illustrative excerpt', () => {
  it('prefers ONE line covering several terms over two lines covering fewer', () => {
    // The user's preference: the most illustrative text is the best. A wider
    // window that gathers all the terms beats two narrow ones.
    const text =
      'The study of women and authority in practice is examined here, and the place of Islam within those debates is considered at length.';
    const lines = buildExcerpts(text, ['women', 'authority', 'islam']);
    expect(lines).toHaveLength(1);
    const bolded = lines[0].matches.map((m) =>
      lines[0].text.slice(m.start, m.start + m.length).toLowerCase()
    );
    expect(bolded).toEqual(['women', 'authority', 'islam']);
  });

  it('still splits when the terms are genuinely far apart', () => {
    // No single reasonable window can cover them, so they get a line each.
    const text =
      'The study of women and authority in practice. ' +
      'filler '.repeat(40) +
      'Later we return to Islam.';
    const lines = buildExcerpts(text, ['women', 'authority', 'islam']);
    expect(lines).toHaveLength(2);
  });

  it('loses no term when it can be shown', () => {
    // Terms within reach of a line are all shown; the cap only bites when they
    // are genuinely too far apart for one line and there are more terms than
    // lines.
    const text =
      'The study of women and authority in practice, and the place of Islam within those debates.';
    const lines = buildExcerpts(text, ['women', 'authority', 'islam']);
    const shown = lines
      .flatMap((l) =>
        l.matches.map((m) => l.text.slice(m.start, m.start + m.length).toLowerCase())
      )
      .sort();
    expect(shown).toEqual(['authority', 'islam', 'women']);
  });

  it('maximises coverage when the cap forces a choice', () => {
    // Three widely separated terms, two lines: prefer lines that cover MORE
    // terms rather than one term each.
    const text =
      'women ' +
      'filler '.repeat(20) +
      'authority ' +
      'filler '.repeat(20) +
      'islam';
    const lines = buildExcerpts(text, ['women', 'authority', 'islam']);
    expect(lines.length).toBeLessThanOrEqual(2);
    const shown = lines.flatMap((l) =>
      l.matches.map((m) => l.text.slice(m.start, m.start + m.length).toLowerCase())
    );
    // Two terms shown (the best available), never fewer.
    expect(shown.length).toBeGreaterThanOrEqual(2);
  });

  it('caps at two lines however many terms match', () => {
    const text = ['alpha', 'beta', 'gamma', 'delta']
      .map((w) => `${w} ${'pad '.repeat(30)}`)
      .join(' ');
    const lines = buildExcerpts(text, ['alpha', 'beta', 'gamma', 'delta']);
    expect(lines.length).toBeLessThanOrEqual(2);
  });
});

describe('findTermSpans() — highlighting in any field', () => {
  const title = 'Distinction: A Social Critique of the Judgment of Taste';

  it('finds whole words', () => {
    const spans = findTermSpans(title, ['social', 'critique']);
    expect(spans.map((s) => title.slice(s.start, s.start + s.length))).toEqual([
      'Social',
      'Critique',
    ]);
  });

  it('finds word prefixes, for abbreviated searches', () => {
    const spans = findTermSpans(title, ['soc', 'crit']);
    expect(spans.map((s) => title.slice(s.start, s.start + s.length))).toEqual([
      'Soc',
      'Crit',
    ]);
  });

  it('is diacritic- and case-insensitive', () => {
    expect(findTermSpans('Aimé Césaire', ['aime'])).toHaveLength(1);
    expect(findTermSpans('Aime Cesaire', ['aimé'])).toHaveLength(1);
  });

  it('finds every occurrence, not just the first', () => {
    expect(findTermSpans('social and social again', ['social'])).toHaveLength(2);
  });

  it('returns nothing for absent terms or empty input', () => {
    expect(findTermSpans(title, ['zebra'])).toEqual([]);
    expect(findTermSpans('', ['social'])).toEqual([]);
    expect(findTermSpans(title, [])).toEqual([]);
  });

  it('never emits overlapping spans', () => {
    // A short term inside a longer one must not produce a stray fragment.
    const spans = findTermSpans('critique', ['crit', 'critique']);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(
        spans[i - 1].start + spans[i - 1].length
      );
    }
  });
});

describe('highlighting matched CHUNK terms (the reported case)', () => {
  // `khutab` reaches "alkhuiMujamRijal1983" because the run splits into `khu`
  // and `tab`, matching "Al-Khūʾī" and "ṭabaqāt". Highlighting the raw word
  // finds nothing; highlighting the terms that matched explains the result.
  const title = 'Muʿjam rijāl al-ḥadīth wa tafṣīl ṭabaqāt al-ruwāt';
  const author = 'Al-Khūʾī Abū';

  it('finds nothing for the raw word', () => {
    expect(findTermSpans(title, ['khutab'])).toEqual([]);
    expect(findTermSpans(author, ['khutab'])).toEqual([]);
  });

  it('finds the chunk terms that actually matched', () => {
    expect(
      findTermSpans(author, ['khu', 'tab']).map((s) =>
        author.slice(s.start, s.start + s.length)
      )
    ).toContain('Khū');
    expect(
      findTermSpans(title, ['khu', 'tab']).map((s) =>
        title.slice(s.start, s.start + s.length)
      )
    ).toContain('ṭab');
  });

  it('is diacritic-insensitive in both directions', () => {
    // Why `khutab` and `khuṭab` behave alike: normalisation strips the marks.
    expect(findTermSpans(author, ['khu'])).toHaveLength(1);
    expect(findTermSpans('Al-Khutabi', ['khū'])).toHaveLength(1);
  });
});

describe('emphasis offsets survive normalisation', () => {
  // Normalising strips combining marks, which can SHORTEN a decomposed string
  // and shift every later offset. Searching the normalised text and then
  // slicing the ORIGINAL at that offset therefore bolds the wrong characters —
  // the match is found but the emphasis lands elsewhere.
  const decomposed = 'Al-Kh' + 'u\u0304' + 'ʾī Abū';
  const precomposed = 'Al-Khūʾī Abū';

  it('finds a match in precomposed text', () => {
    const spans = findTermSpans(precomposed, ['khu']);
    expect(spans.map((s) => precomposed.slice(s.start, s.start + s.length))).toEqual([
      'Khū',
    ]);
  });

  it('finds the same match in decomposed text', () => {
    const spans = findTermSpans(decomposed, ['khu']);
    expect(spans).toHaveLength(1);
    // The span covers the base letters AND the combining mark.
    expect(decomposed.slice(spans[0].start, spans[0].start + spans[0].length)).toBe(
      'Kh' + 'u\u0304'
    );
  });

  it('keeps later offsets correct when a decomposed char precedes the match', () => {
    // The failure this guards: an earlier accent shortening the string and
    // pushing the bold off the match entirely.
    const text = 'Caf' + 'e\u0301' + ' notes on khutab and more';
    const spans = findTermSpans(text, ['khutab']);
    expect(spans.map((s) => text.slice(s.start, s.start + s.length))).toEqual([
      'khutab',
    ]);
  });

  it('works in a title with several accented characters', () => {
    const title = 'Muʿjam rijāl al-ḥadīth wa tafṣīl ṭabaqāt al-ruwāt';
    const spans = findTermSpans(title, ['tab']);
    expect(spans.map((s) => title.slice(s.start, s.start + s.length))).toEqual(['ṭab']);
  });
});

describe('matchedTerms reflect what the scorer interpreted', () => {
  // `womenauthoritysenegal` is ONE unbroken run to the tokeniser, but the scorer
  // splits it into words. Recording the run stored a string that appears in no
  // field, so nothing could be highlighted — and adding one character changed
  // whether a split was even found, which is why `…senega` highlighted and
  // `…senegal` did not.
  const entry = {
    title: 'Women and Authority in Senegal',
    authorText: 'X',
    abstract: 'This article examines women and authority in Senegal.',
  };

  it('reports the WORDS the entry was matched against', () => {
    const s = scoreEntry(entry, 'womenauthoritysenegal', { includeAbstract: false });
    expect(s.matchedTerms).toEqual(['women', 'authority', 'senegal']);
  });

  it('does the same for a truncated final word', () => {
    const s = scoreEntry(entry, 'womenauthoritysenega', { includeAbstract: false });
    expect(s.matchedTerms).toEqual(['women', 'authority', 'senega']);
  });

  it('lets every matched term be highlighted in the title', () => {
    for (const q of ['womenauthoritysenega', 'womenauthoritysenegal']) {
      const s = scoreEntry(entry, q, { includeAbstract: false });
      const shown = findTermSpans(entry.title, s.matchedTerms).map((x) =>
        entry.title.slice(x.start, x.start + x.length)
      );
      expect(shown).toEqual(['Women', 'Authority', shown[2]]);
      expect(shown).toHaveLength(3);
    }
  });
});
