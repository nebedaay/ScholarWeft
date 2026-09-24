import { Notice, normalizePath } from 'obsidian';
import type ReferenceList from './main';
import { BUNDLED_ASSETS } from 'bundled:assets';

/**
 * Folder (vault-relative) where ScholarWeft's ZotLit import templates are
 * installed. Deliberately NOT "Templates" so a one-click install can't clobber
 * a user's own ZotLit templates — this folder is ScholarWeft-managed.
 */
export const SW_ZOTLIT_FOLDER = 'sw-zotlit-templates';

const ZOTLIT_PLUGIN_ID = 'zotlit';

export interface ZotlitInstallResult {
  written: string[];
  folder: string;
  zotlitDetected: boolean;
  folderConfigured: boolean;
  /** ZotLit's `note.frontmatter-fields` was written from the bundled mappings. */
  fieldsConfigured: boolean;
  /** ZotLit's device-local "JavaScript templates" gate is on (required for the
   *  bundled `.eta.md` templates and the JavaScript frontmatter fields). */
  jsTemplatesEnabled: boolean;
  reloadedZotlit: boolean;
  error?: string;
}

/**
 * The frontmatter field mappings that make ZotLit's import produce
 * ScholarWeft's note shape (the `zt.*` → property expressions the templates
 * rely on). Bundled as JSON so the install button can write them into ZotLit's
 * settings — a template folder alone does NOT reproduce them.
 */
function bundledFrontmatterFields(): unknown[] | null {
  const asset =
    BUNDLED_ASSETS['sw-zotlit-settings/frontmatter-fields.json'];
  if (!asset) return null;
  try {
    const parsed = JSON.parse(asset.content);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * ZotLit's "JavaScript templates" gate is a DEVICE-LOCAL setting (Obsidian's
 * per-device local storage), NOT in data.json — same idea as Templater's
 * trigger. Without it the bundled `.eta.md` templates and the JavaScript
 * frontmatter fields are inert. Set the local key directly (the user opted in
 * by installing these templates); ZotLit reads `'1'` on next load.
 */
const ZOTLIT_JS_TEMPLATES_KEY = 'zotlit-javascript-templates';

function enableZotlitJavaScriptTemplates(app: unknown): boolean {
  try {
    const a = app as {
      loadLocalStorage?: (k: string) => unknown;
      saveLocalStorage?: (k: string, v: unknown) => void;
    };
    if (a.loadLocalStorage?.(ZOTLIT_JS_TEMPLATES_KEY) !== '1') {
      a.saveLocalStorage?.(ZOTLIT_JS_TEMPLATES_KEY, '1');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the bundled ZotLit templates into `SW_ZOTLIT_FOLDER` and, when ZotLit
 * is installed, point its "Template folder" setting at that folder (reloading
 * ZotLit so it takes effect immediately).
 */
export async function installZotlitTemplates(
  plugin: ReferenceList
): Promise<ZotlitInstallResult> {
  const { app } = plugin;
  const adapter = app.vault.adapter;
  const result: ZotlitInstallResult = {
    written: [],
    folder: SW_ZOTLIT_FOLDER,
    zotlitDetected: false,
    folderConfigured: false,
    fieldsConfigured: false,
    jsTemplatesEnabled: false,
    reloadedZotlit: false,
  };

  const entries = Object.entries(BUNDLED_ASSETS).filter(([p]) =>
    p.startsWith('sw-zotlit-templates/')
  );
  if (entries.length === 0) {
    result.error = 'No bundled ZotLit templates found in this build.';
    return result;
  }

  try {
    if (!(await adapter.exists(SW_ZOTLIT_FOLDER))) {
      await adapter.mkdir(SW_ZOTLIT_FOLDER);
    }
    for (const [relativePath, asset] of entries) {
      const name = relativePath.slice('sw-zotlit-templates/'.length);
      await adapter.write(
        normalizePath(`${SW_ZOTLIT_FOLDER}/${name}`),
        asset.content
      );
      result.written.push(name);
    }
  } catch (e) {
    result.error = `Could not write templates: ${(e as Error).message}`;
    return result;
  }

  // Point ZotLit's "Template folder" at our folder, but only when ZotLit is
  // actually loaded. We never create or clobber ZotLit's settings file when
  // ZotLit isn't there to read it — writing a settings file for a plugin that
  // doesn't exist (or that has its own file) is how you brick it.
  const anyApp = app as any;
  const zotlit = anyApp.plugins?.plugins?.[ZOTLIT_PLUGIN_ID];
  result.zotlitDetected = !!zotlit;
  if (zotlit) {
    const dataPath = normalizePath(
      `${app.vault.configDir}/plugins/${ZOTLIT_PLUGIN_ID}/data.json`
    );
    // Quiesce ZotLit FIRST: disabling it makes it flush its own settings to
    // data.json, so our write happens last and cannot interleave with its save.
    // (Writing while it is live — or right before a disable — races two writers
    // and can corrupt the file, after which ZotLit fails to load.)
    let disabled = false;
    try {
      await anyApp.plugins.disablePlugin(ZOTLIT_PLUGIN_ID);
      disabled = true;
    } catch {
      /* couldn't disable — we'll still write, but won't reload at the end */
    }
    try {
      const existing = (await adapter.exists(dataPath))
        ? await adapter.read(dataPath)
        : null;
      let data: Record<string, unknown>;
      if (existing && existing.trim()) {
        try {
          data = JSON.parse(existing);
        } catch {
          // Never overwrite an unreadable settings file — that turns a bad file
          // into a bricked plugin. Leave it alone and tell the user.
          result.error =
            "ZotLit's settings file couldn't be parsed, so it was left " +
            `untouched — set ZotLit's "Template folder" to ${SW_ZOTLIT_FOLDER} manually.`;
          return result;
        }
      } else {
        data = {};
      }
      if (existing !== null) {
        await adapter.write(`${dataPath}.scholarweft.bak`, existing);
      }
      // ZotLit stores settings as flat dot-keys.
      data['template.folder'] = SW_ZOTLIT_FOLDER;
      result.folderConfigured = true;
      // Frontmatter is driven by ZotLit's SETTINGS, not its templates, so the
      // template folder alone doesn't reproduce the import output. Write the
      // bundled field mappings too (a .scholarweft.bak backup is kept above).
      const fields = bundledFrontmatterFields();
      if (fields) {
        data['note.frontmatter-fields'] = fields;
        result.fieldsConfigured = true;
      }
      await adapter.write(dataPath, JSON.stringify(data, null, 2));
    } catch (e) {
      result.error = `Templates installed, but could not update ZotLit's setting: ${(e as Error).message}`;
    } finally {
      if (disabled) {
        try {
          // Re-enable so ZotLit re-reads data.json now rather than on next launch.
          await anyApp.plugins.enablePlugin(ZOTLIT_PLUGIN_ID);
          result.reloadedZotlit = true;
        } catch {
          /* the written setting still applies after a restart */
        }
      }
    }
  }

  // Enable ZotLit's device-local "JavaScript templates" gate (see above). Write
  // the local key so it sticks across restarts, and — when ZotLit is loaded —
  // ask its own API to flip the live flag so the templates work immediately.
  result.jsTemplatesEnabled = enableZotlitJavaScriptTemplates(app);
  if (result.jsTemplatesEnabled && result.zotlitDetected) {
    try {
      const templateSvc =
        (app as any).plugins?.plugins?.[ZOTLIT_PLUGIN_ID]?.services?.template;
      if (
        templateSvc?.setJavascriptTemplatesEnabled &&
        !templateSvc.javascriptTemplatesEnabled
      ) {
        await templateSvc.setJavascriptTemplatesEnabled(true);
      }
    } catch {
      /* the local key still applies on the next Obsidian load */
    }
  }

  return result;
}

/** Run the install and show a Notice describing what happened. */
export async function installZotlitTemplatesWithNotice(
  plugin: ReferenceList
): Promise<void> {
  const r = await installZotlitTemplates(plugin);
  if (r.error && r.written.length === 0) {
    new Notice(`ScholarWeft: ${r.error}`, 8000);
    return;
  }
  const lines = [`Installed ${r.written.length} ZotLit template(s) to ${r.folder}/`];
  if (r.zotlitDetected) {
    if (r.folderConfigured) {
      lines.push(
        r.reloadedZotlit
          ? `ZotLit's Template folder set to ${r.folder} (ZotLit reloaded).`
          : `ZotLit's Template folder set to ${r.folder} — restart Obsidian to apply.`
      );
    }
    if (r.fieldsConfigured) {
      lines.push(
        "ZotLit's frontmatter field mappings set (the previous settings were " +
          'backed up as data.json.scholarweft.bak).'
      );
    }
    if (r.jsTemplatesEnabled) {
      lines.push(
        'ZotLit\'s "JavaScript templates" setting was enabled (the bundled ' +
          'templates require it).'
      );
    } else {
      lines.push(
        'In ZotLit\'s settings, turn on "JavaScript templates" so the ' +
          'installed templates render (and confirm its warning).'
      );
    }
    if (r.error) lines.push(r.error);
  } else {
    lines.push(
      `ZotLit not detected — set its "Template folder" to ${r.folder} manually.`
    );
  }
  new Notice(`ScholarWeft: ${lines.join('\n')}`, 9000);
}
