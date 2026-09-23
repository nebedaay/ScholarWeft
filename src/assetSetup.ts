import { normalizePath } from 'obsidian';
import type ReferenceList from './main';
import { BUNDLED_ASSETS } from 'bundled:assets';

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
  try {
    const parsed = JSON.parse(await app.vault.adapter.read(stampPath));
    if (parsed?.version === 1 && parsed.hashes) stamp = parsed.hashes;
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

  const nextStamp: Record<string, string> = {};
  let written = 0;
  let unchanged = 0;
  let failed = 0;
  for (const [relativePath, { content, binary, hash }] of extractable) {
    const fullPath = normalizePath(`${pluginDir}/${relativePath}`);
    // Skip when this exact content was already written and the file is still
    // present (so a hand-deleted asset is restored).
    if (stamp[relativePath] === hash && (await app.vault.adapter.exists(fullPath))) {
      nextStamp[relativePath] = hash;
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
      nextStamp[relativePath] = hash;
      written++;
    } catch (e) {
      // Leave this asset out of the stamp so it is retried on the next load.
      failed++;
      console.warn(`ScholarWeft: failed to write bundled asset "${relativePath}":`, e);
    }
  }

  if (JSON.stringify(nextStamp) !== JSON.stringify(stamp)) {
    try {
      await app.vault.adapter.write(
        stampPath,
        JSON.stringify({ version: 1, hashes: nextStamp })
      );
    } catch (e) {
      console.warn('ScholarWeft: failed to write the asset stamp:', e);
    }
  }

  console.log(
    `ScholarWeft ${manifest.version}: assets ${written} written, ${unchanged} unchanged`
      + (failed ? `, ${failed} failed` : '')
  );

  // Legacy stamp file from older versions — remove it so nothing keys off it.
  try {
    await app.vault.adapter.remove(normalizePath(`${pluginDir}/.asset-version`));
  } catch {
    // not present — fine
  }
}
