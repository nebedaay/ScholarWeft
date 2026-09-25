import {
  extraKeyToContextProperty,
  extraKeyToCslField,
  parseExtra,
} from '../extra';

describe('parseExtra()', () => {
  it('returns null for absent or empty extra', () => {
    expect(parseExtra(null)).toBeNull();
    expect(parseExtra(undefined)).toBeNull();
    expect(parseExtra('')).toBeNull();
    expect(parseExtra('   \n  ')).toBeNull();
  });

  it('parses a simple key: value pair', () => {
    const e = parseExtra('Publisher: Routledge')!;
    expect(e.fields).toEqual({ Publisher: 'Routledge' });
    expect(e.lines[0]).toMatchObject({ key: 'Publisher', value: 'Routledge' });
  });

  // Real values seen in the library.
  it('parses real-world pairs, including keys with hyphens and spaces', () => {
    const e = parseExtra(
      [
        'Google-Books-ID: q7F6LWP9z9QC',
        'Number: 2',
        'Page Version ID: 628173788',
        'tex.mendeley-tags: foo,bar',
      ].join('\n')
    )!;
    expect(e.fields).toEqual({
      'Google-Books-ID': 'q7F6LWP9z9QC',
      Number: '2',
      'Page Version ID': '628173788',
      'tex.mendeley-tags': 'foo,bar',
    });
  });

  it('keeps prose and HTML verbatim as text rows', () => {
    const e = parseExtra('<p>Volume 29, Number 2, Fall 2013</p>')!;
    expect(e.fields).toEqual({});
    expect(e.lines).toEqual([
      { raw: '<p>Volume 29, Number 2, Fall 2013</p>', key: null },
    ]);
  });

  it('treats citeproc cheater syntax ({:field:}) as a text row, not a pair', () => {
    // A key must start with an ASCII letter, so `{` disqualifies it. This is
    // the "field present but empty" case, which carries no value to expose.
    const e = parseExtra('{:original-date:}')!;
    expect(e.fields).toEqual({});
    expect(e.lines[0]).toEqual({ raw: '{:original-date:}', key: null });
  });

  it('splits on the FIRST colon and keeps later colons in the value', () => {
    const e = parseExtra('URL: https://example.com:8080/a')!;
    expect(e.fields.URL).toBe('https://example.com:8080/a');
  });

  it('splits on `=` as well as `:`', () => {
    const e = parseExtra('Original Date=1950')!;
    expect(e.fields).toEqual({ 'Original Date': '1950' });
  });

  it('treats a line with an empty value as a text row', () => {
    const e = parseExtra('Publisher:')!;
    expect(e.fields).toEqual({});
    expect(e.lines[0].key).toBeNull();
  });

  it('applies first-wins to a repeated key, and keeps every row in lines', () => {
    const e = parseExtra('Publisher: A\nPublisher: B')!;
    expect(e.fields.Publisher).toBe('A');
    expect(e.lines).toHaveLength(2);
    expect(e.lines.map((l) => (l.key ? l.value : null))).toEqual(['A', 'B']);
  });

  it('preserves the raw text for a round-trip', () => {
    const raw = 'Publisher: Routledge\n\nsome prose';
    expect(parseExtra(raw)!.raw).toBe(raw);
  });

  it('handles a real multi-pair line (one pair, later colons kept)', () => {
    // Seen from an importer: several `key: value` fragments joined by " / ".
    const e = parseExtra(
      'ArticleType: primary_article / Full publication date: Mar., 1999'
    )!;
    expect(e.fields.ArticleType).toBe(
      'primary_article / Full publication date: Mar., 1999'
    );
  });
});

describe('extraKeyToCslField()', () => {
  it('normalises case and spaces to a CSL field name', () => {
    expect(extraKeyToCslField('original-date')).toBe('original-date');
    expect(extraKeyToCslField('Original Date')).toBe('original-date');
    expect(extraKeyToCslField('Original Publisher Place')).toBe(
      'original-publisher-place'
    );
  });

  it('uppercases the acronym fields', () => {
    expect(extraKeyToCslField('doi')).toBe('DOI');
    expect(extraKeyToCslField('ISBN')).toBe('ISBN');
    expect(extraKeyToCslField('url')).toBe('URL');
  });

  it('maps Archive Location to the underscored CSL name', () => {
    expect(extraKeyToCslField('Archive Location')).toBe('archive_location');
  });

  it('returns null for a custom (non-CSL) key', () => {
    expect(extraKeyToCslField('musical-style')).toBeNull();
    expect(extraKeyToCslField('Google-Books-ID')).toBeNull();
  });
});

describe('extraKeyToContextProperty()', () => {
  it('converts a CSL field to the camelCase context property', () => {
    expect(extraKeyToContextProperty('original-date')).toBe('originalDate');
    expect(extraKeyToContextProperty('Original Date')).toBe('originalDate');
    expect(extraKeyToContextProperty('original-publisher-place')).toBe(
      'originalPublisherPlace'
    );
  });

  it('keeps acronyms uppercase', () => {
    expect(extraKeyToContextProperty('doi')).toBe('DOI');
    expect(extraKeyToContextProperty('url')).toBe('URL');
  });

  it('converts the underscored field', () => {
    expect(extraKeyToContextProperty('Archive Location')).toBe(
      'archiveLocation'
    );
  });

  it('returns null for a custom key (those stay in extra.fields)', () => {
    expect(extraKeyToContextProperty('musical-style')).toBeNull();
    expect(extraKeyToContextProperty('Google-Books-ID')).toBeNull();
  });
});
