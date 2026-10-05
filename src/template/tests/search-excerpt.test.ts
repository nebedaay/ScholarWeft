import {
  EXCERPT_WIDTH,
  buildExcerpts,
  excerptForResult,
  excerptsForResult,
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

  it('returns null when no terms were recorded (narrow tier)', () => {
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

describe('bolding uses the shared search fold (hamza / ʿayn / doubled long vowels)', () => {
  // The title spells the word one way; the query another. The scorer matched
  // them via the shared fold, so the emphasis must find that spelling too.
  const title = 'Jawāhir al-rasāʾil: al-ḥāwī';

  it('bolds a macron spelling for a folded or apostrophe query', () => {
    for (const q of ['rasail', "rasa'il", 'rasāʾil', 'rasaail']) {
      const spans = findTermSpans(title, [q]);
      expect(spans.map((s) => title.slice(s.start, s.start + s.length))).toEqual([
        'rasāʾil',
      ]);
    }
  });

  it('bolds a doubled spelling for the macron query', () => {
    const t = 'Ziyādat al-jawaahir';
    const spans = findTermSpans(t, ['jawāhir']);
    expect(spans.map((s) => t.slice(s.start, s.start + s.length))).toEqual([
      'jawaahir',
    ]);
  });

  it('bolds a full hamza word for an apostrophe query', () => {
    const t = 'Jawāhir al-maʿānī wa-bulūgh';
    const spans = findTermSpans(t, ["ma'ani"]);
    expect(spans.map((s) => t.slice(s.start, s.start + s.length))).toEqual([
      'maʿānī',
    ]);
  });

  it('bolds the whole word across a preserved hamza seam', () => {
    const t = 'wa tasāʾala al-qawm';
    const spans = findTermSpans(t, ["tasa'ala"]);
    expect(spans.map((s) => t.slice(s.start, s.start + s.length))).toEqual([
      'tasāʾala',
    ]);
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

  it('reports the terms the entry was matched against', () => {
    const s = scoreEntry(entry, 'women authority senegal', { includeAbstract: false });
    expect(s.matchedTerms).toEqual(['women', 'authority', 'senegal']);
  });

  it('does the same for a truncated final word', () => {
    const s = scoreEntry(entry, 'women authority senega', { includeAbstract: false });
    expect(s.matchedTerms).toEqual(['women', 'authority', 'senega']);
  });

  it('lets every matched term be highlighted in the title', () => {
    for (const q of ['women authority senega', 'women authority senegal']) {
      const s = scoreEntry(entry, q, { includeAbstract: false });
      const shown = findTermSpans(entry.title, s.matchedTerms).map((x) =>
        entry.title.slice(x.start, x.start + x.length)
      );
      expect(shown).toEqual(['Women', 'Authority', shown[2]]);
      expect(shown).toHaveLength(3);
    }
  });
});

describe('@ and @@ are the same search; @@ adds fields', () => {
  // One path, one set of ranking bands. `@`/`@@` pass tier 'title' (so
  // includeAbstract/includeVenue are false); the wide tier passes 'abstract'. Only the
  // FIELDS differ — the ranking is shared.
  const entry = {
    citekey: 'smithMemory2020',
    title: 'Memory and Practice',
    authorText: 'Smith',
    abstract: 'A study of ancestral authority in Senegal.',
    venueText: 'Journal of Memory Studies',
  };

  it('ranks a title match identically whether abstract is searched or not', () => {
    const withoutAbs = scoreEntry(entry, 'memory', {
      includeAbstract: false,
      includeVenue: false,
    });
    const withAbs = scoreEntry(entry, 'memory', {
      includeAbstract: true,
      includeVenue: true,
    });
    expect(withoutAbs.value).toBe(withAbs.value);
  });

  it('only the extra fields differ: abstract/venue matches need the wider tier', () => {
    const narrow = scoreEntry(entry, 'senegal', {
      includeAbstract: false,
      includeVenue: false,
    });
    const wide = scoreEntry(entry, 'senegal', {
      includeAbstract: true,
      includeVenue: true,
    });
    expect(narrow.covered).toBe(0); // not found without them
    expect(wide.covered).toBe(1); // found with them
  });

  it('ranks a citekey the same in both tiers', () => {
    for (const flags of [
      { includeAbstract: false, includeVenue: false },
      { includeAbstract: true, includeVenue: true },
    ]) {
      expect(scoreEntry(entry, 'smithMemory2020', flags).value).toBeLessThan(0);
    }
  });
});

describe('@@ is @ with MORE FIELDS, and the extra fields rank below', () => {
  const rank = (q: string, wide: boolean) => {
    const items = {
      title: { citekey: 'a', title: 'Memory and Practice', authorText: 'Smith', abstract: 'none', venueText: 'none' },
      author: { citekey: 'b', title: 'Other', authorText: 'Memory Smith', abstract: 'none', venueText: 'none' },
      abstract: { citekey: 'c', title: 'Third', authorText: 'Jones', abstract: 'about memory', venueText: 'none' },
      venue: { citekey: 'd', title: 'Fourth', authorText: 'Brown', abstract: 'none', venueText: 'Memory Studies' },
    };
    return Object.entries(items)
      .map(([n, e]) => ({ n, s: scoreEntry(e, q, { includeAbstract: wide, includeVenue: wide }) }))
      .sort((a, b) => a.s.value - b.s.value)
      .map((x) => x.n);
  };

  it('orders title, then author, then the added fields', () => {
    expect(rank('memory', true)).toEqual(['title', 'author', 'abstract', 'venue']);
  });

  it('ranks the @ fields identically whether or not the wider tier is used', () => {
    const narrow = rank('memory', false);
    const wide = rank('memory', true);
    // The `@` fields keep their relative order at the top of the wider list.
    expect(wide.slice(0, 2)).toEqual(narrow.slice(0, 2));
    expect(narrow.slice(0, 2)).toEqual(['title', 'author']);
  });

  it('never ranks an added field above a @ field', () => {
    const wide = rank('memory', true);
    expect(wide.indexOf('title')).toBeLessThan(wide.indexOf('abstract'));
    expect(wide.indexOf('title')).toBeLessThan(wide.indexOf('venue'));
    expect(wide.indexOf('author')).toBeLessThan(wide.indexOf('abstract'));
    expect(wide.indexOf('author')).toBeLessThan(wide.indexOf('venue'));
  });
});

describe('excerptsForResult() — every line', () => {
  it('returns several lines when the terms sit apart (up to maxLines)', () => {
    const para = Array.from({ length: 12 }, (_, i) => `word${i}`).join(' ');
    const abstract = `Alpha ${para}. Beta ${para}. Gamma ${para}.`;
    const lines = excerptsForResult(
      { abstract },
      ['alpha', 'beta', 'gamma'],
      { maxLines: 3 }
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(line.text.length).toBeGreaterThan(0);
  });

  it('merges terms close together into one line', () => {
    const abstract = 'Alpha and beta appear side by side in this short abstract.';
    const lines = excerptsForResult({ abstract }, ['alpha', 'beta'], {
      maxLines: 3,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].matches.length).toBe(2);
  });

  it('excerptForResult is the first line', () => {
    const abstract = 'One alpha here. Two beta there.';
    const all = excerptsForResult({ abstract }, ['alpha', 'beta']);
    expect(excerptForResult({ abstract }, ['alpha', 'beta'])).toEqual(
      all[0] ?? null
    );
  });

  it('returns [] with no terms or no abstract', () => {
    expect(excerptsForResult({ abstract: 'x' }, [])).toEqual([]);
    expect(excerptsForResult({ abstract: null }, ['x'])).toEqual([]);
  });
});
