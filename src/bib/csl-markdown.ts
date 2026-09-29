/**
 * Convert a citeproc bibliography entry (HTML) to Markdown.
 *
 * citeproc emits an entry wrapped one of three ways, depending on the call:
 *   - a bare string (already unwrapped),
 *   - `<div class="csl-entry">…</div>` (one entry),
 *   - `<div class="csl-bib-body">…<div class="csl-entry">…</div>…</div>` (a whole
 *     bibliography).
 *
 * The wrapper MUST be removed before tag-stripping, or the `<i>`-italicised
 * TITLE is lost along with the tags — the regression this module's test pins.
 *
 * Kept dependency-free (no Obsidian, no bibtex parser) so it is trivially
 * testable and can be reused by any rendering path.
 */
export function cslEntryHtmlToMarkdown(html: string): string {
  let s = html.trim();

  const unwrap = (re: RegExp) => {
    const m = re.exec(s);
    if (m) s = m[1];
  };
  unwrap(
    /^<div\b[^>]*class="[^"]*\bcsl-bib-body\b[^"]*"[^>]*>([\s\S]*)<\/div>\s*$/i
  );
  unwrap(
    /^<div\b[^>]*class="[^"]*\bcsl-entry\b[^"]*"[^>]*>([\s\S]*)<\/div>\s*$/i
  );

  // Inline emphasis → Markdown, BEFORE stripping tags.
  s = s
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');

  // Each entry is its own paragraph in a multi-entry bibliography.
  s = s.replace(/<\/div>\s*<div\b[^>]*>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');

  const txt = document.createElement('textarea');
  txt.innerHTML = s;
  return txt.value
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
