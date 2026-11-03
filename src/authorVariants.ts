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
  AUTHOR_OPEN,
  CSL_CREATOR_ROLES,
  buildAuthorIndex,
  migrateAuthorSectionOrder,
  hasAuthorsUp,
  isMergeablePath,
  ensureAuthorNoteMaterial,
  refreshAuthorPage,
  variantsOf,
} from './authorNotes';
import { joinNote, mergeFrontmatter, parseFrontmatter, splitNote } from './template/merge';
import {
  serializeProperty,
  type YamlFieldSpec,
} from './template/yaml';
import { t } from './lang/helpers';
import { normalizeAuthorName } from './authorName';

/** Normalise a frontmatter variant value to the display name it names. */
export function cleanVariantName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  const link = /\[\[([\s\S]*?)\]\]/.exec(value);
  if (link) {
    value = link[1].split('|')[0].split('#')[0];
  }
  value = value.replace(/^["']|["']$/g, '').trim();
  return value;
}

/** Raw values of a frontmatter list/scalar (links and quotes kept). */
function frontmatterRawValues(frontmatter: string | null, key: string): string[] {
  if (!frontmatter) return [];
  const prop = parseFrontmatter(frontmatter).find((entry) => entry.key === key);
  if (!prop) return [];
  const values: string[] = [];
  for (const line of prop.lines.slice(1)) {
    const item = /^\s*-\s*(.*?)\s*$/.exec(line);
    if (item) values.push(item[1]);
  }
  if (!values.length) {
    const inline = /^[^:]+:\s*(.*)$/.exec(prop.lines[0]);
    const raw = (inline?.[1] ?? '').trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      for (const item of raw.slice(1, -1).split(',')) values.push(item.trim());
    } else if (raw) {
      values.push(raw);
    }
  }
  return values;
}

/** Values of a frontmatter list/scalar, as clean display names. */
function frontmatterValues(frontmatter: string | null, key: string): string[] {
  return unique(
    frontmatterRawValues(frontmatter, key)
      .map(cleanVariantName)
      .filter(Boolean)
  );
}

function metadataRawValues(
  plugin: ReferenceList,
  file: TFile,
  key: string
): string[] {
  const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  const raw = frontmatter?.[key];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return values.filter((value): value is string => typeof value === 'string');
}

function metadataValues(
  plugin: ReferenceList,
  file: TFile,
  key: string
): string[] {
  return unique(
    metadataRawValues(plugin, file, key)
      .map(cleanVariantName)
      .filter(Boolean)
  );
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

const AUTHOR_NAME_CACHE_TTL = 60_000;
const AUTHOR_NAME_CACHE = new WeakMap<
  ReferenceList,
  { size: number; at: number; names: Set<string> }
>();

/** Display and First Last names of every creator currently in the library. */
function cachedAuthorNames(plugin: ReferenceList): Set<string> {
  const size = plugin.bibManager.bibCache.size;
  if (!size) return new Set();
  const now = Date.now();
  const cached = AUTHOR_NAME_CACHE.get(plugin);
  if (cached && cached.size === size && now - cached.at < AUTHOR_NAME_CACHE_TTL) {
    return cached.names;
  }
  const names = new Set<string>();
  const library = buildAuthorIndex(plugin.bibManager.bibCache.values());
  for (const record of library.records()) {
    names.add(normalizeAuthorName(record.display));
    if (record.alias) names.add(normalizeAuthorName(record.alias));
  }
  names.delete('');
  AUTHOR_NAME_CACHE.set(plugin, { size, at: now, names });
  return names;
}

export class AuthorVariantIndex {
  /** Exact variant display name → the main note's basename. */
  readonly byVariant = new Map<string, string>();
  /** Normalized link name (variant + generated display forms) → main note. */
  readonly byLink = new Map<string, string>();
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
  const cachedNames = cachedAuthorNames(plugin);
  const index = new AuthorVariantIndex();
  const ambiguousLinks = new Set<string>();
  for (const file of files) {
    const variants = unique(
      variantsOf(plugin.app, file)
        .map(cleanVariantName)
        .filter(
          (name) =>
            name &&
            name !== file.basename &&
            !mainNames.has(name) &&
            cachedNames.has(normalizeAuthorName(name))
        )
    );
    index.byMain.set(file.basename, variants);
    index.files.set(file.basename, file);
    for (const variant of variants) {
      if (!index.byVariant.has(variant)) index.byVariant.set(variant, file.basename);
      for (const linkName of variantAliases(variant, file.basename)) {
        const normalized = normalizeAuthorName(linkName);
        if (!normalized || mainNames.has(linkName)) continue;
        if (ambiguousLinks.has(normalized)) continue;
        const prior = index.byLink.get(normalized);
        if (prior && prior !== file.basename) {
          index.byLink.delete(normalized);
          ambiguousLinks.add(normalized);
          continue;
        }
        index.byLink.set(normalized, file.basename);
      }
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
  opts: { addVariants: boolean; addAliases?: boolean }
): Promise<string[]> {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(main.path);
  if (!(file instanceof TFile)) return [];

  const content = await app.vault.read(file);
  const prior = splitNote(content);
  const cleaned = unique(variants.map(cleanVariantName));
  const existingVariants = frontmatterValues(prior.frontmatter, 'variants');
  const rawVariants = frontmatterRawValues(prior.frontmatter, 'variants');
  const normalizeVariants = rawVariants.some((value) => value.includes('[['));
  const newVariants = opts.addVariants
    ? cleaned.filter((variant) => !existingVariants.includes(variant))
    : [];

  const existingAliases = frontmatterValues(prior.frontmatter, 'aliases');
  const newAliases: string[] = [];
  if (opts.addAliases !== false) {
    for (const variant of cleaned) {
      for (const alias of variantAliases(variant, file.basename)) {
        if (!existingAliases.includes(alias)) newAliases.push(alias);
      }
    }
  }

  if (!newVariants.length && !newAliases.length && !normalizeVariants) {
    return unique([...existingVariants, ...newVariants]);
  }
  const specs: YamlFieldSpec[] = [];
  if (newVariants.length || normalizeVariants) {
    specs.push({
      key: 'variants',
      merge: 'replace',
      lines: serializeProperty(
        'variants',
        unique([...existingVariants, ...newVariants])
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

const VARIANT_SYNC_INTERVAL = 5 * 60 * 1000;
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
  return line.replace(/\[\[([\s\S]*?)\]\]/g, (whole, inner: string) => {
    const pipe = inner.indexOf('|');
    const targetPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const hash = targetPart.indexOf('#');
    const name = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
    const fragment = hash === -1 ? '' : targetPart.slice(hash);
    const display = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
    const main =
      mappings.get(name) ?? mappings.get(normalizeAuthorName(name));
    if (!main) return whole;
    const shown = (display ?? name).trim() || name;
    return `[[${main}${fragment}|${shown}]]`;
  });
}

function valueHasTarget(value: unknown, targets: ReadonlySet<string>): boolean {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const link = /\[\[([\s\S]*?)\]\]/g;
    for (const match of item.matchAll(link)) {
      const target = match[1].split('|')[0].split('#')[0].trim();
      if (targets.has(normalizeAuthorName(target))) return true;
    }
  }
  return false;
}

/** Fast in-memory check before reading a note to rewrite it. */
function frontmatterHasTarget(
  frontmatter: Record<string, unknown> | undefined,
  targets: ReadonlySet<string>
): boolean {
  if (!frontmatter) return false;
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!isCreatorProperty(key)) continue;
    if (valueHasTarget(value, targets)) return true;
  }
  return false;
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
  const targets = new Set(
    [...mappings.keys()].map(normalizeAuthorName).filter(Boolean)
  );
  let changed = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (opts.skipPaths?.has(file.path) || !isMergeablePath(file.path)) continue;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    // Metadata is already in memory. Reading only notes whose creator fields
    // still point at a variant keeps the periodic pass cheap.
    if (!frontmatterHasTarget(frontmatter, targets)) continue;
    const content = await app.vault.read(file).catch((): null => null);
    if (content == null) continue;
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
      new Map(
        variantAliases(variant, main.basename).map((name) => [name, main.basename])
      ),
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
      (file) =>
        file.path !== current.path &&
        !index.byLink.has(normalizeAuthorName(file.basename))
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
  /** The variant → main map applied on the previous pass. */
  private lastLinks = new Map<string, string>();

  constructor(private readonly plugin: ReferenceList) {}

  private syncing = false;
  private intervalId?: number;

  async init(): Promise<void> {
    await migrateAuthorSectionOrder(this.plugin);
    this.known.clear();
    for (const file of authorNoteFiles(this.plugin)) {
      this.known.set(
        file.path,
        new Set(variantsOf(this.plugin.app, file).map(cleanVariantName).filter(Boolean))
      );
    }
    this.startPeriodic();
    // The author cache may still be loading when layout is ready. Run again
    // once it has names to match against.
    void this.plugin.bibManager.initPromise.promise
      .then(() => this.sync())
      .catch(() => {});
    await this.sync();
  }

  /** Periodic consistency pass: aliases, creator links, and cache names. */
  startPeriodic(): void {
    if (this.intervalId !== undefined) return;
    this.intervalId = this.plugin.registerInterval(
      window.setInterval(() => {
        void this.sync();
      }, VARIANT_SYNC_INTERVAL)
    );
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const index = buildAuthorVariantIndex(this.plugin);
      await this.normalizeVariantFormatting();
      for (const file of authorNoteFiles(this.plugin)) {
        await ensureAuthorNoteMaterial(this.plugin, file);
      }
      const current = index.byLink;
      if (!current.size) {
        this.lastLinks.clear();
        return;
      }

      // Compare the CURRENT variant map with the one applied last time. Only
      // entries that are new or changed need a vault pass; unchanged variants
      // cost no file reads at all.
      const changed = new Map<string, string>();
      for (const [name, mainName] of current) {
        if (this.lastLinks.get(name) !== mainName) {
          changed.set(name, mainName);
        }
      }
      if (!changed.size) {
        this.lastLinks = new Map(current);
        return;
      }

      const changedMains = new Set(changed.values());
      await this.ensureAliases(index, changedMains);
      for (const mainName of changedMains) {
        const file = index.files.get(mainName);
        if (file) {
          await refreshAuthorPage(
            this.plugin,
            file,
            index.byMain.get(mainName) ?? []
          );
        }
      }
      await rewriteCreatorLinks(this.plugin, changed);
      this.lastLinks = new Map(current);
    } catch (e) {
      console.warn('[sw:author] author variant sync failed', e);
    } finally {
      this.syncing = false;
    }
  }

  /** Convert older `variants: [[Name]]` entries to plain text once. */
  private async normalizeVariantFormatting(): Promise<void> {
    for (const file of authorNoteFiles(this.plugin)) {
      const raw = metadataRawValues(this.plugin, file, 'variants');
      if (!raw.some((value) => value.includes('[['))) continue;
      const variants = unique(raw.map(cleanVariantName).filter(Boolean));
      if (!variants.length) continue;
      await addAuthorVariants(this.plugin, file, variants, {
        addVariants: false,
        addAliases: false,
      });
    }
  }

  /** Add aliases for the changed main notes only. */
  private async ensureAliases(
    index: AuthorVariantIndex,
    mainNames: ReadonlySet<string>
  ): Promise<void> {
    for (const mainName of mainNames) {
      const variants = index.byMain.get(mainName);
      const file = index.files.get(mainName);
      if (!variants?.length || !file) continue;
      const existing = new Set(metadataValues(this.plugin, file, 'aliases'));
      let missing = false;
      for (const variant of variants) {
        for (const alias of variantAliases(variant, mainName)) {
          if (!existing.has(alias)) {
            missing = true;
            break;
          }
        }
        if (missing) break;
      }
      if (missing) {
        await addAuthorVariants(this.plugin, file, variants, {
          addVariants: false,
        });
      }
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
    // An existing note promoted by adding up: Authors and variants still needs
    // the author template block, not just link rewrites.
    if (!(await app.vault.read(current)).includes(AUTHOR_OPEN)) {
      await refreshAuthorPage(this.plugin, current, variants);
    }
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
      const cachedNames = cachedAuthorNames(this.plugin);
      const accepted = variants.filter((variant) =>
        cachedNames.has(normalizeAuthorName(variant))
      );
      // Add aliases only for cache-known variants, but still materialize the
      // author template for a note whose variants are deliberate local names.
      const allVariants = await addAuthorVariants(this.plugin, main, accepted, {
        addVariants: false,
      });
      await refreshAuthorPage(this.plugin, main, allVariants);
      const mappings = new Map<string, string>();
      for (const variant of accepted) {
        for (const name of variantAliases(variant, main.basename)) {
          mappings.set(name, main.basename);
        }
      }
      if (mappings.size) {
        await rewriteCreatorLinks(this.plugin, mappings, {
          skipPaths: new Set([main.path]),
        });
        for (const [name, mainName] of mappings) {
          this.lastLinks.set(name, mainName);
        }
      }
    } catch (e) {
      console.warn('[sw:author] could not apply author variants', main.path, e);
    }
  }
}

