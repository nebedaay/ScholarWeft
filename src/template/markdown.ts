// Zotero note-body conversion for the single-file note template.
//
// Zotero stores child notes as HTML (a constrained subset: headings,
// paragraphs, lists, `b`/`i`/`sub`/`sup`, links, blockquotes, `pre`/`code`).
// Obsidian already ships an HTML→Markdown converter — `htmlToMarkdown()`, the
// same one the plugin's "insert bibliography" command uses — so we do NOT
// hand-roll one or pull in a dependency.
//
// The one thing Obsidian cannot know is where the note will sit: under a
// `## Notes` heading the note's own headings must be demoted so they nest
// beneath it. We do that on the parsed DOM before conversion, so the shift is
// exact and never confuses a `#` that is part of the note's prose.

import { htmlToMarkdown } from 'obsidian';

/** Heading tag name → its level, e.g. `H3` → 3. */
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

const FENCE_RE = /^\s*(?:```|~~~)/;
const CODE_SPAN_OR_ESCAPABLE_RE = /(`+[^`]*`+)|((?<!\\)[\[<])/g;

function escapeOutsideCode(line: string): string {
  return line.replace(
    CODE_SPAN_OR_ESCAPABLE_RE,
    (match, code: string | undefined, char: string | undefined) =>
      code ?? `\\${char}`
  );
}

/**
 * Escape the characters that would otherwise change meaning in Markdown:
 * `[` (could open a link or, doubled, a wikilink) and `<` (could open an HTML
 * tag). Already-escaped occurrences are left alone, and `&` is untouched — it
 * only matters as part of an HTML entity, which the parser has already
 * resolved. Fenced and inline code are skipped so their contents stay literal.
 */
export function escapeMarkdown(text: string): string {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : escapeOutsideCode(line);
    })
    .join('\n');
}

/**
 * Shift every heading in an HTML fragment so the shallowest heading ends up at
 * `topLevel` (the others keep their relative depth; levels clamp to 1–6).
 *
 * With `topLevel = 3` (one under a `## Notes` heading): a note whose top
 * heading is `<h1>` has its `<h1>`→`<h3>` and `<h2>`→`<h4>`; a note whose top
 * heading is already `<h2>` has `<h2>`→`<h3>`. A note with no headings is
 * returned unchanged.
 */
export function normalizeHeadingLevels(html: string, topLevel: number): string {
  if (!html.trim()) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const headings: HTMLElement[] = [];
  for (const tag of HEADING_TAGS) {
    headings.push(...Array.from(doc.body.getElementsByTagName(tag)));
  }
  if (headings.length === 0) return html;

  let min = Number.POSITIVE_INFINITY;
  const levelOf = new Map<HTMLElement, number>();
  for (const h of headings) {
    const level = Number(h.tagName.charAt(1));
    levelOf.set(h, level);
    if (level < min) min = level;
  }

  const delta = topLevel - min;
  if (delta === 0) return html;

  for (const h of headings) {
    const level = Math.min(6, Math.max(1, (levelOf.get(h) ?? min) + delta));
    const replacement = doc.createElement(`h${level}`);
    replacement.innerHTML = h.innerHTML;
    h.replaceWith(replacement);
  }

  return doc.body.innerHTML;
}

/**
 * Convert one of Zotero's HTML-capable text fields (title, abstract, `extra`…)
 * to Markdown WITHOUT escaping — for frontmatter, where property values
 * legitimately contain `[[wikilinks]]` and where `[` / `<` display fine. The
 * HTML parser also resolves entities to their unicode characters.
 */
export function htmlToMarkdownText(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  return htmlToMarkdown(html).trim();
}

/**
 * Convert an HTML field to Markdown for BODY output: same conversion, then the
 * shared {@link escapeMarkdown} so stray `[` / `<` can't become a link or tag.
 */
export function htmlFieldToMarkdown(html: string | null | undefined): string {
  return escapeMarkdown(htmlToMarkdownText(html));
}

export interface NoteMarkdownOptions {
  /** Level the note's shallowest heading should end up at. Default 3 (`###`). */
  topLevel?: number;
}

/**
 * Convert a Zotero note's HTML to Markdown with its headings normalised under
 * the note's own section (default `topLevel` 3, i.e. one below `## Notes`) and
 * stray Markdown characters escaped.
 */
export function noteHtmlToMarkdown(
  html: string,
  opts: NoteMarkdownOptions = {}
): string {
  if (!html || !html.trim()) return '';
  const topLevel = opts.topLevel ?? 3;
  return escapeMarkdown(htmlToMarkdown(normalizeHeadingLevels(html, topLevel)).trim());
}
