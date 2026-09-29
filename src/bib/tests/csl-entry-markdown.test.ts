import { cslEntryHtmlToMarkdown } from '../csl-markdown';

// A realistic citeproc output shape: an outer `csl-bib-body` wrapping one or
// more `csl-entry` divs. Chicago author-date italicises book/periodical titles.
const BOOK =
  '<div class="csl-bib-body">\n' +
  '  <div class="csl-entry">Bourdieu, Pierre. 1984. <i>Distinction: A Social Critique of the Judgement of Taste</i>. Cambridge: Harvard University Press.</div>\n' +
  '</div>';

describe('cslEntryHtmlToMarkdown()', () => {
  it('keeps the TITLE from a csl-bib-body wrapper (regression)', () => {
    const md = cslEntryHtmlToMarkdown(BOOK);
    expect(md).toContain('Distinction');
    expect(md).toContain('*Distinction'); // italicised → Markdown
    expect(md).toContain('Bourdieu');
  });

  it('handles a bare csl-entry wrapper', () => {
    const md = cslEntryHtmlToMarkdown(
      '<div class="csl-entry">Smith, John. 1992. <i>A Work</i>.</div>'
    );
    expect(md).toContain('Smith');
    expect(md).toContain('*A Work*');
  });

  it('handles a plain string with no wrapper', () => {
    const md = cslEntryHtmlToMarkdown('Smith, John. 1992. <i>A Work</i>.');
    expect(md).toBe('Smith, John. 1992. *A Work*.');
  });

  it('splits multiple entries onto separate paragraphs', () => {
    const md = cslEntryHtmlToMarkdown(
      '<div class="csl-bib-body">' +
        '<div class="csl-entry">A. 1990. <i>One</i>.</div>' +
        '<div class="csl-entry">B. 1991. <i>Two</i>.</div>' +
        '</div>'
    );
    expect(md).toContain('*One*');
    expect(md).toContain('*Two*');
    expect(md).toContain('\n');
  });

  it('decodes entities and collapses spacing', () => {
    expect(cslEntryHtmlToMarkdown('<div class="csl-entry">A &amp; B</div>')).toBe(
      'A & B'
    );
  });
});
