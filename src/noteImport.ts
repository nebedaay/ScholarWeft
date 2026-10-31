// Own (non-ZotLit) literature-note creation.
//
// Fetches an item's children from Zotero, renders our single-file template, and
// writes or updates the note. This is the path the `useOwnNoteTemplate` setting
// selects; when it is off, note creation stays on ZotLit / the basic fallback.
//
// Update semantics are the template merge's: only the managed frontmatter fields
// and the `%%sw-managed%%` region are refreshed; the user's own properties and
// writing are preserved.

import { App, MarkdownView, Notice, Platform, TFile, normalizePath } from 'obsidian';
import type ReferenceList from './main';
import { debugLog } from './helpers';
import type { ForeignNoteAnswer } from './modals/foreignNoteModal';
import type { AdoptNoteAnswer, AdoptNoteChoice } from './modals/adoptNoteModal';
import {
  DEFAULT_ZOTERO_PORT,
  citekeysForItemKeys,
  fetchItemChildrenNative,
  fetchItemRelationsNative,
  fetchItemTagsNative,
} from './bib/helpers';
import type { NoteContextRelatedItem } from './template/context';
import type { RawZoteroChildren } from './template/children';
import {
  isInFolder,
  literatureNoteFolderFor,
  rememberFolderName,
  resolveLiteratureNoteFolder,
} from './template/lit-folder';
export { DEFAULT_LITERATURE_NOTE_FOLDER } from './template/lit-folder';
import { readTemplate } from './template/note-template-io';
import {
  captureCursorAnchor,
  readStableKey,
  resolveCursorAnchor,
  type CursorAnchor,
} from './template/note-format';
export {
  readTemplate,
  copyDefaultTemplateToVault,
} from './template/note-template-io';

interface OpenCursorAnchor {
  view: MarkdownView;
  anchor: CursorAnchor;
}

/** Cursors in any open editor showing this note, relative to its body. */
function captureOpenCursors(
  app: App,
  notePath: string
): OpenCursorAnchor[] {
  const out: OpenCursorAnchor[] = [];
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) continue;
    if (normalizePath(view.file.path) !== normalizePath(notePath)) continue;
    const cursor = view.editor.getCursor();
    // Capture from the EDITOR's text, not the last saved file: a background tab
    // can be a few keystrokes (or a slow autosave) behind.
    const anchor = captureCursorAnchor(
      view.editor.getValue(),
      cursor.line,
      cursor.ch,
      view.editor.getLine(cursor.line)
    );
    if (anchor) out.push({ view, anchor });
  }
  return out;
}

/**
 * Restore the captured cursors after the editor has reloaded the rewritten
 * file. If the editor still holds different text (the write has not reached it
 * yet), retry briefly; if it never matches, leave the cursor alone rather than
 * move it into the wrong place.
 */
interface PendingCursor {
  path: string;
  content: string;
  anchor: CursorAnchor;
  at: number;
}

/**
 * Background tabs often keep their old editor text until they are activated,
 * long after the 500 ms retry window. Hold their anchors here and restore them
 * when the tab is next shown (`restorePendingCursor`, wired to
 * active-leaf-change / file-open in main.ts).
 */
const pendingCursors = new WeakMap<MarkdownView, PendingCursor>();
const PENDING_CURSOR_MS = 10 * 60 * 1000;

function restoreOpenCursors(
  anchors: OpenCursorAnchor[],
  content: string,
  attempt = 0
): void {
  if (!anchors.length) return;
  const waiting: OpenCursorAnchor[] = [];
  for (const item of anchors) {
    let ready = false;
    try {
      ready = !!item.view.file && item.view.editor.getValue() === content;
    } catch {
      /* view closing */
    }
    if (ready) {
      item.view.editor.setCursor(resolveCursorAnchor(content, item.anchor));
    } else {
      waiting.push(item);
    }
  }
  if (!waiting.length) return;
  if (attempt < 20) {
    window.setTimeout(() => restoreOpenCursors(waiting, content, attempt + 1), 25);
    return;
  }
  const at = Date.now();
  for (const { view, anchor } of waiting) {
    const path = view.file?.path;
    if (path) pendingCursors.set(view, { path, content, anchor, at });
  }
}

/**
 * Restore a background tab's cursor when it is activated, once its editor has
 * loaded the rewritten text. Retries briefly because the editor updates after
 * the leaf-change event.
 */
export function restorePendingCursor(view: MarkdownView, attempt = 0): void {
  const pending = pendingCursors.get(view);
  if (!pending) return;
  if (Date.now() - pending.at > PENDING_CURSOR_MS) {
    pendingCursors.delete(view);
    return;
  }
  if (
    !view.file ||
    normalizePath(view.file.path) !== normalizePath(pending.path)
  ) {
    pendingCursors.delete(view);
    return;
  }
  let content = '';
  try {
    content = view.editor.getValue();
  } catch {
    return;
  }
  if (content !== pending.content) {
    if (attempt < 20) {
      window.setTimeout(() => restorePendingCursor(view, attempt + 1), 25);
    }
    return;
  }
  view.editor.setCursor(resolveCursorAnchor(pending.content, pending.anchor));
  pendingCursors.delete(view);
}

import {
  excerptImageName,
  findPreviousImagePath,
} from './template/excerpt-images';
import { indexedKeyFor, type CachedEntry } from './template/context';
import {
  findAvailableNotePath,
  foreignNoteAction,
  isZotLitManaged,
  matchNoteByZoteroKey,
  noteNameMatchesCitekey,
  isBareCitekeyName,
  resolveOwnNotePath,
  zotLitChoice,
  type ForeignNoteChoice,
  type ZotLitHandling,
} from './template/note-lookup';
import {
  substantiveContentDiffers,
  type NotesReimport,
} from './template/merge';
import {
  childrenCacheHit,
  readChildren,
  writeChildren,
} from './template/children-cache';
import { renderNote } from './template/render';

declare const require: (id: string) => unknown;

const EMPTY_CHILDREN: RawZoteroChildren = {
  attachments: [],
  annotations: [],
  notes: [],
};

function expandHome(p: string): string {
  // Node built-ins do not exist on mobile; this path is desktop-only.
  if (!Platform.isDesktop) return p;
  if (p === '~' || p === '~/') return (require('os') as typeof import('os')).homedir();
  if (p.startsWith('~/'))
    return (require('os') as typeof import('os')).homedir() + p.slice(1);
  return p;
}

/**
 * The Zotero data directory: the configured folder, else the platform default
 * if it exists. Needed to resolve on-disk attachment paths and annotation
 * excerpt images, which the API does not expose. Pure best-effort — a wrong
 * value just yields links that don't resolve, never a failure.
 */
export function resolveZoteroDataDir(configured?: string): string | null {
  // Node built-ins do not exist on mobile; this path is desktop-only.
  if (!Platform.isDesktop) return null;
  const custom = (configured ?? '').trim();
  if (custom) return expandHome(custom);
  try {
    const os = require('os') as typeof import('os');
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const home = os.homedir();
    const platform = (window as unknown as { process?: { platform?: string } })
    .process?.platform;
    const candidates =
      platform === 'win32'
        ? [path.join(process.env.APPDATA ?? '', 'Zotero', 'Zotero')]
        : platform === 'darwin'
          ? [path.join(home, 'Zotero')]
          : [path.join(home, 'Zotero'), path.join(home, '.zotero', 'zotero')];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
  } catch {
    /* no fs — leave unresolved */
  }
  return null;
}

/** The literature-note folder for ScholarWeft's own notes. */
export function literatureNoteFolder(plugin: ReferenceList): string {
  return resolveLiteratureNoteFolder({
    literatureNoteFolder: plugin.settings.literatureNoteFolder,
  });
}

/**
 * The folder a note for THIS item belongs in: the base folder for My Library,
 * an auto-named per-library subfolder for a group library, so copies of the same
 * work (which share a citekey) live as separate notes. Created lazily by the
 * caller — only when a note is actually written.
 */
function noteFolderForEntry(
  plugin: ReferenceList,
  entry: CachedEntry | undefined
): string {
  const groupID = entry?.groupID && entry.groupID !== 1 ? entry.groupID : 1;
  if (groupID === 1) return literatureNoteFolder(plugin);
  const name = plugin.bibManager?.libraryNameFor(groupID) ?? null;
  const folder = literatureNoteFolderFor({
    base: literatureNoteFolder(plugin),
    groupID,
    groupName: name,
  });
  // Remember the folder name used, so a later Zotero RENAME of the library can be
  // detected and offered as a folder rename.
  const folderName = folder.split('/').pop() ?? '';
  if (folderName) rememberFolderName(groupID, folderName);
  return folder;
}

/**
 * Fetch an item's children live; shared with the data explorer preview.
 *
 * Zotero "Related" items are fetched too (they are stored as item KEYS in the
 * Zotero database, so each is resolved to a citekey) — the old import policy
 * turned them into `[[@citekey]]` entries in `related:`, alongside the item's
 * tags.
 */
export async function fetchChildren(
  plugin: ReferenceList,
  entry: CachedEntry | undefined,
  opts: { skipCache?: boolean } = {}
): Promise<RawZoteroChildren> {
  const key = entry?._zoteroKey;
  if (!key) return EMPTY_CHILDREN;
  const libraryID = entry?.groupID && entry.groupID !== 1 ? entry.groupID : 1;
  const port = plugin.settings.zoteroPort || DEFAULT_ZOTERO_PORT;

  // USE WHAT WE HAVE: an item's children cannot have changed while its
  // `_version` is unchanged, so do NOT re-fetch them. This is what makes a
  // template-only update (or any re-render) pure CPU instead of three Zotero
  // round trips per note. `skipCache` forces a fetch (a Zotero-driven update).
  const stable = indexedKeyFor(key, entry?.groupID && entry.groupID !== 1 ? entry.groupID : null);
  const version = typeof entry?._version === 'number' ? entry._version : 0;
  const cache = plugin.bibManager?.childrenCache;
  if (cache && !opts.skipCache && childrenCacheHit(cache, stable, version)) {
    const cached = readChildren<RawZoteroChildren>(cache, stable);
    if (cached) return cached;
  }

  try {
    const [children, relatedKeys, liveTags] = await Promise.all([
      fetchItemChildrenNative(port, key, libraryID),
      fetchItemRelationsNative(port, key, libraryID),
      fetchItemTagsNative(port, key, libraryID),
    ]);
    const base: RawZoteroChildren =
      liveTags === null ? (children ?? EMPTY_CHILDREN) : { ...(children ?? EMPTY_CHILDREN), liveTags };
    const result: RawZoteroChildren = relatedKeys.length
      ? await (async () => {
          const citekeys = await citekeysForItemKeys(port, relatedKeys, libraryID);
          const relatedItems: NoteContextRelatedItem[] = relatedKeys.map((k) => {
            const citationKey = citekeys.get(k) ?? null;
            // A related item with no citekey can't be linked; keep it out of the
            // list rather than emitting a broken `[[@]]`.
            const title: string | null = null;
            return { key: k, citationKey, title };
          });
          return { ...base, relatedItems: relatedItems.filter((r) => r.citationKey) };
        })()
      : base;
    // Remember it so the NEXT render of this unchanged item fetches nothing.
    if (cache) {
      plugin.bibManager.childrenCache = writeChildren(
        cache,
        stable,
        version,
        result,
        Date.now()
      );
      plugin.bibManager.scheduleChildrenCacheSave();
    }
    return result;
  } catch (e) {
    console.warn('[sw:import] child fetch failed; importing metadata only', e);
    return EMPTY_CHILDREN;
  }
}

/**
 * Pure: the first note path under `folder` whose frontmatter `zotero-key`
 * matches. Lets a note be found by its stable Zotero id even after a citekey
 * rename changed the filename, so re-imports update in place instead of
 * creating a duplicate.
 */
function findNoteByZoteroKey(
  app: App,
  folder: string,
  zoteroKey: string
): string | null {
  if (!zoteroKey) return null;
  const candidates = app.vault.getMarkdownFiles().map((f) => ({
    path: f.path,
    zoteroKey: readStableKey(app.metadataCache.getFileCache(f)?.frontmatter),
  }));
  return matchNoteByZoteroKey(candidates, folder, zoteroKey);
}

/** Every vault path, so a fresh note name can be checked without I/O. */
function vaultPaths(app: App): Set<string> {
  return new Set(app.vault.getFiles().map((f) => f.path));
}

/** The note's own `citekey:` frontmatter (the record of a past citekey), or null. */
function recordedCitekeyFor(app: App, notePath: string): string | null {
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return null;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  const ck = fm?.citekey;
  return typeof ck === 'string' && ck ? ck : null;
}

/**
 * Move a note into `folder`, keeping its filename. Returns the (possibly
 * unchanged) path. If the destination already exists, the note is left where it
 * is — never overwrite.
 */
export async function moveNoteIntoFolder(
  app: App,
  notePath: string,
  folder: string
): Promise<string> {
  const name = notePath.split('/').pop() ?? notePath;
  const target = normalizePath(folder);
  const desired = normalizePath(`${target}/${name}`);
  if (desired === notePath) return notePath;
  if (await app.vault.adapter.exists(desired)) return notePath;
  const file = app.vault.getAbstractFileByPath(notePath);
  try {
    // The target folder may not exist yet (e.g. a group library's folder before
    // its first import) — create it, then move.
    if (target && !(await app.vault.adapter.exists(target))) {
      await app.vault.adapter.mkdir(target);
    }
    if (file instanceof TFile) await app.fileManager.renameFile(file, desired);
    else await app.vault.adapter.rename(notePath, desired);
    return desired;
  } catch (e) {
    console.warn('[sw:import] could not move note into folder', notePath, '→', desired, e);
    return notePath;
  }
}

/** 1-based page of an annotation, from its `annotationPosition`. */
function annotationPage(position: unknown): number | null {
  if (typeof position !== 'string' || !position) return null;
  try {
    const idx = (JSON.parse(position) as { pageIndex?: unknown }).pageIndex;
    return typeof idx === 'number' && Number.isFinite(idx) ? idx + 1 : null;
  } catch {
    return null;
  }
}

/** The vault folder excerpt images are copied into (default `Attachments`). */
export function excerptImageFolder(plugin: ReferenceList): string {
  return (plugin.settings.ownNoteImageFolder ?? '').trim() || 'Attachments';
}

/**
 * Decide whether to convert a ZotLit-managed note, honouring the remembered
 * setting and otherwise asking. The prompt lets the user convert just this
 * note, convert every note they update, or leave ZotLit's notes alone — so
 * trying the plugin never silently reworks their existing ZotLit notes.
 */
async function resolveZotLitHandling(
  plugin: ReferenceList,
  noteName: string
): Promise<'convert' | 'leave'> {
  const setting: ZotLitHandling = plugin.settings.ownNoteZotLitHandling ?? 'ask';
  if (setting === 'convert') return 'convert';
  if (setting === 'leave') return 'leave';

  // Loaded on demand: this module is imported by tests that mock `obsidian`
  // minimally, and a top-level modal import would pull `Modal` into them.
  const { ZotLitConvertModal } = await import('./modals/zotlitConvertModal');
  const choice = await new Promise<Parameters<typeof zotLitChoice>[0]>(
    (resolve) => new ZotLitConvertModal(plugin.app, noteName, resolve).open()
  );
  const { action, remember } = zotLitChoice(choice);
  if (remember) {
    plugin.settings.ownNoteZotLitHandling = remember;
    await plugin.saveSettings();
  }
  return action;
}

/**
 * Ask whether to adopt an existing `@citekey.md` that carries no
 * `sw-zotero-id`, or leave it and create a separate note. A remembered choice
 * is applied silently.
 */
async function resolveAdoptHandling(
  plugin: ReferenceList,
  base: string
): Promise<AdoptNoteChoice> {
  const remembered = plugin.settings.adoptExistingNote;
  if (remembered && remembered !== 'ask') return remembered;

  const { AdoptNoteModal } = await import('./modals/adoptNoteModal');
  const answer = await new Promise<AdoptNoteAnswer>((resolve) =>
    new AdoptNoteModal(plugin.app, {
      noteName: `${base}.md`,
      citekey: base.replace(/^@/, ''),
      onChoose: resolve,
    }).open()
  );
  if (answer.remember && answer.choice !== 'cancel') {
    plugin.settings.adoptExistingNote = answer.choice;
    await plugin.saveSettings();
  }
  return answer.choice;
}

/**
 * Ask what to do about a note that carries the item's stable `zotero-key` but
 * a filename that is not the item's current citekey. The note's own `citekey:`
 * frontmatter (when present) is shown so an obsolete name is recognisable.
 *
 * Loaded on demand so modules that mock `obsidian` minimally never pull the
 * modal in.
 */
async function resolveForeignNoteHandling(
  plugin: ReferenceList,
  notePath: string,
  citekey: string,
  noteCitekey: string | null
): Promise<ForeignNoteChoice> {
  // A remembered choice is applied silently — once the user has opted into
  // ScholarWeft, a note name other than `@citekey` rarely makes sense, so this
  // is normally answered once and never asked again.
  const remembered = plugin.settings.foreignNoteHandling;
  if (remembered && remembered !== 'ask') return remembered;

  const noteName = notePath.split('/').pop() ?? notePath;

  const { ForeignNoteModal } = await import('./modals/foreignNoteModal');
  const answer = await new Promise<ForeignNoteAnswer>((resolve) =>
    new ForeignNoteModal(plugin.app, {
      noteName,
      citekey,
      noteCitekey,
      onChoose: resolve,
    }).open()
  );
  if (answer.remember && answer.choice !== 'cancel') {
    plugin.settings.foreignNoteHandling = answer.choice;
    await plugin.saveSettings();
  }
  return answer.choice;
}

/**
 * Copy each image/ink annotation's excerpt PNG from Zotero's cache into the
 * vault, so it can be embedded as `![[…]]` — Obsidian never renders a `file://`
 * path, and such a link asks the system viewer instead of opening in Obsidian.
 *
 * Names are `@<citekey>_p<page>_<annotationKey>.png`. The annotation key is
 * immutable and globally unique, so the name is stable under re-import and can
 * never collide; the citekey and page are the readable part (which reference,
 * and where to find the quote), and keep one reference's images together. This
 * improves on ZotLit's bare `<annotationKey>.png` (stable but cryptic) and on a
 * page-sequence number (readable but not stable — inserting an annotation
 * earlier on a page would renumber the rest).
 *
 * An existing `*_<key>.png` is reused and renamed rather than duplicated, so a
 * citekey rename updates the readable part without orphaning the file. Returns
 * annotation key → vault path for everything that is available.
 */
async function copyExcerptImages(
  plugin: ReferenceList,
  citekey: string,
  children: RawZoteroChildren,
  groupID: number | null,
  dataDir: string | null
): Promise<Map<string, string>> {
  // Node built-ins do not exist on mobile; this path is desktop-only.
  if (!Platform.isDesktop) return new Map();
  const copied = new Map<string, string>();
  const raws = children.annotations ?? [];
  if (!raws.length || !dataDir) return copied;

  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const adapter = plugin.app.vault.adapter;
  const folder = normalizePath(excerptImageFolder(plugin));

  try {
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  } catch (e) {
    console.warn('[sw:import] could not create excerpt-image folder', folder, e);
    return copied;
  }

  // Existing files, so a previous copy for the same annotation can be reused.
  let files: string[] = [];
  try {
    files = (await adapter.list(folder)).files;
  } catch {
    files = [];
  }

  const libraryPath = groupID == null ? 'library' : `groups/${groupID}`;

  for (const raw of raws) {
    const data = ((raw as { data?: unknown })?.data ?? raw) as Record<
      string,
      unknown
    >;
    const type = data?.annotationType;
    const key = data?.key;
    if ((type !== 'image' && type !== 'ink') || typeof key !== 'string' || !key) {
      continue;
    }

    const source = path.join(dataDir, 'cache', libraryPath, `${key}.png`);
    if (!fs.existsSync(source)) continue;

    const page = annotationPage(data.annotationPosition);
    const desired = normalizePath(
      `${folder}/${excerptImageName(citekey, page, key)}`
    );

    try {
      if (await adapter.exists(desired)) {
        copied.set(key, desired);
        continue;
      }
      // An older copy of THIS annotation — our previous name, or ZotLit's bare
      // `<key>.png` — renamed in place so the readable part follows the citekey
      // and no duplicate is left behind.
      const previous = findPreviousImagePath(files, key);
      if (previous) {
        await adapter.rename(previous, desired);
        const i = files.indexOf(previous);
        if (i >= 0) files[i] = desired;
      } else {
        const buffer = fs.readFileSync(source) as Buffer;
        await adapter.writeBinary(
          desired,
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer
        );
        files.push(desired);
      }
      copied.set(key, desired);
    } catch (e) {
      console.warn('[sw:import] could not copy excerpt image', source, '→', desired, e);
    }
  }
  return copied;
}

/**
 * Create or update a literature note from our own template. Returns `false`
 * (and no file change) when the template asset is missing, so the caller can
 * fall back rather than write an empty note.
 */
export async function createOrUpdateOwnNote(
  plugin: ReferenceList,
  citekey: string,
  entry: CachedEntry | undefined,
  sourceFile: TFile,
  opts: {
    open?: boolean;
    skipChildCache?: boolean;
    force?: boolean;
    /** Adopt an existing `@citekey.md` without asking (the review's batch). */
    forceAdopt?: boolean;
    /** The note to adopt when it is not named `@citekey.md`. */
    adoptPath?: string;
  } = {}
): Promise<{ ok: boolean; changed: boolean }> {
  const app = plugin.app;
  const templateSource = await readTemplate(plugin);
  if (!templateSource) return { ok: false, changed: false };

  // PRINCIPLE — use what we already have. Children are re-fetched ONLY when the
  // item's `_version` changed (a cache miss); a template update or any re-render
  // of an unchanged item fetches NOTHING. A caller that KNOWS the item changed
  // (a Zotero-driven update) sets `skipChildCache` to force a fetch even if the
  // version somehow matches.
  const children = await fetchChildren(plugin, entry, {
    skipCache: opts.skipChildCache === true,
  });
  const groupID = entry?.groupID && entry.groupID !== 1 ? entry.groupID : null;
  const dataDir = resolveZoteroDataDir(plugin.settings.zoteroDataDir);
  const folder = noteFolderForEntry(plugin, entry);

  // Copy excerpt images into the vault first, so the render links them as
  // `![[…]]` (renderable, opens in Obsidian) and not `file://` cache paths.
  const images = await copyExcerptImages(plugin, citekey, children, groupID, dataDir);
  const imageVaultPath = (key: string) => images.get(key) ?? null;

  // Resolve the item's Zotero collections to name/path for the
  // `zotero-collections` property. Best-effort: the index is fetched once per
  // session, and a failure just leaves the property empty.
  await plugin.bibManager?.ensureCollectionsIndex().catch(() => {});
  const collections = plugin.bibManager?.collectionsForEntry(entry) ?? [];

  // First pass: no existing note, just to resolve the filename.
  const first = renderNote(entry, children, {
    templateSource,
    groupID,
    dataDir,
    imageVaultPath,
    collections,
    noteHeadingLevel: plugin.settings.ownNoteNotesHeadingLevel ?? 3,
  });
  const base = (first.fileName || `@${citekey}`).replace(/\.md$/i, '');
  const stableKey = indexedKeyFor(
    typeof entry?._zoteroKey === 'string' ? entry._zoteroKey : '',
    groupID
  );

  // Locate by the stable Zotero key FIRST, as ZotLit does: the note that owns
  // this item is the one to update, whatever its filename. Search the WHOLE
  // import tree (the base folder and every subfolder) so a note that is merely
  // in the wrong subfolder is found and updated in place, never duplicated.
  //
  // `stableKey` here comes from the ITEM, so it is always set — it says which
  // note to LOOK for, not which was found. When the search finds nothing, a
  // caller-supplied `adoptPath` (a note found by its own citekey under a
  // different name) wins over the conventional `@citekey.md` path, so that note
  // is adopted in place instead of a second one being written beside it.
  const baseFolder = literatureNoteFolder(plugin);
  const notePathByKey = stableKey
    ? findNoteByZoteroKey(app, baseFolder, stableKey)
    : null;
  let notePath: string | null = resolveOwnNotePath({
    foundByKey: notePathByKey,
    adoptPath: opts.adoptPath,
  });

  // A GROUP note (`zotero-key` `KEYg<groupID>`) belongs in the subfolder named
  // after its library — the group NAME, not the id, so a renamed library means
  // a renamed folder and the note follows it. Find it anywhere and move it
  // there if it isn't already. This is structural, so it does not depend on the
  // opt-in migration setting. It only applies when the group's name is KNOWN
  // (otherwise the target would be a meaningless `Group N`); My Library notes
  // are only moved when the user accepted the migration offer.
  const groupName =
    groupID && groupID !== 1
      ? plugin.bibManager?.libraryNameFor(groupID) ?? null
      : null;
  const placeGroupNote = !!groupName;
  if (notePath === null && stableKey) {
    if (placeGroupNote || plugin.settings.moveKeyedNotesToImportFolder === true) {
      const elsewhere = findNoteByZoteroKey(app, '', stableKey);
      if (elsewhere && (placeGroupNote || !isInFolder(elsewhere, baseFolder))) {
        notePath = await moveNoteIntoFolder(app, elsewhere, folder);
      }
    }
  }
  // Found under the tree but in the wrong subfolder: a group note goes to its
  // (name-based) group folder.
  if (notePath && placeGroupNote && folder) {
    notePath = await moveNoteIntoFolder(app, notePath, folder);
  }

  // The item's note was found, but under a name that is not its current
  // citekey. If the filename is the note's OWN recorded citekey it is a KNOWN
  // past citekey — a regular citekey update (the reconcile path renames it), so
  // no merge question is asked. Only an unknown name (another plugin's scheme,
  // or an unrecorded obsolete citekey) asks how to merge.
  let foreignNotesReimport: NotesReimport = 'ifEmpty';
  let convertedForeign = false;
  if (notePath && !noteNameMatchesCitekey(notePath, citekey)) {
    const recorded = recordedCitekeyFor(app, notePath);
    // A KNOWN name needs no merge question: the note's own recorded citekey (a
    // past citekey), or the current/recorded citekey written WITHOUT its `@`
    // (ZotLit's naming). The file already says which item it is — the reconcile
    // just adds the `@`. Only a genuinely unknown name (another plugin's scheme,
    // or an unrecorded obsolete citekey) asks how to merge.
    const knownPast =
      (!!recorded && noteNameMatchesCitekey(notePath, recorded)) ||
      isBareCitekeyName(notePath, citekey) ||
      (!!recorded && isBareCitekeyName(notePath, recorded));
    if (!knownPast) {
      // `forceAdopt` means the user already said "adopt this note" (the startup
      // review's batch), so the how-to-merge question is already answered:
      // convert it in place.
      const action = foreignNoteAction(
        opts.forceAdopt
          ? 'convert'
          : await resolveForeignNoteHandling(plugin, notePath, citekey, recorded)
      );
      foreignNotesReimport = action.notesReimport;
      if (action.createNew) {
        notePath = null;
      } else if (action.convert) {
        convertedForeign = true;
      } else {
        debugLog('[sw:import] foreign note left alone:', notePath);
        return { ok: true, changed: false };
      }
    }
  }

  // Otherwise use the conventional filename — but NEVER overwrite a foreign
  // note sitting at that name (another library's copy, another work with a
  // similar title, or a user's own note saved there). A suffixed name
  // (`@citekeya`, `@citekeyb`, …) is created instead.
  if (!notePath) {
    const desired = folder ? normalizePath(`${folder}/${base}.md`) : `${base}.md`;
    if (await app.vault.adapter.exists(desired)) {
      // A file already sits at the conventional `@citekey.md` but carries no
      // `sw-zotero-id` — else the key search above would have found it. Ask
      // whether to ADOPT it, rather than silently making a duplicate beside it.
      // `forceAdopt` is set by the startup review's "adopt them all", which is
      // the answer to exactly this question, so it is not asked again.
      const adopt =
        base === `@${citekey}`
          ? opts.forceAdopt
            ? 'adopt'
            : await resolveAdoptHandling(plugin, base)
          : 'new';
      if (adopt === 'adopt') {
        notePath = desired;
      } else if (adopt === 'cancel') {
        return { ok: true, changed: false };
      } else {
        notePath = findAvailableNotePath(base, folder, vaultPaths(app));
        console.warn('[sw:import] note name taken; importing as', notePath);
        new Notice(
          `“${base}.md” already exists; the imported note was saved as “${notePath.split('/').pop()}”.`,
          8000
        );
      }
    } else {
      notePath = desired;
    }
  }

  // Convert-and-rename: move the found note to the conventional `@citekey.md`
  // (citations and future imports then find it there) before re-reading it. If
  // that name is taken by another file, update in place and say so.
  if (convertedForeign && notePath) {
    const desired = folder ? normalizePath(`${folder}/${base}.md`) : `${base}.md`;
    if (notePath !== desired) {
      if (await app.vault.adapter.exists(desired)) {
        // Taken. If it is taken by THIS item's own note — the same stable key —
        // the two files are duplicates, and adopting here would put one
        // `sw-zotero-id` on two notes; every later lookup (updates, citation
        // links) would then reach only the first one. Report it and leave both
        // alone: which to keep is the user's call.
        const takenFile = app.vault.getAbstractFileByPath(desired);
        const takenKey =
          takenFile instanceof TFile
            ? readStableKey(
                app.metadataCache.getFileCache(takenFile)?.frontmatter
              )
            : undefined;
        if (stableKey && takenKey === stableKey) {
          const kept = desired.split('/').pop() ?? desired;
          const other = notePath.split('/').pop() ?? notePath;
          console.warn(
            '[sw:import] two notes claim the same item; keeping',
            desired,
            'and leaving',
            notePath,
            'alone'
          );
          new Notice(
            `ScholarWeft: “${kept}” and “${other}” are both notes for this reference. ` +
              `ScholarWeft updates “${kept}” — please delete or rename “${other}”.`,
            12000
          );
          return { ok: false, changed: false };
        }
        new Notice(
          `“${desired.split('/').pop()}” already exists; “${notePath.split('/').pop()}” was updated under its current name.`,
          8000
        );
      } else {
        const file = app.vault.getAbstractFileByPath(notePath);
        try {
          if (file instanceof TFile) {
            await app.fileManager.renameFile(file, desired);
          } else {
            await app.vault.adapter.rename(notePath, desired);
          }
          notePath = desired;
        } catch (e) {
          console.warn(
            '[sw:import] could not rename foreign note',
            notePath,
            '→',
            desired,
            e
          );
        }
      }
    }
  }

  let existing: string | null = null;
  if (await app.vault.adapter.exists(notePath)) {
    try {
      existing = await app.vault.adapter.read(notePath);
    } catch {
      existing = null;
    }
  }

  // A ZotLit-managed note is either CONVERTED or left alone, per the user's
  // remembered choice or an explicit prompt — never silently reworked. When the
  // user just chose to convert a foreign-named ZotLit note, that choice already
  // answered this, so skip the second prompt.
  if (existing != null && !convertedForeign && isZotLitManaged(existing)) {
    const name = notePath.split('/').pop() ?? notePath;
    if ((await resolveZotLitHandling(plugin, name)) === 'leave') {
      debugLog('[sw:import] leaving the ZotLit-managed note alone:', notePath);
      return { ok: true, changed: false };
    }
    debugLog('[sw:import] converting ZotLit note', notePath);
  }

  // One-time `related` → `sw-related` transfer, for an EXISTING note whose key
  // has not been migrated yet. A brand-new note has no prior `related` to move,
  // so it is simply recorded as done.
  const migrateRelated =
    existing != null && plugin.shouldMigrateRelated(stableKey);

  // Second pass: with the real note path (for `note_link`) and existing content
  // (for the re-import merge).
  const { content } = renderNote(entry, children, {
    templateSource,
    groupID,
    dataDir,
    imageVaultPath,
    notePath,
    collections,
    noteHeadingLevel: plugin.settings.ownNoteNotesHeadingLevel ?? 3,
    existingContent: existing,
    migrateRelated,
    // How the conversion meets the found note's existing `## Notes`: append
    // (keep the user's writing and add Zotero notes below) or ifEmpty (add only
    // when the section is empty).
    options: { notesReimport: foreignNotesReimport },
  });

  if (folder && !(await app.vault.adapter.exists(normalizePath(folder)))) {
    await app.vault.adapter.mkdir(normalizePath(folder));
  }

  if (existing != null) {
    // A re-render of UNCHANGED data must not rewrite the file: the only
    // difference would be the `updated` stamp. `force` is set by the
    // template-update pass, which must advance that stamp.
    if (!opts.force && !substantiveContentDiffers(existing, content)) {
      debugLog('[sw:import] no substantive change; leaving note as is:', notePath);
      return { ok: true, changed: false };
    }
    // Update in place; do NOT reopen — the user may be looking at their edits.
    // Prefer `vault.modify` on a known TFile so Obsidian's metadata cache
    // (frontmatter) refreshes; fall back to the adapter for an unindexed path.
    const known = app.vault.getAbstractFileByPath(notePath);
    if (known instanceof TFile) {
      // The user may be typing in this note. Remember the cursor relative to
      // the BODY (the YAML may grow or shrink) and put it back after Obsidian
      // has picked up the rewritten file.
      const anchors = captureOpenCursors(app, notePath);
      await app.vault.modify(known, content);
      restoreOpenCursors(anchors, content);
    } else {
      await app.vault.adapter.write(notePath, content);
    }
    // Only record the transfer once the note is actually on disk.
    if (migrateRelated) plugin.markRelatedMigrationDone(stableKey);
    return { ok: true, changed: true };
  }

  await app.vault.create(notePath, content);
  // A new note starts clean (empty `related`), so it never needs the transfer.
  plugin.markRelatedMigrationDone(stableKey);
  if (opts.open !== false) {
    await app.workspace.openLinkText(notePath, sourceFile.path, true);
  }
  return { ok: true, changed: true };
}
