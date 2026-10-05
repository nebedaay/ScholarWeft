// Re-import merge: refresh what the template owns, leave everything else.
//
// The model is ZotLit's, renamed to our namespace. Two independent mechanisms:
//
//   1. FRONTMATTER — only the properties the template declares are touched, each
//      with its merge strategy (`replace`/`append`/`keep`). Every other property
//      is preserved verbatim, including the user's own fields and ordering.
//   2. MANAGED REGION — the template wraps its generated body in
//      `%%sw-managed%%` … `%%/sw-managed%%`. An update replaces exactly that
//      span; text above AND BELOW it is the user's and is never touched. (ZotLit
//      only documents writing above; allowing content after the region is our
//      deliberate difference.)
//
// A pre-existing ZotLit region (`%%zt-managed%%`) is recognised as the region to
// CONVERT: it is replaced by ours (or removed), so importing a ZotLit note with
// our template takes it over in place instead of appending a second region.
//
// This module is pure and line-based: it preserves the raw text of untouched
// properties, and never re-serialises the whole file through a YAML dump (which
// would reorder keys and drop comments).

import type { YamlFieldSpec, FrontmatterMerge } from './yaml';

/** Region markers. OUR namespace. */
export const MANAGED_OPEN = '%%sw-managed%%';
export const MANAGED_CLOSE = '%%/sw-managed%%';

/** ZotLit's region markers, recognised so a ZotLit note can be CONVERTED. */
export const ZOTLIT_MANAGED_OPEN = '%%zt-managed%%';
export const ZOTLIT_MANAGED_CLOSE = '%%/zt-managed%%';

const REGION_MARKERS: ReadonlyArray<readonly [string, string]> = [
  [MANAGED_OPEN, MANAGED_CLOSE],
  [ZOTLIT_MANAGED_OPEN, ZOTLIT_MANAGED_CLOSE],
];

export interface SplitNote {
  /** The frontmatter body (between the `---` fences), or `null` if none. */
  frontmatter: string | null;
  /** Everything after the closing fence (or the whole text if no frontmatter). */
  body: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Split a note into its frontmatter body and everything after it. */
export function splitNote(content: string): SplitNote {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: content.slice(m[0].length) };
}

/** Reassemble a note from a frontmatter body (without fences) and a body. */
export function joinNote(frontmatter: string, body: string): string {
  const fm = frontmatter.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  return `---\n${fm}\n---\n${body}`;
}

/** One parsed frontmatter property: its key and raw lines (kept verbatim). */
export interface FrontmatterProperty {
  key: string;
  lines: string[];
}

/** A top-level `key:` line (not indented, not a comment). */
const KEY_RE = /^([A-Za-z0-9_][^:\n]*?)[ \t]*:(?:[ \t]|$)/;

function unquoteKey(key: string): string {
  const k = key.trim();
  if (k.length >= 2 && ((k[0] === '"' && k.endsWith('"')) || (k[0] === "'" && k.endsWith("'")))) {
    return k.slice(1, -1);
  }
  return k;
}

/**
 * Parse frontmatter into ordered properties. Indented lines (list items, block
 * scalars) attach to the preceding key; a leading comment/blank is preserved as
 * a key-less block so it round-trips.
 */
export function parseFrontmatter(frontmatter: string): FrontmatterProperty[] {
  const props: FrontmatterProperty[] = [];
  let current: FrontmatterProperty | null = null;
  for (const line of frontmatter.replace(/\r\n?/g, '\n').split('\n')) {
    const m = !/^[ \t]/.test(line) ? KEY_RE.exec(line) : null;
    if (m) {
      if (current) props.push(current);
      current = { key: unquoteKey(m[1]), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      props.push({ key: '', lines: [line] });
    }
  }
  if (current) props.push(current);
  return props;
}

function isListBlock(lines: string[]): boolean {
  return (
    lines.length >= 1 &&
    /:[ \t]*$/.test(lines[0]) &&
    lines.slice(1).length > 0 &&
    lines.slice(1).every((l) => /^[ \t]*-[ \t]/.test(l))
  );
}

/**
 * Union two list blocks: existing items first (order preserved), then generated
 * items that aren't already present. Never removes anything.
 */
function appendListItems(existing: string[], generated: string[]): string[] {
  const head = existing[0] ?? generated[0];
  const seen = new Set(existing.slice(1).map((l) => l.trim()));
  const out = [...existing.slice(1)];
  for (const item of generated.slice(1)) {
    if (seen.has(item.trim())) continue;
    seen.add(item.trim());
    out.push(item);
  }
  return [head, ...out];
}

/**
 * Drop existing items that the generated list also contains, WITHOUT adding any
 * of the generated items. Used to clean up a value that a previous version
 * wrote into the wrong property: the duplicate is removed from here because it
 * now lives (and is maintained) in the other property.
 *
 * Nothing is added, so a note can only ever lose items it already shared with
 * the generated list — and only the ones the template explicitly claims.
 */
function subtractListItems(existing: string[], generated: string[]): string[] {
  const head = existing[0] ?? generated[0];
  const claimed = new Set(generated.slice(1).map((l) => l.trim()));
  const kept = existing.slice(1).filter((l) => !claimed.has(l.trim()));
  return [head, ...kept];
}

function reconcile(
  merge: FrontmatterMerge,
  existing: string[] | undefined,
  generated: string[]
): string[] {
  const has = !!existing && existing.length > 0;
  switch (merge) {
    case 'keep':
      return has ? existing! : generated;
    case 'append':
      if (!has) return generated;
      if (isListBlock(existing!) && isListBlock(generated)) {
        return appendListItems(existing!, generated);
      }
      // Shape mismatch (e.g. a scalar where a list is rendered): fall back to
      // letting the template win rather than corrupting the existing value.
      return generated;
    case 'subtract':
      // Migration only: remove duplicates of a list that a DIFFERENT property
      // now owns, and add nothing. `migrateFromKey` names that property, whose
      // spec is resolved by the caller (it holds the freshly-rendered items).
      // When the note had nothing, fall back to the existing value: the Zotero
      // list lives in the owning property, so `related` stays the user's.
      if (!has) return existing ?? [];
      if (isListBlock(existing!) && isListBlock(generated)) {
        return subtractListItems(existing!, generated);
      }
      return existing!;
    case 'replace':
    default:
      return generated;
  }
}

/**
 * Merge the template's managed fields into existing frontmatter. Properties out
 * of scope are preserved verbatim and in place; in-scope properties are
 * reconciled; brand-new managed properties are appended in template order.
 */
export function mergeFrontmatter(
  existingFrontmatter: string | null,
  specs: readonly YamlFieldSpec[]
): string {
  const existing = parseFrontmatter(existingFrontmatter ?? '');
  const byKey = new Map(specs.map((s) => [s.key, s]));

  // A `subtract` property references the property that now OWNS the list (its
  // lines are the freshly-rendered items). Resolve that here so `reconcile`
  // stays a pure comparison of two line blocks.
  const subtractAgainst = new Map<string, string[]>();
  for (const spec of specs) {
    if (spec.merge === 'subtract' && spec.subtractFrom) {
      const owner = byKey.get(spec.subtractFrom);
      if (owner) subtractAgainst.set(spec.key, owner.lines);
    }
  }

  const emitted = new Set<string>();
  const out: string[] = [];

  for (const prop of existing) {
    const spec = byKey.get(prop.key);
    if (!spec) {
      out.push(...prop.lines);
      continue;
    }
    emitted.add(spec.key);
    out.push(
      ...reconcile(spec.merge, prop.lines, subtractAgainst.get(spec.key) ?? spec.lines)
    );
  }

  for (const spec of specs) {
    if (emitted.has(spec.key)) continue;
    // Not present on disk. `keep` still writes the generated value (there is
    // nothing to keep); `replace`/`append` write it too, unless it is empty.
    out.push(...reconcile(spec.merge, undefined, spec.lines));
  }

  return out.join('\n');
}

export interface ManagedRegion {
  start: number;
  end: number;
}

function findRegion(
  body: string,
  open: string,
  close: string
): ManagedRegion | null {
  const start = body.indexOf(open);
  if (start === -1) return null;
  const end = body.indexOf(close, start + open.length);
  if (end === -1) return null;
  return { start, end: end + close.length };
}

/**
 * Locate the managed region in a body: ours first, else ZotLit's. Finding
 * ZotLit's lets an import replace it (converting the note) instead of appending
 * a second, competing region.
 */
export function findManagedRegion(body: string): ManagedRegion | null {
  for (const [open, close] of REGION_MARKERS) {
    const region = findRegion(body, open, close);
    if (region) return region;
  }
  return null;
}

/**
 * How a re-import treats the generated `## Notes` (child notes):
 *  - `ifEmpty` (default) — refill ONLY when the section has no content
 *    (whitespace doesn't count); a section with any real content is left alone.
 *  - `append` — keep the existing content and add the rendered child notes
 *    after it, separated by a blank line, so a note imported without child
 *    notes (e.g. by ZotLit) that has since gained the user's own notes still
 *    receives the Zotero notes without losing that writing.
 *  - `replace` — always replace the section content with the render.
 *  - `firstImportOnly` — never touch it after the first import.
 */
export type NotesReimport =
  | 'replace'
  | 'append'
  | 'ifEmpty'
  | 'firstImportOnly';

export interface ManagedRegionMergeOptions {
  /**
   * The template declares a managed region, so its ABSENCE in the render means
   * the region is empty (e.g. no annotations) and an existing one should be
   * removed. Without this, an absent region is treated as "not managed here".
   */
  managesRegion?: boolean;
  /** Re-import strategy for the generated `## Notes` section. */
  notesReimport?: NotesReimport;
}

/**
 * Reconcile the managed region:
 *  - both sides have one → replace the existing span;
 *  - the render has one, the note doesn't → APPEND it (e.g. annotations added
 *    after creation), separated by a blank line;
 *  - the render has none but the template manages regions → REMOVE the existing
 *    one (annotations were deleted);
 *  - otherwise → leave the body unchanged.
 * Content before and after the region is never touched.
 */
export function mergeManagedRegion(
  existingBody: string,
  renderedBody: string,
  opts: ManagedRegionMergeOptions = {}
): string {
  const rendered = findManagedRegion(renderedBody);
  const existing = findManagedRegion(existingBody);

  if (rendered && existing) {
    return (
      existingBody.slice(0, existing.start) +
      renderedBody.slice(rendered.start, rendered.end) +
      existingBody.slice(existing.end)
    );
  }

  if (rendered && !existing) {
    const region = renderedBody.slice(rendered.start, rendered.end);
    const before = existingBody.replace(/\s+$/, '');
    return before ? `${before}\n\n${region}\n` : `${region}\n`;
  }

  if (!rendered && existing && opts.managesRegion) {
    const before = existingBody.slice(0, existing.start).replace(/\n+$/, '');
    const after = existingBody.slice(existing.end).replace(/^\n+/, '');
    if (!before) return after;
    if (!after) return `${before}\n`;
    return `${before}\n\n${after}`;
  }

  return existingBody;
}

const NOTES_HEADING_RE = /^##[ \t]+Notes[ \t]*$/m;
/** End of the `## Notes` section: the next heading, or a managed marker. */
const NOTES_SECTION_END_RE =
  /^(?:#{1,2}[ \t]|%%(?:\/)?(?:sw|zt)-managed%%)/m;

/** The `## Notes` section of a body: its heading end, section end, content. */
function notesSection(
  body: string
): { start: number; end: number; content: string } | null {
  const m = NOTES_HEADING_RE.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const stop = NOTES_SECTION_END_RE.exec(rest);
  const end = stop ? start + stop.index : body.length;
  return { start, end, content: body.slice(start, end) };
}

/** Replace a section's content in place, keeping the heading and what follows. */
function spliceNotesSection(
  body: string,
  section: { start: number; end: number },
  content: string
): string {
  const before = body.slice(0, section.start).replace(/\n+$/, '');
  const after = body.slice(section.end).replace(/^\n+/, '');
  const head = content ? `${before}\n\n${content}` : before;
  return after ? `${head}\n\n${after}` : `${head}\n`;
}

/**
 * Reconcile the generated `## Notes` section on re-import, per `strategy`:
 *
 *  - `firstImportOnly` — leave the existing section exactly as it is.
 *  - `ifEmpty` (default) — fill it from the render ONLY when it has no content
 *    (whitespace doesn't count), matching the after-the-fact ZotLit insertion
 *    path (`insertIntoNote`). A section with real content is never overwritten
 *    (replace loses user edits); only a human or AI can judge whether content
 *    is redundant.
 *  - `append` — keep the existing content and add the rendered content after it
 *    (blank-line separated), so the user's own notes survive a conversion that
 *    also pulls in Zotero child notes.
 *  - `replace` — always put the rendered content there.
 *
 * Section end stops at the next heading or managed marker, so the empty test
 * ignores the `%%sw-managed%%`/`%%zt-managed%%` region. A body with no
 * `## Notes` heading is left as is.
 */
export function reconcileNotesSection(
  existingBody: string,
  renderedBody: string,
  strategy: NotesReimport = 'ifEmpty'
): string {
  if (strategy === 'firstImportOnly') return existingBody;

  const existing = notesSection(existingBody);
  if (!existing) return existingBody;
  const rendered = notesSection(renderedBody);
  if (!rendered) return existingBody;

  const add = rendered.content.replace(/^\n+|\n+$/g, '');
  if (strategy === 'append') {
    if (!add) return existingBody; // nothing to add
    const prior = existing.content.replace(/^\n+|\n+$/g, '');
    const content = prior ? `${prior}\n\n${add}` : add;
    return spliceNotesSection(existingBody, existing, content);
  }

  if (strategy === 'ifEmpty') {
    if (existing.content.trim()) return existingBody; // user content — leave it
    if (!add) return existingBody; // nothing to add
  }

  return spliceNotesSection(existingBody, existing, add);
}

/** `ifEmpty` alias kept for callers that only want the default behaviour. */
export function fillEmptyNotesSection(
  existingBody: string,
  renderedBody: string
): string {
  return reconcileNotesSection(existingBody, renderedBody, 'ifEmpty');
}

/**
 * Re-import an existing note: merge the template's frontmatter fields and
 * reconcile its managed region, preserving all user content and out-of-scope
 * properties. `rendered` is the full output of a fresh template render.
 *
 * One generated area lives OUTSIDE the managed region: `## Notes` holds the
 * item's Zotero child notes. It is only (re)filled when empty, so a re-import
 * restores notes the user cleared but never overwrites their own writing.
 */
export function mergeNote(
  existing: string,
  rendered: string,
  specs: readonly YamlFieldSpec[],
  opts: ManagedRegionMergeOptions = {}
): string {
  const prior = splitNote(existing);
  const fresh = splitNote(rendered);
  const frontmatter = mergeFrontmatter(prior.frontmatter, specs);
  let body =
    prior.frontmatter === null
      ? prior.body
      : mergeManagedRegion(prior.body, fresh.body, opts);
  if (prior.frontmatter !== null) {
    body = reconcileNotesSection(body, fresh.body, opts.notesReimport ?? 'ifEmpty');
  }
  return joinNote(frontmatter, body);
}

/**
 * The `updated:` frontmatter line, which the template rewrites to the CURRENT
 * time on every render. It is therefore not a substantive difference between an
 * existing note and a re-render of the same data.
 */
const UPDATED_LINE = /^updated:[^\n]*\n?/m;

/**
 * Do an existing note and a fresh render differ in anything EXCEPT the volatile
 * `updated` timestamp? `false` means the re-render is a no-op: the caller should
 * not write the file (and should not report the note as updated). Used by the
 * Zotero-driven auto-update, where a version-only change (e.g. a PDF's
 * `lastRead`) can trigger a render that changes nothing.
 */
export function substantiveContentDiffers(
  existing: string,
  rendered: string
): boolean {
  return existing.replace(UPDATED_LINE, '') !== rendered.replace(UPDATED_LINE, '');
}
