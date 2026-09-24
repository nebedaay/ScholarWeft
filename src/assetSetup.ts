import { normalizePath } from 'obsidian';
import type ReferenceList from './main';
import { debugLog } from './helpers';
import { BUNDLED_ASSETS } from 'bundled:assets';

// Folder names are duplicated deliberately: importing them from the template
// modules would create a cycle (those modules call back into this one to record
// the opt-in), which drags their UI graph into `assetSetup` and its tests.
const SW_ZOTLIT_FOLDER = 'sw-zotlit-templates';
const SW_MARKDOWN_FOLDER = 'sw-markdown-templates';

/**
 * Extract bundled scripts, templates, and icons into the plugin's own directory.
 *
 * Files live at  <vault>/<plugin.manifest.dir>/scripts/  and  .../sw-export-templates/
 * — the same relative locations they occupy in the source repo — so all
 * existing paths in the Python scripts and plugin settings continue to work
 * without modification.
 *
 * Extraction is content-aware: a small stamp file (`.sw-assets.json`) records
 * the hash of every asset we last wrote, and an asset is rewritten only when
 * its bundled bytes change (a new plugin build) or the file has gone missing.
 * This replaces the old "rewrite everything on every load" behaviour, which
 * churned ~5 MB on each Obsidian start for no gain. Unlike the even older
 * "only write when the version changed" scheme, a changed asset always
 * rewrites, so a BRAT update can never leave stale scripts/templates behind.
 *
 * The folders are plugin-managed output, not a place to hand-edit: the
 * supported customization path is to copy a template out of this folder into
 * the user's own Export Templates folder (see `exportTemplatesDir` in
 * settings) and edit the copy there. A local edit made directly here is left
 * in place until the bundled asset next changes, at which point it is
 * overwritten.
 */
/**
 * Record that the user opted in to a template folder, so future plugin updates
 * maintain it (see `setupAssets`). Called by the settings buttons that install
 * templates. Deletion is the opt-out: `setupAssets` prunes the record when the
 * folder is gone, and never re-creates it.
 */
export async function recordTemplateOptIn(
  plugin: ReferenceList,
  folder: string
): Promise<void> {
  const stampPath = normalizePath(
    `${plugin.manifest.dir}/.sw-assets.json`
  );
  let data: { version: number; hashes: Record<string, string>; templateOptIns: string[] } = {
    version: 1,
    hashes: {},
    templateOptIns: [],
  };
  try {
    const parsed = JSON.parse(await plugin.app.vault.adapter.read(stampPath));
    if (parsed?.version === 1) {
      data = {
        version: 1,
        hashes: parsed.hashes ?? {},
        templateOptIns: Array.isArray(parsed.templateOptIns)
          ? parsed.templateOptIns
          : [],
      };
    }
  } catch {
    /* no stamp yet */
  }
  if (!data.templateOptIns.includes(folder)) {
    data.templateOptIns.push(folder);
  }
  try {
    await plugin.app.vault.adapter.write(stampPath, JSON.stringify(data));
  } catch (e) {
    console.warn('ScholarWeft: failed to record template opt-in:', e);
  }
}

export async function setupAssets(plugin: ReferenceList): Promise<void> {
  const { app, manifest } = plugin;
  const pluginDir = manifest.dir; // e.g. ".obsidian/plugins/scholar-weft"

  // Only these live in the plugin dir; docs/README/images and the opt-in
  // template folders (written into the vault by settings buttons) are used
  // straight from the bundle and never extracted.
  const extractable = Object.entries(BUNDLED_ASSETS).filter(
    ([relativePath]) =>
      !relativePath.startsWith('sw-markdown-templates/') &&
      !relativePath.startsWith('sw-zotlit-templates/') &&
      !relativePath.startsWith('docs/') &&
      !relativePath.startsWith('images/') &&
      relativePath !== 'README.md' &&
      relativePath !== 'NOTICE.md'
  );

  // What we last extracted, so unchanged assets aren't rewritten every load.
  const stampPath = normalizePath(`${pluginDir}/.sw-assets.json`);
  let stamp: Record<string, string> = {};
  /**
   * Template folders the user has chosen to install. These are OPT-IN and then
   * MAINTAINED: once chosen, they track plugin updates (a changed template is
   * recopied). But they are never RE-created after the user deletes them —
   * absence is the opt-out, so recreating would fight the user.
   */
  let optedIn: string[] = [];
  let originalStampJson = '';
  try {
    const raw = await app.vault.adapter.read(stampPath);
    originalStampJson = raw;
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.hashes) stamp = parsed.hashes;
    if (parsed?.version === 1 && Array.isArray(parsed.templateOptIns)) {
      optedIn = parsed.templateOptIns;
    }
  } catch {
    // no stamp yet — first run, or it was removed
  }

  // Create the subdirectories we need.
  const dirs = new Set<string>();
  for (const [relativePath] of extractable) {
    const slash = relativePath.lastIndexOf('/');
    if (slash > 0) dirs.add(normalizePath(`${pluginDir}/${relativePath.slice(0, slash)}`));
  }
  for (const dir of dirs) {
    try {
      await app.vault.adapter.mkdir(dir);
    } catch {
      // Directory already exists — that's fine.
    }
  }

  let written = 0;
  let unchanged = 0;
  let failed = 0;
  for (const [relativePath, { content, binary, hash }] of extractable) {
    const fullPath = normalizePath(`${pluginDir}/${relativePath}`);
    // Skip when this exact content was already written and the file is still
    // present (so a hand-deleted asset is restored).
    if (stamp[relativePath] === hash && (await app.vault.adapter.exists(fullPath))) {
      unchanged++;
      continue;
    }
    try {
      if (binary) {
        const raw = atob(content);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        await app.vault.adapter.writeBinary(fullPath, buf.buffer);
      } else {
        await app.vault.adapter.write(fullPath, content);
      }
      stamp[relativePath] = hash;
      written++;
    } catch (e) {
      // Leave this asset out of the stamp so it is retried on the next load.
      failed++;
      console.warn(`ScholarWeft: failed to write bundled asset "${relativePath}":`, e);
    }
  }

  debugLog(
    `ScholarWeft ${manifest.version}: assets ${written} written, ${unchanged} unchanged`
      + (failed ? `, ${failed} failed` : '')
  );

  // Opt-in template folders: MAINTAIN, never re-create.
  //
  // The main loop above excludes these (they are written on demand by the
  // settings buttons, so a user who never opts in gets nothing). But once a
  // user HAS opted in, the templates should travel with the plugin: when a
  // build changes a template, the installed copy updates too. And if the user
  // has deleted the folder, that is the opt-out — leave it deleted.
  for (const folder of [SW_ZOTLIT_FOLDER, SW_MARKDOWN_FOLDER]) {
    if (!optedIn.includes(folder)) continue;
    const dir = normalizePath(folder);
    if (!(await app.vault.adapter.exists(dir))) {
      // User removed it → they no longer want it. Forget the opt-in.
      optedIn = optedIn.filter((f) => f !== folder);
      continue;
    }
    const templates = Object.entries(BUNDLED_ASSETS).filter(([p]) =>
      p.startsWith(`${folder}/`)
    );
    for (const [relativePath, asset] of templates) {
      const key = `template:${relativePath}`;
      const fullPath = normalizePath(relativePath);
      if (stamp[key] === asset.hash && (await app.vault.adapter.exists(fullPath))) {
        unchanged++;
        continue;
      }
      try {
        await app.vault.adapter.write(fullPath, asset.content);
        stamp[key] = asset.hash;
        written++;
      } catch (e) {
        failed++;
        console.warn(`ScholarWeft: failed to update template "${relativePath}":`, e);
      }
    }
  }

  // Persist the stamp — only when something actually changed, so a no-op load
  // writes nothing. (The opt-in list is included, so a prune does get saved.)
  const stampJson = JSON.stringify({
    version: 1,
    hashes: stamp,
    templateOptIns: optedIn,
  });
  if (stampJson !== originalStampJson) {
    try {
      await app.vault.adapter.write(stampPath, stampJson);
    } catch (e) {
      console.warn('ScholarWeft: failed to write the asset stamp:', e);
    }
  }

  // Legacy stamp file from older versions — remove it so nothing keys off it.
  try {
    await app.vault.adapter.remove(normalizePath(`${pluginDir}/.asset-version`));
  } catch {
    // not present — fine
  }
}
