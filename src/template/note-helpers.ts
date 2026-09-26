// Template-facing helpers for OUR single-file note template.
//
// A template author writes INTENT — `add_property('title', item.title)` rather
// than YAML, `annotation_callout(a)` rather than a hand-built callout — and this
// module owns the whitespace-sensitive parts (YAML quoting/indentation,
// blockquote nesting, HTML→Markdown, escaping). Everything here is pure; the
// helpers are exposed to Eta by `engine.ts` as bare globals.
//
// Per-render state hangs off the DATA (`item.__sw`), never the cached engine
// instance, so concurrent renders cannot bleed into each other. `engine.ts`
// injects the bare globals; `prepareTemplateData()` creates the state.
//
// Settled API (see the ScholarWeft skill):
//   YAML      start_YAML / add_property(key, value, opts?) / add_raw_yaml(text) /
//             end_YAML
//   filename  set_file_name(name)            (default `@<citekey>`)
//   creators  creators_by_type(format?, opts?)  → [{ key, values }] for the
//             template's `for … add_property(g.key, g.values)` loop
//             creator_names(role?, format?, opts?) → string
//   notes     zotero_notes({ mode?, level? })
//   callouts  annotation_callout(annotation, opts?) / callout(opts) /
//             merge_annotations(annotations)  (the "+" continuation rule; the
//             import path already applies it to item.annotations)
//   values    wikilink / link_note / md_html / heading / escape_md
//   state     import_date() / is_first_import()
//   re-import merge_into(existing, rendered)  (frontmatter specs + managed region)
//
// Re-import safety is NOT a template concern: the template wraps its generated
// body in `%%sw-managed%%` … `%%/sw-managed%%`, and `merge_into` (backed by
// `merge.ts`) refreshes the managed frontmatter fields and that region while
// leaving every other property and all user text alone.

import {
  creatorNames,
  groupCreatorsByType,
  renderAnnotationCallout,
  renderCallout,
  type AnnotationCalloutOptions,
  type CalloutOptions,
  type CreatorFormatOptions,
  type CreatorNamesOptions,
} from './format';
import { processAnnotations } from './annotations';
import { escapeMarkdown, htmlFieldToMarkdown, noteHtmlToMarkdown } from './markdown';
import { mergeNote } from './merge';
import {
  YamlBuilder,
  type YamlFieldSpec,
  type YamlPropertyOptions,
  type YamlValue,
} from './yaml';
import type {
  NoteContext,
  NoteContextAnnotation,
  NoteContextCreator,
  NoteContextTag,
} from './context';

/** How child notes reach the literature note. */
export type ZoteroNotesMode = 'inline' | 'link';

export interface NoteImportOptions {
  /** `inline` writes the note text; `link` links an imported note file. */
  notesMode?: ZoteroNotesMode;
  /** Heading level a child note's top heading lands at (default 3). */
  notesHeadingLevel?: number;
  /** Defaults for `creators_by_type` / `creator_names`. */
  creatorFormat?: string;
  /** Defaults for `annotation_callout`. */
  annotation?: AnnotationCalloutOptions;
}

/** Per-render state stored at `item.__sw`. */
export interface TemplateState {
  yaml: YamlBuilder;
  options: NoteImportOptions;
  /** `YYYY-MM-DD` the note is imported on. */
  importDate: string;
  /** A re-import sees false; used by `persist`. */
  isFirstImport: boolean;
  /** Proposed filename from `set_file_name()`; `null` keeps the default. */
  fileName: string | null;
  /** True once `zotero_notes()` ran, so callers can detect a missing section. */
  notesRendered: boolean;
}

/** Optional per-import context attached alongside the note context. */
export interface TemplateExtras {
  options?: NoteImportOptions;
  /** Override for deterministic tests. */
  importDate?: string;
  isFirstImport?: boolean;
}

const STATE_KEY = '__sw';

/** Today in the vault's local timezone as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Attach per-render helper state to a context, returning the SAME object so it
 * can be handed straight to `engine.render()`. Without this the helpers create
 * a default state on first use, which is what a render-only test wants.
 */
export function prepareTemplateData(
  ctx: NoteContext,
  extras: TemplateExtras = {}
): NoteContext {
  const state: TemplateState = {
    yaml: new YamlBuilder(),
    options: extras.options ?? {},
    importDate: extras.importDate ?? todayIso(),
    isFirstImport: extras.isFirstImport !== false,
    fileName: null,
    notesRendered: false,
  };
  (ctx as Record<string, unknown>)[STATE_KEY] = state;
  return ctx;
}

/** The default filename for an item, used when `set_file_name` isn't called. */
export function defaultFileName(ctx: NoteContext): string {
  const key = ctx.citekey ?? ctx.citationKey ?? ctx.key;
  return key ? `@${key}` : '';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export class NoteHelpers {
  /** The per-render state, created on first use for render-only callers. */
  stateOf(ctx: NoteContext): TemplateState {
    const existing = (ctx as Record<string, unknown>)[STATE_KEY];
    if (existing) return existing as TemplateState;
    prepareTemplateData(ctx);
    return (ctx as Record<string, unknown>)[STATE_KEY] as TemplateState;
  }

  // ── YAML ──

  startYAML(ctx: NoteContext): void {
    this.stateOf(ctx).yaml.start();
  }

  addProperty(
    ctx: NoteContext,
    key: string,
    value: YamlValue,
    opts?: YamlPropertyOptions
  ): void {
    this.stateOf(ctx).yaml.add(key, value, opts);
  }

  addRawYAML(ctx: NoteContext, text: string): void {
    this.stateOf(ctx).yaml.addRaw(text);
  }

  endYAML(ctx: NoteContext): string {
    return this.stateOf(ctx).yaml.end();
  }

  /** The managed frontmatter fields, for the re-import merge. */
  fieldSpecs(
    ctx: NoteContext,
    opts: { migrateRelated?: boolean } = {}
  ): YamlFieldSpec[] {
    const specs = this.stateOf(ctx).yaml.fieldSpecs();
    if (opts.migrateRelated) return specs;
    // Outside the one-time transfer, `related:` is the user's alone: swap the
    // `subtract` strategy for `keep`, so an existing value is never rewritten.
    return specs.map((s) =>
      s.merge === 'subtract' ? { ...s, merge: 'keep' as const } : s
    );
  }

  /**
   * Merge a fresh render into an existing note: refresh the managed frontmatter
   * fields and reconcile the managed region, keeping everything else. Returns
   * the rendered text unchanged when there is no existing note yet.
   */
  mergeInto(
    ctx: NoteContext,
    existing: string | null,
    rendered: string,
    opts: { managesRegion?: boolean; migrateRelated?: boolean } = {}
  ): string {
    if (!existing) return rendered;
    return mergeNote(existing, rendered, this.fieldSpecs(ctx, opts), opts);
  }

  // ── Filename ──

  setFileName(ctx: NoteContext, name: string): void {
    this.stateOf(ctx).fileName = name?.trim() ? name.trim() : null;
  }

  fileName(ctx: NoteContext): string {
    return this.stateOf(ctx).fileName ?? defaultFileName(ctx);
  }

  // ── Creators ──

  creatorsByType(
    ctx: NoteContext,
    format?: string,
    opts?: CreatorFormatOptions
  ): Array<{ key: string; values: string[] }> {
    const state = this.stateOf(ctx);
    return groupCreatorsByType(ctx.creators, format ?? state.options.creatorFormat, opts);
  }

  /** Formatted names for ONE Zotero role, for a fixed frontmatter field. */
  creatorValues(
    ctx: NoteContext,
    role: string,
    format?: string,
    opts?: CreatorFormatOptions
  ): string[] {
    const state = this.stateOf(ctx);
    const group = groupCreatorsByType(ctx.creators, format ?? state.options.creatorFormat, {
      ...opts,
      roles: [role],
    }).find((g) => g.key === `${role}${opts?.suffix ?? 's'}`);
    return group?.values ?? [];
  }

  creatorNames(
    ctx: NoteContext,
    role?: string | string[],
    format?: string,
    opts?: CreatorNamesOptions
  ): string {
    const state = this.stateOf(ctx);
    const roles = role ?? opts?.roles;
    return creatorNames(ctx.creators, {
      ...opts,
      roles,
      format: format ?? opts?.format ?? state.options.creatorFormat,
    });
  }

  /** The item's primary creators (authors, directors, …). */
  private primaryCreators(ctx: NoteContext): NoteContextCreator[] {
    return ctx.authors.length ? ctx.authors : ctx.creators;
  }

  // ── Notes ──

  /**
   * Child notes as body Markdown. `inline` (default) emits each note's
   * converted text; `link` uses the note's imported file link when present and
   * falls back to the inline text, so a note is never silently dropped.
   */
  zoteroNotes(
    ctx: NoteContext,
    opts: { mode?: ZoteroNotesMode; level?: number } = {}
  ): string {
    const state = this.stateOf(ctx);
    state.notesRendered = true;
    if (!ctx.notes.length) return '';
    const mode = opts.mode ?? state.options.notesMode ?? 'inline';
    const level = opts.level ?? state.options.notesHeadingLevel ?? 3;

    const render = (note: NoteContext['notes'][number]): string => {
      if (mode === 'link' && note.noteLink) {
        const link = note.noteLink();
        if (link) return link;
      }
      // Convert from the raw HTML when we have it, so the requested heading
      // level is exact; fall back to the pre-converted Markdown.
      if (note.html) return noteHtmlToMarkdown(note.html, { topLevel: level });
      if (note.text) return note.text;
      // No text fetched and no imported file: fall back to a link if we have one.
      const link = note.noteLink?.();
      return link ?? '';
    };

    return ctx.notes
      .map(render)
      .filter((chunk) => chunk && chunk.trim())
      .join('\n\n');
  }

  // ── Callouts ──

  /**
   * Fold "+"-continuation annotations. The import path already applies this to
   * `item.annotations` before rendering, so templates normally never call it;
   * it is exposed so a template that assembles its own annotation list (e.g.
   * from several attachments) gets the same behaviour for free.
   */
  mergeAnnotations(
    ctx: NoteContext,
    annotations: NoteContextAnnotation[]
  ): NoteContextAnnotation[] {
    this.stateOf(ctx);
    return processAnnotations(annotations);
  }

  annotationCallout(
    ctx: NoteContext,
    annotation: NoteContextAnnotation,
    opts?: AnnotationCalloutOptions
  ): string {
    const state = this.stateOf(ctx);
    return renderAnnotationCallout(annotation, { ...state.options.annotation, ...opts });
  }

  callout(ctx: NoteContext, opts: CalloutOptions): string {
    this.stateOf(ctx);
    return renderCallout(opts);
  }

  // ── Value utils ──

  wikilink(_ctx: NoteContext, target: string, alias?: string): string {
    if (!target) return '';
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
  }

  linkNote(ctx: NoteContext, alias?: string, subpath?: string): string {
    return ctx.noteLink(alias, subpath) ?? '';
  }

  mdHtml(_ctx: NoteContext, html: string | null | undefined): string {
    return htmlFieldToMarkdown(html);
  }

  heading(_ctx: NoteContext, level: number, text: string): string {
    const l = Math.min(6, Math.max(1, Math.floor(level) || 1));
    return `${'#'.repeat(l)} ${text ?? ''}`.trimEnd();
  }

  escapeMd(_ctx: NoteContext, text: string | null | undefined): string {
    return escapeMarkdown(text ?? '');
  }

  // ── State ──

  importDate(ctx: NoteContext): string {
    return this.stateOf(ctx).importDate;
  }

  isFirstImport(ctx: NoteContext): boolean {
    return this.stateOf(ctx).isFirstImport;
  }

  // ── Derived values ZI templates compute inline ──

  /**
   * `shortTitle` if set, else the title up to its first `:`. Matches the old
   * Zotero-Integration template's rule.
   */
  shortTitle(ctx: NoteContext): string | null {
    if (ctx.shortTitle) return ctx.shortTitle;
    const title = ctx.title ?? '';
    const at = title.indexOf(':');
    if (at === -1) return null;
    return title.slice(0, at).trim() || null;
  }

  /**
   * Frontmatter aliases, Zotero-Integration style: `<first author>[- et al.]
   * - <year> - <short title>`, then the full title, then the short title when
   * it differs.
   */
  aliases(ctx: NoteContext): string[] {
    const title = ctx.title ?? '';
    const short = this.shortTitle(ctx);
    const useTitle = short ?? title;
    const out: string[] = [];

    const creators = this.primaryCreators(ctx);
    const year = ctx.date ? String(ctx.date.year) : '';
    if (creators.length) {
      const first = creators[0].family || creators[0].literal || creators[0].fullName;
      const authlist =
        creators.length > 2 ? `${first} et al.` : creators.length === 2
          ? `${first} and ${creators[1].family || creators[1].literal || creators[1].fullName}`
          : first;
      if (authlist && useTitle) {
        out.push(`${authlist}${year ? ` - ${year}` : ''} - ${useTitle}`);
      }
    }
    if (title) out.push(title);
    if (short && short !== title) out.push(short);
    return [...new Set(out)];
  }

  /**
   * Zotero's tags and related items as `[[…]]` links.
   *
   * These are ZOTERO'S data, not the user's, so they go in the `sw-related`
   * property, which the template reconciles with `replace`: every import
   * rebuilds the list from scratch, so removing a tag or related link in Zotero
   * removes it here. The plain `related:` property is the user's own and is
   * never written to (see the template's `keep`).
   */
  relatedLinks(ctx: NoteContext): string[] {
    const out: string[] = [];
    for (const item of ctx.relatedItems) {
      if (item.citationKey) out.push(`[[@${item.citationKey}]]`);
    }
    for (const tag of ctx.tags as NoteContextTag[]) {
      if (tag.name) out.push(`[[${tag.name}]]`);
    }
    return out;
  }

  /** Attachments as `[filename](reader link)` frontmatter entries. */
  attachmentLinks(ctx: NoteContext): string[] {
    return ctx.attachments
      .filter((a) => a.key)
      .map((a) => {
        const label = (a.filename ?? a.key).replace(/"/g, '\\"');
        return `[${label}](${a.backlink})`;
      });
  }

  /** Attachments that actually carry annotations, in fetch order. */
  attachmentsWithAnnotations(ctx: NoteContext): NoteContext['attachments'] {
    const keys = new Set(
      ctx.annotations.map((a) => a.parentAttachment?.key).filter(Boolean)
    );
    return ctx.attachments.filter((a) => keys.has(a.key));
  }
}
