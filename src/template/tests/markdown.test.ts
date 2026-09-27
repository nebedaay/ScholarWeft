jest.mock(
  'obsidian',
  () => ({
    htmlToMarkdown: jest.fn((html: string) => html),
  }),
  { virtual: true }
);

import { htmlToMarkdown } from 'obsidian';
import {
  escapeMarkdown,
  htmlFieldToMarkdown,
  htmlToMarkdownText,
  normalizeHeadingLevels,
  noteHtmlToMarkdown,
  promoteShortFirstLine,
} from '../markdown';

const mockConvert = htmlToMarkdown as unknown as jest.Mock;

describe('normalizeHeadingLevels()', () => {
  it('demotes a top h1 so it sits under ## Notes (topLevel 3)', () => {
    expect(normalizeHeadingLevels('<h1>One</h1><h2>Two</h2>', 3)).toBe(
      '<h3>One</h3><h4>Two</h4>'
    );
  });

  it('demotes a top h2 by one', () => {
    expect(normalizeHeadingLevels('<h2>Two</h2><h3>Three</h3>', 3)).toBe(
      '<h3>Two</h3><h4>Three</h4>'
    );
  });

  it('leaves a note whose top heading is already at topLevel', () => {
    const html = '<h3>Three</h3><h4>Four</h4>';
    expect(normalizeHeadingLevels(html, 3)).toBe(html);
  });

  it('promotes when the top heading is deeper than topLevel', () => {
    expect(normalizeHeadingLevels('<h4>Four</h4><h5>Five</h5>', 3)).toBe(
      '<h3>Four</h3><h4>Five</h4>'
    );
  });

  it('clamps at h6', () => {
    expect(normalizeHeadingLevels('<h1>A</h1><h6>B</h6>', 3)).toBe(
      '<h3>A</h3><h6>B</h6>'
    );
  });

  it('preserves inline content and returns heading-less HTML unchanged', () => {
    expect(normalizeHeadingLevels('<h1>A <em>x</em></h1>', 3)).toBe(
      '<h3>A <em>x</em></h3>'
    );
    const plain = '<p>No headings</p>';
    expect(normalizeHeadingLevels(plain, 3)).toBe(plain);
    expect(normalizeHeadingLevels('', 3)).toBe('');
  });
});

describe('noteHtmlToMarkdown()', () => {
  beforeEach(() => mockConvert.mockClear());

  it('converts the heading-normalised HTML (default topLevel 3)', () => {
    mockConvert.mockReturnValueOnce('# One');
    const out = noteHtmlToMarkdown('<h1>One</h1>');
    expect(out).toBe('# One');
    expect(mockConvert).toHaveBeenCalledWith('<h3>One</h3>');
  });

  it('honours a custom topLevel', () => {
    mockConvert.mockReturnValueOnce('ok');
    noteHtmlToMarkdown('<h1>One</h1>', { topLevel: 4 });
    expect(mockConvert).toHaveBeenCalledWith('<h4>One</h4>');
  });

  it('returns an empty string without calling the converter for empty input', () => {
    expect(noteHtmlToMarkdown('')).toBe('');
    expect(noteHtmlToMarkdown('   ')).toBe('');
    expect(mockConvert).not.toHaveBeenCalled();
  });

  it('trims the converter output', () => {
    mockConvert.mockReturnValueOnce('  body  \n');
    expect(noteHtmlToMarkdown('<p>x</p>')).toBe('body');
  });

  it('escapes stray [ and < in the converted note, leaving links and & alone', () => {
    mockConvert.mockReturnValueOnce(
      'See [[another note]] and a<b>tag and [a link](https://x.test)\n'
    );
    expect(noteHtmlToMarkdown('<p>x</p>')).toBe(
      'See [[another note]] and a\\<b>tag and [a link](https://x.test)'
    );
  });
});

describe('escapeMarkdown()', () => {
  it('keeps wikilinks and Markdown links, escapes stray [ and <', () => {
    expect(escapeMarkdown('[[x]] and <b> and a & b')).toBe(
      '[[x]] and \\<b> and a & b'
    );
    expect(escapeMarkdown('see [[Note|alias]] and ![[img.png]]')).toBe(
      'see [[Note|alias]] and ![[img.png]]'
    );
    expect(escapeMarkdown('[URL](https://google.com) and ![alt](img.png)')).toBe(
      '[URL](https://google.com) and ![alt](img.png)'
    );
  });

  it('still escapes a bare bracket that opens no link', () => {
    expect(escapeMarkdown('a [sic] note and [text]')).toBe(
      'a \\[sic] note and \\[text]'
    );
  });

  it('leaves already-escaped characters alone', () => {
    expect(escapeMarkdown('\\[x\\] and \\<b>')).toBe('\\[x\\] and \\<b>');
  });

  it('skips inline code spans and fenced blocks', () => {
    expect(escapeMarkdown('a `[x] <y>` b')).toBe('a `[x] <y>` b');
    const fenced = '```\n[a] <b>\n```\n[a]';
    expect(escapeMarkdown(fenced)).toBe('```\n[a] <b>\n```\n\\[a]');
  });
});

describe('htmlFieldToMarkdown()', () => {
  beforeEach(() => mockConvert.mockClear());

  it('converts and escapes a field, and returns empty for nothing', () => {
    mockConvert.mockReturnValueOnce('A [title]');
    expect(htmlFieldToMarkdown('<i>A [title]</i>')).toBe('A \\[title]');
    expect(htmlFieldToMarkdown('')).toBe('');
    expect(htmlFieldToMarkdown(null)).toBe('');
  });

  it('htmlToMarkdownText converts WITHOUT escaping (frontmatter use)', () => {
    mockConvert.mockReturnValueOnce('A [title]');
    expect(htmlToMarkdownText('<i>A [title]</i>')).toBe('A [title]');
    expect(htmlToMarkdownText('')).toBe('');
  });
});

describe('promoteShortFirstLine()', () => {
  it('turns a short single first line into a heading at the level', () => {
    expect(promoteShortFirstLine('Notes on women\n\nBody', 3)).toBe(
      '### Notes on women\n\nBody'
    );
    expect(promoteShortFirstLine('Wird', 2)).toBe('## Wird');
  });

  it('leaves long, multi-line, or already-structured first blocks alone', () => {
    const long = 'x'.repeat(101);
    expect(promoteShortFirstLine(`${long}\n\nBody`, 3)).toBe(`${long}\n\nBody`);
    expect(promoteShortFirstLine('line one\nline two\n\nBody', 3)).toBe(
      'line one\nline two\n\nBody'
    );
    expect(promoteShortFirstLine('## Already\n\nBody', 3)).toBe(
      '## Already\n\nBody'
    );
    expect(promoteShortFirstLine('- item\n\nBody', 3)).toBe('- item\n\nBody');
    expect(promoteShortFirstLine('> quote\n\nBody', 3)).toBe('> quote\n\nBody');
  });

  it('respects a custom max length and empty input', () => {
    expect(promoteShortFirstLine('abcd\n\nB', 3, 3)).toBe('abcd\n\nB');
    expect(promoteShortFirstLine('abc\n\nB', 3, 3)).toBe('### abc\n\nB');
    expect(promoteShortFirstLine('', 3)).toBe('');
  });
});
