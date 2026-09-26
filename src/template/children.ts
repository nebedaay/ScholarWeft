// Zotero child items → note-context children.
//
// The CSL cache carries an item's bibliographic fields but none of its
// children, so attachments, annotations and child notes are fetched from
// Zotero's local HTTP API (see `fetchItemChildrenNative` in `bib/helpers.ts`)
// and mapped here into the `item.attachments` / `item.annotations` /
// `item.notes` arrays `buildNoteContext()` deliberately leaves empty.
//
// This module is PURE: raw JSON in, context objects out. The only outside
// inputs are the Zotero data directory (for on-disk attachment paths and
// annotation excerpt images, neither of which the API exposes) and Zotero's
// `baseAttachmentPath` pref (for `attachments:`-relative linked files). Field
// names follow ZotLit's published `zt` contract v2 — see NOTICE.md.
//
// The ONE improvement over ZotLit is the child note: its contract exposes
// notes as links only, while {@link NoteContextNote.text} carries the note's
// Markdown, which is what removes the separate "insert Zotero notes" step.

import { processAnnotations } from './annotations';
import { annotationColorToName } from './color';
import type { NoteContextRelatedItem } from './context';
import {
  backlinkFor,
  buildNoteContext,
  indexedKeyFor,
  type LinkHelper,
  type NoteContext,
  type NoteContextAnnotation,
  type NoteContextAttachment,
  type NoteContextNote,
  type NoteContextTag,
} from './context';
import { htmlToMarkdownText, noteHtmlToMarkdown } from './markdown';

type RawRecord = Record<string, unknown>;

/** The three child buckets, as they come off the Zotero API. */
export interface RawZoteroChildren {
  attachments?: unknown[];
  annotations?: unknown[];
  notes?: unknown[];
  /**
   * The item's Zotero "Related" items, resolved to `NoteContextRelatedItem`s by
   * the caller (relations live in the Zotero DB, not the CSL export). Kept here
   * so every consumer of the raw bundle gets them.
   */
  relatedItems?: NoteContextRelatedItem[];
}

/** Context the raw Zotero data alone cannot supply. */
export interface ZoteroChildrenOptions {
  /** Group library ID; `null` for the personal library. */
  groupID?: number | null;
  /** Zotero data directory, for on-disk paths + excerpt images. */
  dataDir?: string | null;
  /** Zotero's `baseAttachmentPath` pref, for `attachments:` links. */
  baseAttachmentPath?: string | null;
  /** Level a child note's shallowest heading lands at. Default 3 (`###`). */
  noteHeadingLevel?: number;
  /** Vault-relative path of the literature note, once known. */
  notePath?: string | null;
  /**
   * Vault path of an annotation's copied excerpt image, by annotation key. When
   * it returns a path, the image is linked as an Obsidian wikilink (so it
   * renders and "view image" opens it in Obsidian); otherwise we fall back to
   * Zotero's `file://` cache path, which Obsidian cannot display.
   */
  imageVaultPath?: (key: string) => string | null;
  /**
   * The item's Zotero "Related" items, already resolved to citekeys. Related
   * items live in the Zotero database (not the CSL export), so the caller
   * fetches and resolves them; an unresolved item keeps `citationKey: null` and
   * simply contributes no link.
   */
  relatedItems?: NoteContextRelatedItem[];
}

// ─── Raw access ─────────────────────────────────────────────────────────────

function asRecord(v: unknown): RawRecord | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as RawRecord) : null;
}

/** The `data` object of a wrapped API item, or the item itself if unwrapped. */
function rawData(raw: unknown): RawRecord {
  return asRecord(asRecord(raw)?.data) ?? asRecord(raw) ?? {};
}

/** The item key, whichever level of the API shape carries it. */
function rawKey(raw: unknown, data: RawRecord): string {
  return str(data.key) ?? str(asRecord(raw)?.key) ?? '';
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

// ─── Links ──────────────────────────────────────────────────────────────────

/** Zotero's `open` deep link — opens the file/annotation in Zotero's reader. */
function openLinkFor(key: string, groupID: number | null): string {
  return groupID == null
    ? `zotero://open/library/items/${key}`
    : `zotero://open/groups/${groupID}/items/${key}`;
}

/** A `file://` URL for an absolute path (percent-encoded, like Node's). */
export function fileUrl(absPath: string): string {
  let p = absPath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  return `file://${p.split('/').map(encodeURIComponent).join('/')}`;
}

/** `file:///Users/…/x%20y.pdf` → `/Users/…/x y.pdf`. */
function fileUrlToPath(href: string): string {
  const raw = href.replace(/^file:\/\//i, '').split(/[?#]/)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** A `[alias](file://…)` link, ZotLit's `fileUrlLink`. */
export function fileUrlLink(
  absPath: string,
  defaultAlias: string,
  defaultSubpath = ''
): LinkHelper {
  const href = fileUrl(absPath);
  return (alias, subpath) =>
    `[${alias ?? defaultAlias}](${href}${subpath ?? defaultSubpath})`;
}

function basenamePath(p: string): string | null {
  const clean = p.replace(/[\\/]+$/, '');
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const name = i >= 0 ? clean.slice(i + 1) : clean;
  return name || null;
}

/** Join path segments with `/`, tolerating a trailing slash on the base. */
function joinPath(base: string, ...rest: string[]): string {
  let out = base.replace(/[\\/]+$/, '');
  for (const segment of rest) {
    const clean = segment.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    if (clean) out += `/${clean}`;
  }
  return out;
}

// ─── Attachments ────────────────────────────────────────────────────────────

const LINK_MODES = new Set([
  'imported_file',
  'imported_url',
  'linked_file',
  'linked_url',
  'embedded_image',
]);

function linkModeOf(v: unknown): string {
  const s = str(v);
  return s && LINK_MODES.has(s) ? s : 'unknown';
}

/**
 * The attachment's absolute on-disk path, or `null` (URL links, unknown
 * storage layouts, no data directory). The local API reports an imported
 * file's path only as a `file://` enclosure href, so that is checked first;
 * `data.path` covers linked files, and the `storage/<key>/<filename>` layout is
 * the last resort when only the data directory is known.
 */
function resolveAttachmentFilePath(
  raw: unknown,
  data: RawRecord,
  key: string,
  opts: ZoteroChildrenOptions
): string | null {
  const enclosure = str(asRecord(asRecord(asRecord(raw)?.links)?.enclosure)?.href);
  if (enclosure) return fileUrlToPath(enclosure);

  const p = str(data.path);
  if (p) {
    if (/^attachments:/i.test(p)) {
      const rel = p.replace(/^attachments:/i, '');
      return opts.baseAttachmentPath
        ? joinPath(opts.baseAttachmentPath, rel)
        : null;
    }
    if (/^storage:/i.test(p)) {
      const filename = p.replace(/^storage:/i, '');
      return opts.dataDir
        ? joinPath(opts.dataDir, 'storage', key, filename)
        : null;
    }
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('~')) return p;
  }

  const filename = str(data.filename);
  const mode = linkModeOf(data.linkMode);
  if (
    opts.dataDir &&
    filename &&
    (mode === 'imported_file' || mode === 'imported_url')
  ) {
    return joinPath(opts.dataDir, 'storage', key, filename);
  }
  return null;
}

/** Map one raw Zotero attachment item to the template vocabulary. */
export function mapAttachment(
  raw: unknown,
  opts: ZoteroChildrenOptions = {}
): NoteContextAttachment {
  const data = rawData(raw);
  const key = rawKey(raw, data);
  const groupID = opts.groupID ?? null;
  const filePath = resolveAttachmentFilePath(raw, data, key, opts);
  const filename =
    str(data.filename) ?? (filePath ? basenamePath(filePath) : null);
  const fileLink: LinkHelper = filePath
    ? fileUrlLink(filePath, filename ?? basenamePath(filePath) ?? 'attachment')
    : () => null;

  return {
    key,
    indexedKey: indexedKeyFor(key, groupID),
    filename,
    contentType: str(data.contentType),
    linkMode: linkModeOf(data.linkMode),
    backlink: openLinkFor(key, groupID),
    filePath,
    fileLink,
  };
}

/** Minimal stand-in when an annotation's parent attachment wasn't fetched. */
function placeholderAttachment(
  key: string,
  opts: ZoteroChildrenOptions
): NoteContextAttachment {
  const groupID = opts.groupID ?? null;
  return {
    key,
    indexedKey: indexedKeyFor(key, groupID),
    filename: null,
    contentType: null,
    linkMode: 'unknown',
    backlink: openLinkFor(key, groupID),
    filePath: null,
    fileLink: () => null,
  };
}

// ─── Annotations ────────────────────────────────────────────────────────────

/** Tags as the API sends them: `{ tag: name, type: 0 | 1 }`. */
export function mapTags(rawTags: unknown): NoteContextTag[] {
  if (!Array.isArray(rawTags)) return [];
  const out: NoteContextTag[] = [];
  for (const t of rawTags) {
    const rec = asRecord(t);
    const name = typeof t === 'string' ? t : str(rec?.name) ?? str(rec?.tag);
    if (!name) continue;
    out.push({ name, type: tagTypeOf(rec?.type) });
  }
  return out;
}

function tagTypeOf(v: unknown): NoteContextTag['type'] {
  if (v === 1 || v === 'auto' || v === 'automatic') return 'auto';
  if (v === 0 || v === 'manual' || v === undefined || v === null) return 'manual';
  return 'unknown';
}

/** `annotationPosition`'s 0-based `pageIndex` → the contract's 1-based page. */
function pageOf(position: unknown): number | null {
  const s = str(position);
  if (!s) return null;
  try {
    const idx = (JSON.parse(s) as { pageIndex?: unknown }).pageIndex;
    return typeof idx === 'number' && Number.isFinite(idx) ? idx + 1 : null;
  } catch {
    return null;
  }
}

const ANNOTATION_TYPES = new Set([
  'highlight',
  'note',
  'image',
  'ink',
  'underline',
  'text',
]);

/** An Obsidian `[[vault/path]]` link (alias → `[[vault/path|alias]]`). */
function wikiLinkHelper(vaultPath: string): LinkHelper {
  return (alias) => (alias ? `[[${vaultPath}|${alias}]]` : `[[${vaultPath}]]`);
}

/**
 * A link to the annotation's excerpt image. Prefers the vault copy the importer
 * made (`imageVaultPath`), which renders in Obsidian; without one it falls back
 * to Zotero's cache file, which Obsidian will not display. `null` for annotation
 * kinds Zotero caches no image for (everything but `image` and `ink`).
 */
function annotationImageLink(
  key: string,
  type: string,
  opts: ZoteroChildrenOptions
): LinkHelper | null {
  if (type !== 'image' && type !== 'ink') return null;
  const vaultPath = opts.imageVaultPath?.(key);
  if (vaultPath) return wikiLinkHelper(vaultPath);
  if (!opts.dataDir) return null;
  const libraryPath = opts.groupID == null ? 'library' : `groups/${opts.groupID}`;
  const cachePath = joinPath(opts.dataDir, 'cache', libraryPath, `${key}.png`);
  return fileUrlLink(cachePath, `${key}.png`);
}

/** Map one raw Zotero annotation to the template vocabulary. */
export function mapAnnotation(
  raw: unknown,
  parentItem: NoteContext | null,
  parentAttachment: NoteContextAttachment,
  opts: ZoteroChildrenOptions = {}
): NoteContextAnnotation {
  const data = rawData(raw);
  const key = rawKey(raw, data);
  const groupID = opts.groupID ?? null;
  const type = str(data.annotationType) ?? 'unknown';
  const colorHex = str(data.annotationColor);
  const page = pageOf(data.annotationPosition);
  const commentHtml = str(data.annotationComment);
  const filePath = parentAttachment.filePath;
  const fileLink: LinkHelper = filePath
    ? fileUrlLink(
        filePath,
        parentAttachment.filename ?? basenamePath(filePath) ?? 'attachment',
        page != null ? `#page=${page}` : ''
      )
    : () => null;

  return {
    imgLink: annotationImageLink(key, type, opts),
    comment: commentHtml ? htmlToMarkdownText(commentHtml) || null : null,
    fileLink,
    backlink: backlinkFor(key, groupID),
    parentItem,
    parentAttachment,
    key,
    indexedKey: indexedKeyFor(key, groupID),
    libraryID: groupID ?? 1,
    type: ANNOTATION_TYPES.has(type) ? type : 'unknown',
    text: str(data.annotationText),
    commentHtml,
    colorHex,
    colorName: annotationColorToName(colorHex),
    pageLabel: str(data.annotationPageLabel),
    page,
    authorName: str(data.annotationAuthorName),
    isExternal: data.annotationIsExternal === true,
    dateAdded: str(data.dateAdded) ?? '',
    dateModified: str(data.dateModified) ?? '',
    sortIndex: str(data.annotationSortIndex),
    tags: mapTags(data.tags),
  };
}

// ─── Child notes ────────────────────────────────────────────────────────────

/** Map one raw Zotero child note, converting its HTML body to Markdown. */
export function mapNote(
  raw: unknown,
  opts: ZoteroChildrenOptions = {}
): NoteContextNote {
  const data = rawData(raw);
  const key = rawKey(raw, data);
  const html = str(data.note) ?? str(data.noteHtml);
  return {
    key,
    indexedKey: indexedKeyFor(key, opts.groupID ?? null),
    title: str(data.title),
    // Filled once the note is imported as its own file (link mode).
    noteLink: null,
    text: html
      ? noteHtmlToMarkdown(html, { topLevel: opts.noteHeadingLevel ?? 3 })
      : null,
    html,
  };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Map the raw child buckets onto an ALREADY-BUILT context, wiring each
 * annotation to its parent attachment (and to `ctx` as its parent item) and
 * filling `attachments` / `annotations` / `notes`. `opts.groupID` defaults to
 * the context's own library scope.
 */
export function applyChildren(
  ctx: NoteContext,
  raw: RawZoteroChildren,
  opts: ZoteroChildrenOptions = {}
): NoteContext {
  const resolved: ZoteroChildrenOptions = {
    ...opts,
    groupID: opts.groupID !== undefined ? opts.groupID : ctx.groupID,
  };

  const attachments = (raw.attachments ?? []).map((r) =>
    mapAttachment(r, resolved)
  );
  const byKey = new Map(attachments.map((a) => [a.key, a]));

  const annotations = (raw.annotations ?? []).map((r) => {
    const parentKey = str(rawData(r).parentItem) ?? '';
    const parentAttachment =
      byKey.get(parentKey) ?? placeholderAttachment(parentKey, resolved);
    return mapAnnotation(r, ctx, parentAttachment, resolved);
  });

  const notes = (raw.notes ?? []).map((r) => mapNote(r, resolved));

  ctx.attachments = attachments;
  ctx.annotations = processAnnotations(annotations);
  ctx.notes = notes;
  if (resolved.relatedItems) ctx.relatedItems = resolved.relatedItems;
  else if (raw.relatedItems) ctx.relatedItems = raw.relatedItems;
  return ctx;
}

/**
 * Build a complete context from a cached entry plus the raw Zotero children —
 * the one call the import path needs.
 */
export function buildNoteContextWithChildren(
  entry: Parameters<typeof buildNoteContext>[0],
  raw: RawZoteroChildren,
  opts: ZoteroChildrenOptions = {}
): NoteContext {
  const ctx = buildNoteContext(entry, { notePath: opts.notePath });
  return applyChildren(ctx, raw, opts);
}
