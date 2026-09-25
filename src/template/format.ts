// Formatters behind the template helpers: creators and callouts.
//
// These are pure (no Obsidian, no I/O) so a template can delegate all the
// whitespace-sensitive Markdown to code. `renderAnnotationCallout()` reproduces
// the current `sw-note-templates/zotlit-annotation.eta.md` output exactly — the
// parity is enforced by a test that renders the real template and compares — so
// moving a note template onto the helpers does not change its output.

import { formatBlockquote } from './blockquote';
import type {
  NoteContextAnnotation,
  NoteContextCreator,
  NoteContextTag,
} from './context';

// ─── Creators ───────────────────────────────────────────────────────────────

export interface CreatorFormatOptions {
  /** Wrap each formatted name in `[[…]]`. Default true (frontmatter style). */
  link?: boolean;
  /** Restrict/order the roles; unlisted roles still follow, first-seen. */
  roles?: string[];
  /** Property-name suffix. Default `s` (→ `authors`, `editors`). */
  suffix?: string;
}

export interface CreatorGroup {
  /** Frontmatter property name, e.g. `authors`. */
  key: string;
  /** Formatted, non-empty names for that property. */
  values: string[];
}

/**
 * Format one creator with a token template. Tokens: `{family}`, `{given}`,
 * `{literal}`, `{role}`, `{fullName}`. With no template, a literal name uses
 * `{literal}` and a personal name `{family}, {given}`; a missing token leaves no
 * dangling separator.
 */
export function formatCreator(
  creator: NoteContextCreator,
  format?: string,
  link = false
): string {
  const fmt =
    format ?? (creator.literal ? '{literal}' : '{family}, {given}');
  let out = fmt.replace(
    /\{(family|given|literal|role|fullName)\}/g,
    (_m, token: keyof NoteContextCreator) =>
      String(creator[token] ?? '')
  );
  out = out.replace(/\s+/g, ' ').trim();
  // Drop a separator orphaned by an empty token (`{family}, {given}` with no
  // given → "Smith," → "Smith"; no family → ", Jane" → "Jane").
  out = out.replace(/^[,;]+|[,;]+$/g, '').trim();
  if (link && out) out = `[[${out}]]`;
  return out;
}

/**
 * One property per Zotero `creatorType` present, in first-seen order (or
 * `opts.roles` first, then the rest). The order of the keys is the only thing
 * the role-grouped cache can't reproduce exactly; see the skill.
 */
export function groupCreatorsByType(
  creators: NoteContextCreator[],
  format?: string,
  opts: CreatorFormatOptions = {}
): CreatorGroup[] {
  const link = opts.link !== false;
  const suffix = opts.suffix ?? 's';
  const groups = new Map<string, string[]>();
  const add = (c: NoteContextCreator) => {
    const name = formatCreator(c, format, link);
    if (!name) return;
    const values = groups.get(c.role);
    if (values) values.push(name);
    else groups.set(c.role, [name]);
  };

  const orderedRoles = opts.roles ? [...opts.roles] : [];
  for (const role of orderedRoles) {
    for (const c of creators) if (c.role === role) add(c);
  }
  for (const c of creators) {
    if (!orderedRoles.includes(c.role)) add(c);
  }

  return [...groups].map(([role, values]) => ({ key: `${role}${suffix}`, values }));
}

export interface CreatorNamesOptions {
  /** A role, or several, to include. Default: every creator. */
  roles?: string | string[];
  /** Wrap in `[[…]]`. Default false. */
  link?: boolean;
  /** Token template; see {@link formatCreator}. */
  format?: string;
  /** Separator. Default `, `. */
  join?: string;
}

/** A formatted creator string for body use (as opposed to frontmatter lists). */
export function creatorNames(
  creators: NoteContextCreator[],
  opts: CreatorNamesOptions = {}
): string {
  const roles = opts.roles
    ? Array.isArray(opts.roles)
      ? opts.roles
      : [opts.roles]
    : null;
  const list = roles ? creators.filter((c) => roles.includes(c.role)) : creators;
  return list
    .map((c) => formatCreator(c, opts.format, opts.link ?? false))
    .filter(Boolean)
    .join(opts.join ?? ', ');
}

// ─── Callouts ───────────────────────────────────────────────────────────────

function cap(s: string | null | undefined): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Escape HTML special characters for Markdown text. */
export function escapeAnnotationHtml(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape annotation TEXT: HTML first, then Markdown brackets. */
export function escapeAnnotationText(s: string | null | undefined): string {
  return escapeAnnotationHtml(s).replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/** Zotero comments are "plain text flavoured with `<i>`/`<b>`". */
export function mdComment(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<i>/g, '*')
    .replace(/<\/i>/g, '*')
    .replace(/<b>/g, '**')
    .replace(/<\/b>/g, '**')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Every line (including blanks) gets a `>` so content stays in the callout. */
function calloutLines(s: string | null | undefined): string[] {
  return (s ?? '').split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : '>'));
}

/** Obsidian embed for a link helper's result (`[[x]]` → `![[x]]`). */
function embed(link: string | null): string | null {
  return link ? `!${link}` : null;
}

/** `2022-02-12T17:19:53Z` renders as the date alone, as Zotero shows it. */
export function displayDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return m ? m[1] : value;
}

function imgUrl(a: NoteContextAnnotation): string | null {
  return typeof a.imgLink === 'function' ? a.imgLink() : null;
}

function imgAlias(a: NoteContextAnnotation, alias: string): string | null {
  return typeof a.imgLink === 'function' ? a.imgLink(alias) : null;
}

export interface AnnotationCalloutOptions {
  /** Include the annotation's tags as `[[tag]]` lines. Default true. */
  tags?: boolean;
  /** Include the colour/page/date footer lines. Default true. */
  footer?: boolean;
}

/**
 * Render one annotation as a callout block: the current annotation template's
 * output, produced from code. The result is the final Markdown (already
 * blockquote-prefixed), ready to be emitted.
 */
export function renderAnnotationCallout(
  a: NoteContextAnnotation,
  opts: AnnotationCalloutOptions = {}
): string {
  const includeTags = opts.tags !== false;
  const includeFooter = opts.footer !== false;

  const colorRaw = a.colorName ?? 'yellow';
  const colorCap = cap(colorRaw);
  const typeCap = cap(a.type);
  const tags: NoteContextTag[] = includeTags ? (a.tags ?? []) : [];

  const inner: string[] = [
    `[!${colorRaw}-${a.type}-annotation] ${colorCap} ${typeCap}`,
  ];

  if (a.comment || tags.length) {
    inner.push('> [!ann-comment]');
    if (a.comment) inner.push(...calloutLines(mdComment(a.comment)));
    for (const tag of tags) inner.push(`> - [[${tag.name}]]`);
  }

  inner.push('');

  if (a.type === 'highlight' && a.text) {
    inner.push(`> [!ann-highlight-text-${colorRaw}]`, `> ${escapeAnnotationText(a.text)}`);
  } else if (a.type === 'underline' && a.text) {
    inner.push(`> [!ann-underline-text-${colorRaw}]`, `> ${escapeAnnotationText(a.text)}`);
  } else if (a.type === 'image') {
    inner.push(`> [!ann-image-${colorRaw}]`);
    const url = imgUrl(a);
    if (url) inner.push(`> ${embed(url)}`);
    const view = imgAlias(a, 'view image');
    if (view) inner.push(`> - ${view}`);
    inner.push('> - [[image annotations|images]]');
  } else if (a.type === 'text' || a.type === 'note') {
    inner.push(`> [!ann-text-${colorRaw}]Text comment—click to view in context:`);
    if (a.comment) inner.push(...calloutLines(mdComment(a.comment)));
  } else if (a.type === 'ink') {
    inner.push(`> [!ann-ink-${colorRaw}]`);
    const url = imgUrl(a);
    if (url) inner.push(`> ${embed(url)}`);
    const view = imgAlias(a, 'view ink image');
    if (view) inner.push(`> - ${view}`);
  }

  if (includeFooter) {
    inner.push(`- [[${colorCap} annotations|${colorCap}]]`);
    const page = a.pageLabel
      ? `[${a.pageLabel.includes('–') ? 'pp. ' : 'p. '}${a.pageLabel}](${a.backlink})`
      : `[View](${a.backlink})`;
    inner.push(`- (${page}, ${displayDate(a.dateAdded)})`);
  }

  return formatBlockquote(inner.join('\n'));
}

export interface CalloutOptions {
  /** Callout id, e.g. `note` or `Yellow-highlight-annotation`. */
  type: string;
  title?: string;
  /** May be multi-line. */
  body?: string;
  /** Render collapsible (`[!type]-`). */
  collapse?: boolean;
}

/** Render a generic top-level callout. */
export function renderCallout(opts: CalloutOptions): string {
  const head = `[!${opts.type}]${opts.collapse ? '-' : ''}${
    opts.title ? ` ${opts.title}` : ''
  }`;
  // The body is ordinary Markdown; formatBlockquote adds the `>` prefix.
  const body = (opts.body ?? '').split(/\r?\n/);
  return formatBlockquote([head, ...body].join('\n'));
}
