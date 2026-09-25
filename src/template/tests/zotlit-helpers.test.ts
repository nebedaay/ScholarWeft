jest.mock(
  'obsidian',
  () => ({ htmlToMarkdown: (html: string) => html }),
  { virtual: true }
);

import {
  basename,
  coerceOutput,
  embed,
  filenameSuffix,
  hasSuffixMarker,
  replaceSuffixMarkers,
} from '../zotlit-helpers';
import { makeEta } from '../engine';

describe('basename()', () => {
  it('takes the final segment and strips the extension', () => {
    expect(basename('a/b/c.md')).toBe('c');
    expect(basename('c.md')).toBe('c');
    expect(basename('a/b/', '')).toBe('b');
    expect(basename('/a/b/c')).toBe('c'); // no matching ext → unchanged
  });

  it('matches ZotLit edge cases', () => {
    expect(basename('/')).toBe('/');
    expect(basename('.md')).toBe('');
    expect(basename('.md', '.md')).toBe('');
  });
});

describe('embed()', () => {
  it('prefixes ! and collapses a missing/empty link', () => {
    expect(embed(() => '[[img.png]]')).toBe('![[img.png]]');
    expect(embed(() => '')).toBe('');
    expect(embed(null)).toBe('');
    expect(embed(undefined)).toBe('');
  });

  it('forwards alias and subpath', () => {
    expect(embed((alias, subpath) => `[[x|${alias}#${subpath}]]`, 'view', 'top')).toBe(
      '![[x|view#top]]'
    );
  });
});

describe('filenameSuffix() / markers', () => {
  it('emits a marker carrying length and affixes', () => {
    expect(filenameSuffix()).toBe('%zt-suffix:6:_:%');
    expect(filenameSuffix(4, '-', 'X')).toBe('%zt-suffix:4:-:X%');
  });

  it('rejects out-of-range lengths and illegal affixes', () => {
    expect(() => filenameSuffix(0)).toThrow(/1\.\.64/);
    expect(() => filenameSuffix(65)).toThrow(/1\.\.64/);
    expect(() => filenameSuffix(6, 'a:b')).toThrow(/prepend/);
    expect(() => filenameSuffix(6, '_', 'a%')).toThrow(/append/);
  });

  it('detects and replaces markers', () => {
    const rendered = 'Note%zt-suffix:6:_:%';
    expect(hasSuffixMarker(rendered)).toBe(true);
    expect(hasSuffixMarker('Note')).toBe(false);
    expect(replaceSuffixMarkers(rendered, (s) => `${s.prepend}ABC`)).toBe('Note_ABC');
    expect(replaceSuffixMarkers(rendered, () => '')).toBe('Note');
  });
});

describe('coerceOutput()', () => {
  it('coerces null/undefined to empty and Dates to ISO', () => {
    expect(coerceOutput(null)).toBe('');
    expect(coerceOutput(undefined)).toBe('');
    expect(coerceOutput(new Date('2022-02-12T00:00:00Z'))).toBe('2022-02-12T00:00:00.000Z');
    expect(coerceOutput(5)).toBe('5');
    expect(coerceOutput('x')).toBe('x');
  });
});

describe('NoteTemplateEngine helper globals', () => {
  it('exposes bq/basename/suffix/embed as globals', () => {
    const eta = makeEta();
    const out = eta.renderString(
      '<%= basename("a/b/c.md") %>|<%= suffix(4, "-", "") %>|<%~ embed(() => "[[x]]") %>',
      {}
    );
    expect(out).toContain('c');
    expect(out).toContain('%zt-suffix:4:-:%');
    expect(out).toContain('![[x]]');
  });

  it('wraps captured output in blockquotes via bq', () => {
    const eta = makeEta();
    const out = eta.renderString('<% bq(() => { -%>\nhello\n<% }) %>', {});
    expect(out).toContain('> hello');
  });
});
