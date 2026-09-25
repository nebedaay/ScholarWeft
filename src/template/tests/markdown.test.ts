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
  normalizeHeadingLevels,
  noteHtmlToMarkdown,
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

  it('escapes stray [ and < in the converted note, leaving & alone', () => {
    mockConvert.mockReturnValueOnce('See [[another note]] and a<b>tag\n');
    expect(noteHtmlToMarkdown('<p>x</p>')).toBe(
      'See \\[\\[another note]] and a\\<b>tag'
    );
  });
});

describe('escapeMarkdown()', () => {
  it('escapes [ and < but not &', () => {
    expect(escapeMarkdown('[[x]] and <b> and a & b')).toBe(
      '\\[\\[x]] and \\<b> and a & b'
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
});
