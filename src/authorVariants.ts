// Author-name variants: alternate creator names that resolve to one main author
// page.
//
// `variants` on the main author note is the source of truth. It is a list of
// exact creator display names (`Last, First`, or a literal name). The plugin
// uses it in two places:
//
//   * template rendering resolves a creator name to `[[Main, Author|Variant]]`;
//   * existing frontmatter creator properties are rewritten to that form when a
//     variant is added.
//
// `aliases` on the main note is deliberately NOT parsed as variants. The plugin
// may add display/autocomplete aliases derived from a variant (the variant and
// its `First Last` form), but an alias alone never means “this is the same
// author”. That distinction is what keeps a display alias from becoming a
// second variant.

import {
  FuzzySuggestModal,
  Notice,
  TFile,
} from 'obsidian';

import type ReferenceList from './main';
import {
  CSL_CREATOR_ROLES,
  hasAuthorsUp,
  isMergeablePath,
  refreshAuthorPage,
  variantsOf,
} from './authorNotes';
import { joinNote, mergeFrontmatter, parseFrontmatter, splitNote } from './template/merge';
import {
  serializeProperty,
  type YamlFieldSpec,
} from './template/yaml';
import { t } from './lang/helpers';

/** Normalise a frontmatter variant value to the display name it names. */
export function cleanVariantName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  const link = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/.exec(value);
  if (link) value = link[1];
  value = value.replace(/^["']|["']$/g, '').trim();
  return value;
}

/** Values of a frontmatter list/scalar, read from the raw YAML (not stale cache). */
function frontmatterValues(frontmatter: string | null, key: string): string[] {
  if (!frontmatter) return [];
  const prop = parseFrontmatter(frontmatter).find((entry) => entry.key === key);
  if (!prop) return [];
  const values: string[] = [];
  for (const line of prop.lines.slice(1)) {
    const item = /^\s*-\s*(.*?)\s*$/.exec(line);
    if (item) values.push(cleanVariantName(item[1]));
  }
  if (!values.length) {
    const inline = /^[^:]+:\s*(.*)$/.exec(prop.lines[0]);
    const raw = (inline?.[1] ?? '').trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      for (const item of raw.slice(1, -1).split(',')) {
        values.push(cleanVariantName(item));
      }
    } else if (raw) {
      values.push(cleanVariantName(raw));
    }
  }
  return unique(values.filter(Boolean));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** All notes that declare themselves author notes. */
export function authorNoteFiles(plugin: ReferenceList): TFile[] {
  const app = plugin.app;
  return app.vault
    .getMarkdownFiles()
    .filter((file) => isMergeablePath(file.path) && hasAuthorsUp(app, file))
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

export class AuthorVariantIndex {
  /** Variant display name → the main note's basename. */
  readonly byVariant = new Map<string, string>();
  /** Main note basename → its variant display names. */
  readonly byMain = new Map<string, string[]>();
  /** Main note basename → its file (for the target picker). */
  readonly files = new Map<string, TFile>();
}

/**
 * Build the variant map from `variants` on author notes. Only notes with
 * `up: "[[Authors]]"` count. A variant that collides with a main author's own
 * display name is ignored; the first main note wins a duplicate variant.
 */
export function buildAuthorVariantIndex(plugin: ReferenceList): AuthorVariantIndex {
  const files = authorNoteFiles(plugin);
  const mainNames = new Set(files.map((file) => file.basename));
  const index = new AuthorVariantIndex();
  for (const file of files) {
    const variants = unique(
      variantsOf(plugin.app, file)
        .map(cleanVariantName)
        .filter((name) => name && name !== file.basename && !mainNames.has(name))
    );
    index.byMain.set(file.basename, variants);
    index.files.set(file.basename, file);
    for (const variant of variants) {
      if (!index.byVariant.has(variant)) index.byVariant.set(variant, file.basename);
    }
  }
  return index;
}

/** The autocomplete aliases a variant contributes to its main note. */
export function variantAliases(variant: string, mainName: string): string[] {
  const name = cleanVariantName(variant);
  if (!name || name === mainName) return [];
  const aliases = new Set<string>([name]);
  const comma = name.indexOf(',');
  if (comma > 0) {
    const family = name.slice(0, comma).trim();
    const given = name.slice(comma + 1).trim();
    if (family && given) aliases.add(`${given} ${family}`);
  }
  return [...aliases];
}

/**
 * Add variants (and their derived aliases) to a main author note. The command
 * sets `addVariants`; the manual-variants tracker only needs aliases because
 * the user already wrote the variants list.
 */
async function addAuthorVariants(
  plugin: ReferenceList,
  main: TFile,
  variants: string[],
  opts: { addVariants: boolean }
): Promise<string[]> {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(main.path);
  if (!(file instanceof TFile)) return [];

  const content = await app.vault.read(file);
  const prior = splitNote(content);
  const cleaned = unique(variants.map(cleanVariantName));
  const existingVariants = frontmatterValues(prior.frontmatter, 'variants');
  const newVariants = opts.addVariants
    ? cleaned.filter((variant) => !existingVariants.includes(variant))
    : [];

  const existingAliases = frontmatterValues(prior.frontmatter, 'aliases');
  const newAliases: string[] = [];
  for (const variant of cleaned) {
    for (const alias of variantAliases(variant, file.basename)) {
      if (!existingAliases.includes(alias)) newAliases.push(alias);
    }
  }

  if (!newVariants.length && !newAliases.length) {
    return unique([...existingVariants, ...newVariants]);
  }
  const specs: YamlFieldSpec[] = [];
  if (newVariants.length) {
    specs.push({
      key: 'variants',
      merge: 'replace',
      lines: serializeProperty(
        'variants',
        unique([...existingVariants, ...newVariants]).map(
          (variant) => `[[${variant}]]`
        )
      ),
    });
  }
  if (newAliases.length) {
    specs.push({
      key: 'aliases',
      merge: 'replace',
      lines: serializeProperty(
        'aliases',
        unique([...existingAliases, ...newAliases])
      ),
    });
  }
  const frontmatter = mergeFrontmatter(prior.frontmatter, specs);
  await app.vault.modify(file, joinNote(frontmatter, prior.body));
  return unique([...existingVariants, ...newVariants]);
}

const CREATOR_KEY_EXTRA = new Set(['creator', 'creators']);
const CREATOR_ROLES = new Set(CSL_CREATOR_ROLES.map((role) => role.toLowerCase()));

function isCreatorProperty(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  if (CREATOR_KEY_EXTRA.has(k)) return true;
  const singular = k.endsWith('s') ? k.slice(0, -1) : k;
  return CREATOR_ROLES.has(singular) || CREATOR_ROLES.has(k);
}

function rewriteCreatorLine(
  line: string,
  mappings: ReadonlyMap<string, string>
): string {
  const link = /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  return line.replace(link, (whole, target: string, fragment?: string, display?: string) => {
    const name = target.trim();
    const main = mappings.get(name);
    if (!main) return whole;
    const shown = (display ?? name).trim() || name;
    return `[[${main}${fragment ?? ''}|${shown}]]`;
  });
}

/**
 * Rewrite creator-property links in one note's frontmatter. Other properties
 * (`up`, `related`, tags, …) and the body are untouched.
 */
export function rewriteCreatorFrontmatter(
  content: string,
  mappings: ReadonlyMap<string, string>
): { content: string; changed: boolean } {
  if (!mappings.size) return { content, changed: false };
  const prior = splitNote(content);
  if (!prior.frontmatter) return { content, changed: false };

  let changed = false;
  const props = parseFrontmatter(prior.frontmatter);
  for (const prop of props) {
    if (!isCreatorProperty(prop.key)) continue;
    prop.lines = prop.lines.map((line) => {
      const next = rewriteCreatorLine(line, mappings);
      if (next !== line) changed = true;
      return next;
    });
  }
  if (!changed) return { content, changed: false };
  const frontmatter = props.map((prop) => prop.lines.join('\n')).join('\n');
  return { content: joinNote(frontmatter, prior.body), changed: true };
}

/** Rewrite creator links across the vault for the supplied variant mappings. */
export async function rewriteCreatorLinks(
  plugin: ReferenceList,
  mappings: ReadonlyMap<string, string>,
  opts: { skipPaths?: ReadonlySet<string> } = {}
): Promise<number> {
  if (!mappings.size) return 0;
  const app = plugin.app;
  const names = [...mappings.keys()];
  let changed = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (opts.skipPaths?.has(file.path) || !isMergeablePath(file.path)) continue;
    const content = await app.vault.read(file).catch((): null => null);
    if (content == null || !names.some((name) => content.includes(name))) continue;
    const result = rewriteCreatorFrontmatter(content, mappings);
    if (!result.changed) continue;
    await app.vault.modify(file, result.content);
    changed++;
  }
  return changed;
}

/**
 * Make `current` a variant of `main`: add its name and aliases to the main
 * note, rewrite creator properties across the vault, then move the current
 * note to the trash.
 */
export async function linkAuthorVariant(
  plugin: ReferenceList,
  current: TFile,
  main: TFile
): Promise<boolean> {
  if (current.path === main.path) return false;
  const app = plugin.app;
  if (!(app.vault.getAbstractFileByPath(current.path) instanceof TFile)) return false;
  if (!(app.vault.getAbstractFileByPath(main.path) instanceof TFile)) return false;
  const variant = cleanVariantName(current.basename);
  if (!variant) return false;
  try {
    const allVariants = await addAuthorVariants(plugin, main, [variant], {
      addVariants: true,
    });
    await refreshAuthorPage(plugin, main, allVariants);
    await rewriteCreatorLinks(
      plugin,
      new Map([[variant, main.basename]]),
      { skipPaths: new Set([current.path, main.path]) }
    );
    await app.fileManager.trashFile(current);
    new Notice(
      t('Linked “{variant}” as a variant of “{main}”.')
        .replace('{variant}', variant)
        .replace('{main}', main.basename),
      8000
    );
    return true;
  } catch (e) {
    new Notice(`ScholarWeft: ${(e as Error).message}`, 10000);
    return false;
  }
}

/** Search box for choosing the main author note; prefilled with the current name. */
export class AuthorVariantTargetModal extends FuzzySuggestModal<TFile> {
  private readonly items: TFile[];

  constructor(
    private readonly plugin: ReferenceList,
    private readonly current: TFile,
    private readonly onPick: (main: TFile) => void
  ) {
    super(plugin.app);
    const index = buildAuthorVariantIndex(plugin);
    this.items = authorNoteFiles(plugin).filter(
      (file) => file.path !== current.path && !index.byVariant.has(file.basename)
    );
    this.setPlaceholder(t('Choose the main author note'));
    this.setInstructions([
      { command: '↵', purpose: t('link this name as a variant and move this note to trash') },
    ]);
  }

  getItems(): TFile[] {
    return this.items;
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  onOpen(): void {
    super.onOpen();
    // Prefill so the user starts from the current name and edits it down to the
    // main author they want.
    this.inputEl.value = this.current.basename;
    this.inputEl.dispatchEvent(new Event('input'));
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

/**
 * In-session watcher for manually edited `variants` lists. A new variant makes
 * the plugin add its autocomplete aliases and rewrite existing creator links.
 * Initial variants are loaded into the baseline, so merely opening Obsidian
 * does not rewrite every note.
 */
export class AuthorVariantTracker {
  private readonly known = new Map<string, Set<string>>();
  private readonly timers = new Map<string, number>();

  constructor(private readonly plugin: ReferenceList) {}

  async init(): Promise<void> {
    this.known.clear();
    for (const file of authorNoteFiles(this.plugin)) {
      this.known.set(
        file.path,
        new Set(variantsOf(this.plugin.app, file).map(cleanVariantName).filter(Boolean))
      );
    }
  }

  forget(path: string): void {
    this.known.delete(path);
    const timer = this.timers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(path);
  }

  onChange(file: TFile): void {
    if (!hasAuthorsUp(this.plugin.app, file)) return;
    const prior = this.timers.get(file.path);
    if (prior !== undefined) window.clearTimeout(prior);
    const timer = window.setTimeout(() => {
      this.timers.delete(file.path);
      void this.process(file);
    }, 400);
    this.timers.set(file.path, timer);
  }

  private async process(file: TFile): Promise<void> {
    const app = this.plugin.app;
    const current = app.vault.getAbstractFileByPath(file.path);
    if (!(current instanceof TFile) || !hasAuthorsUp(app, current)) return;
    const variants = unique(
      variantsOf(app, current)
        .map(cleanVariantName)
        .filter((name) => name && name !== current.basename)
    );
    const prior = this.known.get(current.path);
    if (!prior) {
      this.known.set(current.path, new Set(variants));
      if (variants.length) await this.apply(current, variants);
      return;
    }
    const added = variants.filter((variant) => !prior.has(variant));
    this.known.set(current.path, new Set(variants));
    if (added.length) await this.apply(current, added);
  }

  private async apply(main: TFile, variants: string[]): Promise<void> {
    try {
      // The user already wrote the variants; add only their derived aliases.
      const allVariants = await addAuthorVariants(this.plugin, main, variants, {
        addVariants: false,
      });
      await refreshAuthorPage(this.plugin, main, allVariants);
      await rewriteCreatorLinks(
        this.plugin,
        new Map(variants.map((variant) => [variant, main.basename])),
        { skipPaths: new Set([main.path]) }
      );
    } catch (e) {
      console.warn('[sw:author] could not apply author variants', main.path, e);
    }
  }
}

