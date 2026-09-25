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
import { DEFAULT_ZOTERO_PORT, fetchItemChildrenNative } from './bib/helpers';
import type { RawZoteroChildren } from './template/children';
import { indexedKeyFor, type CachedEntry } from './template/context';
import {
  findAvailableNotePath,
  matchNoteByZoteroKey,
  shouldUpdateOwnNote,
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

/** The literature-note folder, matching the existing creation paths. */
export function literatureNoteFolder(plugin: ReferenceList): string {
  const zotlitFolder = getZotlitLiteratureFolder(plugin.app);
  const settingsFolder = (plugin.settings.literatureNoteFolder ?? '').trim();
  return plugin.settings.useZotlitLiteratureFolder
    ? zotlitFolder || settingsFolder || '_2 Bibliographic notes'
    : settingsFolder || zotlitFolder || '_2 Bibliographic notes';
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

/** Fetch an item's children live; shared with the data explorer preview. */
export async function fetchChildren(
  plugin: ReferenceList,
  entry: CachedEntry | undefined
): Promise<RawZoteroChildren> {
  const key = entry?._zoteroKey;
  if (!key) return EMPTY_CHILDREN;
  const libraryID = entry?.groupID && entry.groupID !== 1 ? entry.groupID : 1;
  try {
    const children = await fetchItemChildrenNative(
      plugin.settings.zoteroPort || DEFAULT_ZOTERO_PORT,
      key,
      libraryID
    );
    return children ?? EMPTY_CHILDREN;
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

  // First pass: no existing note, just to resolve the filename.
  const first = renderNote(entry, children, {
    templateSource,
    groupID,
    dataDir,
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

  // A ZotLit-managed note belongs to ZotLit; never rewrite it with our region.
  if (existing != null && !shouldUpdateOwnNote(existing)) {
    console.warn('[sw:import] leaving the ZotLit-managed note alone:', notePath);
    new Notice(`“${notePath.split('/').pop()}” is managed by ZotLit; skipped.`, 8000);
    return false;
  }

  // Second pass: with the real note path (for `note_link`) and existing content
  // (for the re-import merge).
  const { content } = renderNote(entry, children, {
    templateSource,
    groupID,
    dataDir,
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
