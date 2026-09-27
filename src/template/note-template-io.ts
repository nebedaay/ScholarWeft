// Reads the literature-note template: the bundled file extracted into the
// plugin folder, or a user-editable copy in the vault.
//
// Kept separate from `noteImport.ts` so this small I/O layer can be unit-tested
// without dragging in the Zotero/BBT graph (and its native-ish dependencies).

import { normalizePath } from 'obsidian';
import type ReferenceList from '../main';
import { customNoteTemplatePath, templateCopyPath } from './note-template';

/** Where the bundled template is extracted, relative to the plugin directory. */
export const TEMPLATE_ASSET = 'sw-note-templates/sw-note.eta.md';

/** Read the bundled template extracted into the plugin folder. */
async function readBundledTemplate(
  plugin: ReferenceList
): Promise<string | null> {
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
 * Read the template to render a note with: the user's chosen vault file when
 * "Use the default template" is off, else — or when that file is missing or
 * empty — the bundled template. Also used by the data explorer preview, so the
 * preview always matches what an import would write.
 */
export async function readTemplate(
  plugin: ReferenceList
): Promise<string | null> {
  const custom = customNoteTemplatePath(plugin.settings);
  if (custom) {
    const path = normalizePath(custom);
    try {
      const text = await plugin.app.vault.adapter.read(path);
      if (text.trim()) return text;
      console.warn('[sw:import] custom note template is empty at', path);
    } catch (e) {
      console.warn('[sw:import] custom note template not found at', path, e);
    }
  }
  return readBundledTemplate(plugin);
}

/**
 * Copy the bundled template into a vault folder so the user can edit it.
 * Returns the vault-relative path of the copy, or null if the bundled template
 * cannot be read. Never overwrites an existing file — a taken name is suffixed.
 */
export async function copyDefaultTemplateToVault(
  plugin: ReferenceList,
  folder: string
): Promise<string | null> {
  const source = await readBundledTemplate(plugin);
  if (!source) return null;
  const path = templateCopyPath(
    folder,
    plugin.app.vault.getFiles().map((f) => f.path)
  );
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  if (dir && !(await plugin.app.vault.adapter.exists(normalizePath(dir)))) {
    await plugin.app.vault.adapter.mkdir(normalizePath(dir));
  }
  await plugin.app.vault.adapter.write(normalizePath(path), source);
  return path;
}
