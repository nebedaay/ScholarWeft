// The "Format YAML properties" addon.
//
// Makes the `title` / `short-title` / `up` / `related` / `child` frontmatter
// properties stand out in Obsidian's Properties view. The CSS lives in the
// plugin's styles.css, gated on `body.sw-yaml-formatting`; this module only
// toggles that class and sets the two configurable variables. There is no CSS
// snippet, so nothing has to be enabled separately and the styling cannot
// drift from the plugin's own --sw-* functions and colours.
//
// The old versions generated `.obsidian/snippets/sw-yaml-formatting.css`.
// applyYamlFormatting() retires a plugin-generated copy once (keeping it as
// `.retired`); a hand-written copy without the marker is left untouched.

import type ReferenceList from './main';

/** Body class that activates the rules in styles.css. */
export const YAML_FORMATTING_BODY_CLASS = 'sw-yaml-formatting';

/** The retired snippet's id; kept so the migration can disable it. */
export const YAML_FORMATTING_SNIPPET_ID = 'sw-yaml-formatting';

/** Marker that identifies the old snippet as plugin-generated. */
export const YAML_FORMATTING_MARKER = 'Managed by ScholarWeft';

export const DEFAULT_YAML_TITLE_BACKGROUND = '#ffee99';
export const DEFAULT_YAML_TITLE_SIZE = 2;

export interface YamlFormattingOptions {
  /** CSS colour for `--sw-yaml-title-background`. Default `#ffee99`. */
  titleBackground?: string;
  /** Font size for `--sw-yaml-title-size`, in rem. Default `2`. */
  titleSize?: number;
}

/** Normalise the setting values to the strings written to the body. */
export function yamlFormattingValues(
  opts: YamlFormattingOptions = {}
): { background: string; sizeRem: string } {
  const background =
    (opts.titleBackground ?? '').trim() || DEFAULT_YAML_TITLE_BACKGROUND;
  const size =
    Number.isFinite(opts.titleSize) && (opts.titleSize as number) > 0
      ? (opts.titleSize as number)
      : DEFAULT_YAML_TITLE_SIZE;
  return { background, sizeRem: `${size}rem` };
}

/** Every document (main window and pop-outs) the Properties view can live in. */
function documentsOf(plugin: ReferenceList): Document[] {
  const docs = new Set<Document>();
  docs.add(plugin.app.workspace.containerEl.ownerDocument);
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const doc = leaf.view?.containerEl?.ownerDocument;
    if (doc) docs.add(doc);
  });
  return [...docs];
}

/**
 * Retire the old generated snippet once. A plugin-generated copy is disabled,
 * copied to `.retired` and removed; a hand-written file without the marker is
 * left alone (the user can keep or disable it themselves).
 */
async function retireLegacySnippet(plugin: ReferenceList): Promise<void> {
  const app = plugin.app;
  const adapter = app.vault.adapter;
  const path = `${app.vault.configDir}/snippets/${YAML_FORMATTING_SNIPPET_ID}.css`;
  const customCss = (app as unknown as { customCss?: CustomCssLike }).customCss;

  try {
    if (!(await adapter.exists(path))) return;
    const content = await adapter.read(path).catch(() => '');
    if (!content.includes(YAML_FORMATTING_MARKER)) {
      console.debug(
        '[sw:yaml-formatting] leaving your own sw-yaml-formatting.css in place; the plugin now applies its styling directly.'
      );
      return;
    }

    customCss?.setCssEnabledStatus?.(YAML_FORMATTING_SNIPPET_ID, false);
    await adapter.write(`${path}.retired`, content).catch(() => {});
    await adapter.remove(path).catch(() => {});
    customCss?.requestLoadSnippets?.();
  } catch (e) {
    console.warn('[sw:yaml-formatting] could not retire the old snippet', e);
  }
}

/**
 * Apply (or remove) the addon's styling. There is no snippet to write: the
 * rules live in styles.css and are activated by the body class, with the two
 * configurable values passed as CSS variables.
 */
export async function applyYamlFormatting(
  plugin: ReferenceList,
  enabled: boolean
): Promise<void> {
  await retireLegacySnippet(plugin);

  const { background, sizeRem } = yamlFormattingValues({
    titleBackground: plugin.settings.yamlTitleBackground,
    titleSize: plugin.settings.yamlTitleSize,
  });

  for (const doc of documentsOf(plugin)) {
    const body = doc.body;
    body.classList.toggle(YAML_FORMATTING_BODY_CLASS, enabled);
    if (enabled) {
      body.style.setProperty('--sw-yaml-title-background', background);
      body.style.setProperty('--sw-yaml-title-size', sizeRem);
    } else {
      body.style.removeProperty('--sw-yaml-title-background');
      body.style.removeProperty('--sw-yaml-title-size');
    }
  }
}

/** The slice of Obsidian's CustomCSS API the migration uses. */
interface CustomCssLike {
  setCssEnabledStatus?(id: string, enabled: boolean): void;
  requestLoadSnippets?(): void;
}
