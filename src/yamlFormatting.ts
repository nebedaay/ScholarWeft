// The "Format YAML properties" addon.
//
// Makes the `title` / `short-title` / `up` / `related` / `child` frontmatter
// properties stand out in Obsidian's Properties view. The CSS is the user's own
// `sw-yaml-formatting.css`; the plugin OWNS that snippet file and writes the two
// configurable values (`--title-background`, `--title-size`) into it.
//
// The snippet's `@function` helpers and nesting are valid modern CSS (W3C CSS
// Functions & Mixins / Nesting) — do NOT "clean them up". They are copied
// verbatim from the user's file.

import type ReferenceList from './main';

/** Snippet name (file stem) the addon manages in `.obsidian/snippets/`. */
export const YAML_FORMATTING_SNIPPET_ID = 'sw-yaml-formatting';

/** Marker that identifies the file as plugin-generated (so it is not backed up). */
export const YAML_FORMATTING_MARKER = 'Managed by ScholarWeft';

export const DEFAULT_YAML_TITLE_BACKGROUND = '#ffee99';
export const DEFAULT_YAML_TITLE_SIZE = 2;

export interface YamlFormattingOptions {
  /** CSS colour for `--title-background`. Default `#ffee99`. */
  titleBackground?: string;
  /** Font size for `--title-size`, in rem. Default `2`. */
  titleSize?: number;
}

/** The `--up-icon` arrow, copied verbatim from the user's snippet. */
const UP_ICON =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.75' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-arrow-up-from-dot-icon lucide-arrow-up-from-dot'%3E%3Cpath d='m5 9 7-7 7 7'/%3E%3Cpath d='M12 16V2'/%3E%3Ccircle cx='12' cy='21' r='1'/%3E%3C/svg%3E")`;

/**
 * The full snippet CSS with the two configurable variables substituted. Pure,
 * so it is unit-testable. Everything except `--title-background` and
 * `--title-size` is the user's original snippet, unchanged.
 */
export function buildYamlFormattingCss(
  opts: YamlFormattingOptions = {}
): string {
  const background =
    (opts.titleBackground ?? '').trim() || DEFAULT_YAML_TITLE_BACKGROUND;
  const size =
    Number.isFinite(opts.titleSize) && (opts.titleSize as number) > 0
      ? (opts.titleSize as number)
      : DEFAULT_YAML_TITLE_SIZE;

  return `/*
---------------------------
YAML FRONTMATTER FORMATTING FOR DIVERSE NOTES TO MAKE TITLE, UP, AND RELATED PROPERTIES STAND OUT
---------------------------
${YAML_FORMATTING_MARKER}. Edit it from Settings → ScholarWeft → Addons for displaying and linking notes.
*/


@function --arrow-gradient(--hue) {
  result: linear-gradient(0deg,  --bright(var(--orange)) 25%, --light(var(--hue)) 25%, --bright(var(--hue)) 40%, --dark(var(--hue)) 100%);
}

@function --dashboard-gradient(--hue) {
    result: radial-gradient(circle at 60% 50%, --light(var(--hue)) 0%, --bright(var(--hue)) 200%);
}

:root {


    --up-icon: ${UP_ICON};

    --title-background: ${background};
    --title-size: ${size}rem;

}


/*
---
Make TITLE property stand out
---
*/

.metadata-property[data-property-key="title"] .metadata-property-value {
    font-size: var(--title-size)!important;
    padding: 1rem;
    text-align: center;
}

.metadata-property[data-property-key="title"], .metadata-property[data-property-key="short-title"], .metadata-property[data-property-key="shorttitle"] {
    .metadata-property-value {
        background: var(--title-background);
    }
}


/*
---
Arrows on the "up" and "related" property items
---
*/

.metadata-property[data-property-key="up"], .metadata-property[data-property-key="related"], .metadata-property[data-property-key="child"] {
        .multi-select-pill-content::before {
        content: '';
        padding:0px;
        display: inline-block;
        width: 1rem;
        height: 1rem;
        margin-right: 0.2rem;
        float: left;
        vertical-align: middle;
        mask-image: var(--up-icon);
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
    }
}

.metadata-property[data-property-key="up"] .multi-select-pill-content::before {
        background-image: --arrow-gradient(var(--green));
}

.metadata-property[data-property-key="related"] .multi-select-pill-content::before {
    background-image: --arrow-gradient(var(--blue));
    rotate:90deg;
}

.metadata-property[data-property-key="child"] .multi-select-pill-content::before {
    background-image: --arrow-gradient(var(--blue));
    rotate:180deg;
}
`;
}

/** The vault-relative snippets folder. */
function snippetsFolder(plugin: ReferenceList): string {
  return `${plugin.app.vault.configDir}/snippets`;
}

/**
 * Write (and enable/disable) the YAML-formatting snippet to match the settings.
 * A pre-existing hand-written `sw-yaml-formatting.css` is backed up once to
 * `sw-yaml-formatting.css.bak` before the first overwrite, so nothing is lost.
 */
export async function applyYamlFormatting(
  plugin: ReferenceList,
  enabled: boolean
): Promise<void> {
  const app = plugin.app;
  const adapter = app.vault.adapter;
  const folder = snippetsFolder(plugin);
  const path = `${folder}/${YAML_FORMATTING_SNIPPET_ID}.css`;

  try {
    if (enabled) {
      if (!(await adapter.exists(folder))) await adapter.mkdir(folder);

      if (await adapter.exists(path)) {
        const existing = await adapter.read(path).catch(() => '');
        if (existing && !existing.includes(YAML_FORMATTING_MARKER)) {
          const backup = `${path}.bak`;
          if (!(await adapter.exists(backup))) await adapter.write(backup, existing);
        }
      }

      const css = buildYamlFormattingCss({
        titleBackground: plugin.settings.yamlTitleBackground,
        titleSize: plugin.settings.yamlTitleSize,
      });
      await adapter.write(path, css);
    }

    // Runtime-only API (not in the 1.8.7 typings): enable/disable + reload.
    const customCss = (app as unknown as { customCss?: CustomCssLike }).customCss;
    customCss?.setCssEnabledStatus?.(YAML_FORMATTING_SNIPPET_ID, enabled);
    customCss?.requestLoadSnippets?.();
  } catch (e) {
    console.warn('[sw:yaml-formatting] could not update the snippet', e);
  }
}

/** The slice of Obsidian's CustomCSS API this addon uses. */
interface CustomCssLike {
  setCssEnabledStatus?(id: string, enabled: boolean): void;
  requestLoadSnippets?(): void;
}
