import {
  YamlBuilder,
  buildYaml,
  needsQuotes,
  serializeProperty,
} from '../yaml';

describe('needsQuotes()', () => {
  it('quotes only what YAML would otherwise misread', () => {
    expect(needsQuotes('Bughyat al-mustafīd')).toBe(false);
    expect(needsQuotes('smith2020')).toBe(false);
    expect(needsQuotes('Dār al-Jīl')).toBe(false);
    expect(needsQuotes('A: B')).toBe(true); // colon-space
    expect(needsQuotes('a #tag')).toBe(true); // space-hash
    expect(needsQuotes('[[Dār al-Jīl]]')).toBe(true); // leading indicator
    expect(needsQuotes('2005')).toBe(true); // number-looking string
    expect(needsQuotes('true')).toBe(true);
    expect(needsQuotes('')).toBe(true);
    expect(needsQuotes(' padded ')).toBe(true);
    expect(needsQuotes('say "hi"')).toBe(true);
  });

  it('honours explicit always/never', () => {
    expect(needsQuotes('plain', 'always')).toBe(true);
    expect(needsQuotes('A: B', 'never')).toBe(false);
  });
});

describe('serializeProperty()', () => {
  it('omits empty values by default and emits them when forced', () => {
    expect(serializeProperty('x', undefined)).toEqual([]);
    expect(serializeProperty('x', null)).toEqual([]);
    expect(serializeProperty('x', '')).toEqual([]);
    expect(serializeProperty('x', [])).toEqual([]);
    expect(serializeProperty('x', '', { force: true })).toEqual(['x: ""']);
    expect(serializeProperty('x', [], { force: true })).toEqual(['x: []']);
  });

  it('serialises scalars with Obsidian-style minimal quoting', () => {
    expect(serializeProperty('title', 'Bughyat al-mustafīd')).toEqual([
      'title: Bughyat al-mustafīd',
    ]);
    expect(serializeProperty('publisher', '[[Dār al-Jīl]]')).toEqual([
      'publisher: "[[Dār al-Jīl]]"',
    ]);
    expect(serializeProperty('year', 2005)).toEqual(['year: 2005']);
    expect(serializeProperty('year', '2005')).toEqual(['year: "2005"']);
    expect(serializeProperty('flag', true)).toEqual(['flag: true']);
  });

  it('serialises a list with two-space indentation', () => {
    expect(serializeProperty('up', ['[[Bibliographic Notes]]'])).toEqual([
      'up:',
      '  - "[[Bibliographic Notes]]"',
    ]);
    expect(serializeProperty('authors', ['[[Smith, Jane]]', '[[Lee, Ada]]'])).toEqual([
      'authors:',
      '  - "[[Smith, Jane]]"',
      '  - "[[Lee, Ada]]"',
    ]);
  });

  it('serialises a multi-line value as an unquoted |- block scalar', () => {
    expect(serializeProperty('abstract', 'First line.\nSecond line.')).toEqual([
      'abstract: |-',
      '  First line.',
      '  Second line.',
    ]);
    // A blank line is preserved; no surrounding quotes, ever.
    expect(serializeProperty('abstract', 'One.\n\nTwo.')).toEqual([
      'abstract: |-',
      '  One.',
      '',
      '  Two.',
    ]);
  });

  it('quotes a key only when it is not plain-safe', () => {
    expect(serializeProperty('title-short', 'x')).toEqual(['title-short: x']);
    expect(serializeProperty('has space', 'x')).toEqual(['"has space": x']);
  });
});

describe('YamlBuilder', () => {
  it('preserves insertion order and wraps the block in --- delimiters', () => {
    const out = buildYaml([
      ['document-type', '[[zotero-import]]'],
      ['title', 'A Book'],
      ['year', '2005'],
    ]);
    expect(out).toBe(
      ['---', 'document-type: "[[zotero-import]]"', 'title: A Book', 'year: "2005"', '---', ''].join(
        '\n'
      )
    );
  });

  it('skips an absent optional property without leaving a blank line', () => {
    const b = new YamlBuilder();
    b.start();
    b.add('title', 'A Book');
    b.add('series', undefined); // optional, absent
    b.add('publisher', 'Praeger');
    expect(b.end()).toBe(['---', 'title: A Book', 'publisher: Praeger', '---', ''].join('\n'));
  });

  it('supports the raw escape hatch', () => {
    const b = new YamlBuilder();
    b.start();
    b.addRaw('related:\n  - "[[@a]]"\n');
    expect(b.end()).toBe(['---', 'related:', '  - "[[@a]]"', '---', ''].join('\n'));
  });

  it('fails loudly on misuse', () => {
    const b = new YamlBuilder();
    expect(() => b.add('x', 'y')).toThrow(/outside start_YAML/);
    expect(() => b.end()).toThrow(/without start_YAML/);
    b.start();
    expect(() => b.start()).toThrow(/twice/);
    b.end();
    expect(() => b.start()).toThrow(/after end_YAML/);
    expect(() => b.add('x', 'y')).toThrow(/outside start_YAML/);
  });

  it('rejects an empty property key', () => {
    const b = new YamlBuilder();
    b.start();
    expect(() => b.add('  ', 'x')).toThrow(/non-empty key/);
  });
});
