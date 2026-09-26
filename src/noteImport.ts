// Own (non-ZotLit) literature-note creation.
//
// Fetches an item's children from Zotero, renders our single-file template, and
// writes or updates the note. This is the path the `useOwnNoteTemplate` setting
// selects; when it is off, note creation stays on ZotLit / the basic fallback.
//
// Update semantics are the template merge's: only the managed frontmatter fields
// and the `%%sw-managed%%` region are refreshed; the user's own properties and
// writing are preserved.

import { App, Notice, TFile, normalizePath } from 'obsidian';
import type ReferenceList from './main';
import {
  DEFAULT_ZOTERO_PORT,
  citekeysForItemKeys,
  fetchItemChildrenNative,
  fetchItemRelationsNative,
} from './bib/helpers';
import type { NoteContextRelatedItem } from './template/context';
import type { RawZoteroChildren } from './template/children';
import {
  DEFAULT_LITERATURE_NOTE_FOLDER,
  resolveLiteratureNoteFolder,
} from './template/lit-folder';
export { DEFAULT_LITERATURE_NOTE_FOLDER } from './template/lit-folder';
import {
  excerptImageName,
  findPreviousImagePath,
} from './template/excerpt-images';
import { indexedKeyFor, type CachedEntry } from './template/context';
import {
  findAvailableNotePath,
  isZotLitManaged,
  matchNoteByZoteroKey,
  zotLitChoice,
  type ZotLitHandling,
} from './template/note-lookup';
import { renderNote } from './template/render';
import { getZotlitLiteratureFolder } from './zotlit';

declare const require: (id: string) => any;

/** Where our template is extracted, relative to the plugin directory. */
const TEMPLATE_ASSET = 'sw-note-templates/sw-note.eta.md';

const EMPTY_CHILDREN: RawZoteroChildren = {
  attachments: [],
  annotations: [],
  notes: [],
};

function expandHome(p: string): string {
  if (p === '~' || p === '~/') return require('os').homedir();
  if (p.startsWith('~/')) return require('os').homedir() + p.slice(1);
  return p;
}

/**
 * The Zotero data directory: the configured folder, else the platform default
 * if it exists. Needed to resolve on-disk attachment paths and annotation
 * excerpt images, which the API does not expose. Pure best-effort — a wrong
 * value just yields links that don't resolve, never a failure.
 */
export function resolveZoteroDataDir(configured?: string): string | null {
  const custom = (configured ?? '').trim();
  if (custom) return expandHome(custom);
  try {
    const os = require('os') as typeof import('os');
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const home = os.homedir();
    const platform = (window as any).process?.platform;
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
    useOwnNoteTemplate: plugin.settings.useOwnNoteTemplate,
    literatureNoteFolder: plugin.settings.literatureNoteFolder,
    zotlitFolder: getZotlitLiteratureFolder(plugin.app),
  });
}

/** Read the bundled own note template; also used by the data explorer preview. */
export async function readTemplate(plugin: ReferenceList): Promise<string | null> {
  const dir = plugin.manifest.dir;
  if (!dir) return null;
  const path = normalizePath(`${dir}/${TEMPLATE_ASSET}`);
  try {
    return await plugin.app.vault.adapter.read(path);
  } catch (e) {
    console.warn('[sw:import] note template not found at', path, e);
    return null;
  }
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
  entry: CachedEntry | undefined
): Promise<RawZoteroChildren> {
  const key = entry?._zoteroKey;
  if (!key) return EMPTY_CHILDREN;
  const libraryID = entry?.groupID && entry.groupID !== 1 ? entry.groupID : 1;
  const port = plugin.settings.zoteroPort || DEFAULT_ZOTERO_PORT;
  try {
    const [children, relatedKeys] = await Promise.all([
      fetchItemChildrenNative(port, key, libraryID),
      fetchItemRelationsNative(port, key, libraryID),
    ]);
    const base = children ?? EMPTY_CHILDREN;
    if (!relatedKeys.length) return base;

    const citekeys = await citekeysForItemKeys(port, relatedKeys, libraryID);
    const relatedItems: NoteContextRelatedItem[] = relatedKeys.map((k) => {
      const citationKey = citekeys.get(k) ?? null;
      // A related item with no citekey can't be linked; keep it out of the list
      // rather than emitting a broken `[[@]]`.
      return { key: k, citationKey, title: null as string | null };
    });
    return { ...base, relatedItems: relatedItems.filter((r) => r.citationKey) };
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
    zoteroKey: app.metadataCache.getFileCache(f)?.frontmatter?.['zotero-key'],
  }));
  return matchNoteByZoteroKey(candidates, folder, zoteroKey);
}

/** Every vault path, so a fresh note name can be checked without I/O. */
function vaultPaths(app: App): Set<string> {
  return new Set(app.vault.getFiles().map((f) => f.path));
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
  opts: { open?: boolean } = {}
): Promise<boolean> {
  const app = plugin.app;
  const templateSource = await readTemplate(plugin);
  if (!templateSource) return false;

  const children = await fetchChildren(plugin, entry);
  const groupID = entry?.groupID && entry.groupID !== 1 ? entry.groupID : null;
  const dataDir = resolveZoteroDataDir(plugin.settings.zoteroDataDir);
  const folder = literatureNoteFolder(plugin);

  // Copy excerpt images into the vault first, so the render links them as
  // `![[…]]` (renderable, opens in Obsidian) and not `file://` cache paths.
  const images = await copyExcerptImages(plugin, citekey, children, groupID, dataDir);
  const imageVaultPath = (key: string) => images.get(key) ?? null;

  // First pass: no existing note, just to resolve the filename.
  const first = renderNote(entry, children, {
    templateSource,
    groupID,
    dataDir,
    imageVaultPath,
    noteHeadingLevel: plugin.settings.ownNoteNotesHeadingLevel ?? 3,
  });
  const base = (first.fileName || `@${citekey}`).replace(/\.md$/i, '');
  const stableKey = indexedKeyFor(
    typeof entry?._zoteroKey === 'string' ? entry._zoteroKey : '',
    groupID
  );

  // Locate by the stable Zotero key FIRST, as ZotLit does: the note that owns
  // this item is the one to update, whatever its filename.
  let notePath: string | null = stableKey
    ? findNoteByZoteroKey(app, folder, stableKey)
    : null;

  // Otherwise use the conventional filename — but NEVER overwrite a foreign
  // note sitting at that name (another library's copy, another work with a
  // similar title, or a user's own note saved there). A suffixed name
  // (`@citekeya`, `@citekeyb`, …) is created instead.
  if (!notePath) {
    const desired = folder ? normalizePath(`${folder}/${base}.md`) : `${base}.md`;
    if (await app.vault.adapter.exists(desired)) {
      notePath = findAvailableNotePath(base, folder, vaultPaths(app));
      console.warn('[sw:import] note name taken; importing as', notePath);
      new Notice(
        `“${base}.md” already exists; the imported note was saved as “${notePath.split('/').pop()}”.`,
        8000
      );
    } else {
      notePath = desired;
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
  // remembered choice or an explicit prompt — never silently reworked.
  if (existing != null && isZotLitManaged(existing)) {
    const name = notePath.split('/').pop() ?? notePath;
    if ((await resolveZotLitHandling(plugin, name)) === 'leave') {
      console.log('[sw:import] leaving the ZotLit-managed note alone:', notePath);
      return true;
    }
    console.log('[sw:import] converting ZotLit note', notePath);
  }

  // Second pass: with the real note path (for `note_link`) and existing content
  // (for the re-import merge).
  const { content } = renderNote(entry, children, {
    templateSource,
    groupID,
    dataDir,
    imageVaultPath,
    notePath,
    noteHeadingLevel: plugin.settings.ownNoteNotesHeadingLevel ?? 3,
    existingContent: existing,
  });

  if (folder && !(await app.vault.adapter.exists(normalizePath(folder)))) {
    await app.vault.adapter.mkdir(normalizePath(folder));
  }

  if (existing != null) {
    // Update in place; do NOT reopen — the user may be looking at their edits.
    // Prefer `vault.modify` on a known TFile so Obsidian's metadata cache
    // (frontmatter) refreshes; fall back to the adapter for an unindexed path.
    const known = app.vault.getAbstractFileByPath(notePath);
    if (known instanceof TFile) {
      await app.vault.modify(known, content);
    } else {
      await app.vault.adapter.write(notePath, content);
    }
    return true;
  }

  await app.vault.create(notePath, content);
  if (opts.open !== false) {
    await app.workspace.openLinkText(notePath, sourceFile.path, true);
  }
  return true;
}
