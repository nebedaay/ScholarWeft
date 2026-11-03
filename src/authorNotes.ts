// Author notes: an author/creator page, created by clicking an unresolved
// creator link (or by command), with a template, folders and variants.
//
// A creator link is formatted by the literature-note template as
// `[[Last, First]]` (or `[[Literal]]`). Clicking one creates an empty note;
// `maybeAutoCreateAuthorNote()` fills it from the author template and moves it
// to the configured folder. The same page can also be created from a picker.
//
// `variants` on the main note lists other display names for the same person;
// their works and tags are folded into the main note's related/publications.
// `variant-of` on a variant note is recognised for identification, but the
// main note is always the one that carries the biography and the merged list.

import {
	App,
	FuzzySuggestModal,
	Notice,
	TFile,
	TFolder,
	normalizePath,
} from 'obsidian';
import { Eta } from 'eta';

import type ReferenceList from './main';
import type { PartialCSLEntry } from './bib/types';
import type { NoteContextCreator } from './template/context';
import { formatCreator } from './template/format';
import type { YamlFieldSpec } from './template/yaml';
import { getLitNoteForCitekey } from './lit-note';
import {
	joinNote,
	mergeFrontmatter,
	parseFrontmatter,
	splitNote,
} from './template/merge';
import { t } from './lang/helpers';
import { DEFAULT_LITERATURE_NOTE_FOLDER } from './template/lit-folder';
import { normalizeAuthorName } from './authorName';

export const AUTHOR_TEMPLATE_ASSET = 'sw-literature-note-templates/author.eta.md';
export const AUTHOR_OPEN = '%%sw-author-managed%%';
export const AUTHOR_CLOSE = '%%/sw-author-managed%%';

const PREFERRED_ROLE_ORDER = ['author', 'editor', 'translator'];
export const CSL_CREATOR_ROLES = [
	'author',
	'editor',
	'translator',
	'container-author',
	'collection-editor',
	'composer',
	'director',
	'illustrator',
	'interviewer',
	'original-author',
	'performer',
	'producer',
	'recipient',
	'reviewed-author',
	'script-writer',
	'series-editor',
	'editorial-director',
	'guest',
	'host',
	'narrator',
	'organizer',
	'presenter',
	'compiler',
	'contributor',
	'curator',
	'executive-producer',
	'writer',
];

interface CreatorLike {
	role: string;
	family?: string;
	given?: string;
	literal?: string;
}

export interface AuthorRecord {
	/** The link text the literature-note template writes: `Last, First`. */
	display: string;
	/** `First Last` for two-part names; null for literal/one-part names. */
	alias: string | null;
	family: string;
	given: string;
	literal: string;
	roles: Set<string>;
	citekeys: Set<string>;
	tags: Set<string>;
}

export class AuthorIndex {
	readonly byDisplay = new Map<string, AuthorRecord>();
	readonly byAlias = new Map<string, AuthorRecord>();
	/** Normalized display/alias → record; null means two different records collide. */
	readonly byNormalized = new Map<string, AuthorRecord | null>();

	get(name: string): AuthorRecord | undefined {
		const exact = this.byDisplay.get(name) ?? this.byAlias.get(name);
		if (exact) return exact;
		const normalized = this.byNormalized.get(normalizeAuthorName(name));
		return normalized ?? undefined;
	}

	records(): AuthorRecord[] {
		return [...this.byDisplay.values()];
	}
}

function asCreator(c: CreatorLike): NoteContextCreator {
	return {
		role: c.role,
		family: c.family,
		given: c.given,
		literal: c.literal,
	} as NoteContextCreator;
}

function displayOf(c: CreatorLike): string {
	return c.literal
		? formatCreator(asCreator(c))
		: formatCreator(asCreator(c), '{family}, {given}');
}

function aliasOf(c: CreatorLike): string | null {
	if (!c.family || !c.given) return null;
	return formatCreator(asCreator(c), '{given} {family}') || null;
}

function creatorsOf(entry: PartialCSLEntry): CreatorLike[] {
	if (Array.isArray(entry._creators) && entry._creators.length) {
		return entry._creators.map((c) => ({
			role: String(c.role ?? 'author'),
			family: c.family,
			given: c.given,
			literal: c.literal,
		}));
	}
	const out: CreatorLike[] = [];
	for (const role of CSL_CREATOR_ROLES) {
		const list = entry[role];
		if (!Array.isArray(list)) continue;
		for (const value of list) {
			if (!value || typeof value !== 'object') continue;
			const c = value as { family?: string; given?: string; literal?: string };
			if (c.family || c.given || c.literal) {
				out.push({ role, family: c.family, given: c.given, literal: c.literal });
			}
		}
	}
	return out;
}

/** Every creator in the loaded library, keyed by the link text the template
 *  writes. Roles/tags/works are merged across entries. */
export function buildAuthorIndex(
	entries: Iterable<PartialCSLEntry>
): AuthorIndex {
	const index = new AuthorIndex();
	for (const entry of entries) {
		const citekey = typeof entry.id === 'string' ? entry.id : '';
		if (!citekey) continue;
		const tags = (entry._tags ?? []).filter(
			(tag): tag is string => typeof tag === 'string' && !!tag.trim()
		);
		for (const creator of creatorsOf(entry)) {
			const display = displayOf(creator);
			if (!display) continue;
			let record = index.byDisplay.get(display);
			if (!record) {
				const alias = aliasOf(creator);
				record = {
					display,
					alias,
					family: creator.family ?? '',
					given: creator.given ?? '',
					literal: creator.literal ?? '',
					roles: new Set(),
					citekeys: new Set(),
					tags: new Set(),
				};
				index.byDisplay.set(display, record);
				if (alias && !index.byAlias.has(alias)) index.byAlias.set(alias, record);
				for (const key of [display, alias]) {
					if (!key) continue;
					const normalized = normalizeAuthorName(key);
					if (!normalized) continue;
					const prior = index.byNormalized.get(normalized);
					index.byNormalized.set(
						normalized,
						prior && prior !== record ? null : record
					);
				}
			}
			record.roles.add(creator.role);
			record.citekeys.add(citekey);
			for (const tag of tags) record.tags.add(tag.trim());
		}
	}
	return index;
}

/** Frontmatter `variants` on an author note, as display names. Accepts
 *  wikilinks (`"[[Other Name]]"`), a bare string, or a list of either. */
export function variantsOf(app: App, file: TFile): string[] {
	const raw = app.metadataCache.getFileCache(file)?.frontmatter?.['variants'];
	const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
	const out: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const links = [...value.matchAll(/\[\[([\s\S]*?)\]\]/g)];
		if (links.length) {
			out.push(...links.map((m) => m[1].split('|')[0].split('#')[0].trim()));
		}
		else if (value.trim()) out.push(value.trim());
	}
	return [...new Set(out)];
}

interface Expanded {
	citekeys: Set<string>;
	tags: Set<string>;
}

function expandedRecord(
	record: AuthorRecord,
	index: AuthorIndex,
	variants: string[]
): Expanded {
	const citekeys = new Set(record.citekeys);
	const tags = new Set(record.tags);
	for (const name of variants) {
		const variant = index.get(name);
		if (!variant) continue;
		for (const key of variant.citekeys) citekeys.add(key);
		for (const tag of variant.tags) tags.add(tag);
	}
	return { citekeys, tags };
}

function rolesFor(record: AuthorRecord): string[] {
	const rank = (role: string): number => {
		const at = PREFERRED_ROLE_ORDER.indexOf(role);
		return at === -1 ? PREFERRED_ROLE_ORDER.length : at;
	};
	return [...record.roles].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function relatedLinks(expanded: Expanded): string[] {
	const links = [
		...[...expanded.citekeys].map((key) => `[[@${key}]]`),
		...[...expanded.tags].map((tag) => `[[${tag}]]`),
	];
	return [...new Set(links)];
}

function publicationLinks(
	plugin: ReferenceList,
	expanded: Expanded,
	sourcePath: string
): string[] {
	const imported = [...expanded.citekeys].filter((key) =>
		getLitNoteForCitekey(key, sourcePath, plugin.app)
	);
	return imported.map((key, i) =>
		i === 0 ? `[[@${key}|ref]]` : `[[@${key}]]`
	);
}

function today(): string {
	const d = new Date();
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface AuthorTemplateData {
	display: string;
	alias: string | null;
	roles: string[];
	related: string[];
	publications: string[];
	date: string;
}

export function authorTemplateData(
	plugin: ReferenceList,
	record: AuthorRecord,
	variants: string[] = [],
	sourcePath = '',
	index?: AuthorIndex
): AuthorTemplateData {
	const idx = index ?? buildAuthorIndex(plugin.bibManager.bibCache.values());
	const expanded = expandedRecord(record, idx, variants);
	return {
		display: record.display,
		alias: record.alias,
		roles: rolesFor(record),
		related: relatedLinks(expanded),
		publications: publicationLinks(plugin, expanded, sourcePath),
		date: today(),
	};
}

async function readBundledAuthorTemplate(
	plugin: ReferenceList
): Promise<string | null> {
	const dir = plugin.manifest.dir;
	if (!dir) return null;
	try {
		return await plugin.app.vault.adapter.read(
			normalizePath(`${dir}/${AUTHOR_TEMPLATE_ASSET}`)
		);
	} catch (e) {
		console.warn('[sw:author] template not found at', dir, e);
		return null;
	}
}

/** The user's copy when "Use the default author template" is off, else the
 *  bundled file. Falls back to the bundled copy when the custom path fails. */
export async function readAuthorTemplate(
	plugin: ReferenceList
): Promise<string | null> {
	if (plugin.settings.useDefaultAuthorTemplate === false) {
		const path = (plugin.settings.authorTemplatePath ?? '').trim();
		if (path) {
			try {
				const text = await plugin.app.vault.adapter.read(normalizePath(path));
				if (text.trim()) return text;
			} catch (e) {
				console.warn('[sw:author] custom template not found at', path, e);
			}
		}
	}
	return readBundledAuthorTemplate(plugin);
}

export async function renderAuthorPage(
	plugin: ReferenceList,
	record: AuthorRecord,
	opts: {
		variants?: string[];
		sourcePath?: string;
		index?: AuthorIndex;
	} = {}
): Promise<string> {
	const template =
		(await readAuthorTemplate(plugin)) ??
		[
			'---',
			'up:',
			'  - "[[Authors]]"',
			'<% if (alias) { -%>',
			'aliases:',
			'  - <%= JSON.stringify(alias) %>',
			'<% } -%>',
			'---',
			'# <%= display %>',
			'',
		].join('\n');
	const data = authorTemplateData(
		plugin,
		record,
		opts.variants ?? [],
		opts.sourcePath ?? '',
		opts.index
	);
	try {
		return new Eta({ autoEscape: false, useWith: true, autoTrim: false }).renderString(template, data);
	} catch (e) {
		console.warn('[sw:author] template render failed', e);
		return `---\nup:\n  - "[[Authors]]"\n---\n# ${record.display}\n`;
	}
}

/**
 * The author folder: the explicit setting when set, otherwise
 * `<literature notes folder>/Authors`. A blank literature-note folder uses the
 * plugin's own default.
 */
export function authorFolderPath(plugin: ReferenceList): string {
	const custom = (plugin.settings.authorNoteFolder ?? '').trim();
	if (custom) return normalizePath(custom);
	const literature =
		(plugin.settings.literatureNoteFolder ?? '').trim() ||
		DEFAULT_LITERATURE_NOTE_FOLDER;
	return normalizePath(`${literature}/Authors`);
}

async function ensureAuthorFolder(plugin: ReferenceList): Promise<string> {
	const app = plugin.app;
	const path = authorFolderPath(plugin);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return path;
	if (existing) return '';
	const parts = path.split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch {
				return '';
			}
		}
	}
	return path;
}

function fileSafe(name: string): string {
	// Keep the title EXACTLY as the creator link writes it (including a
	// trailing initial period, e.g. "Hughes, Aaron W."), or the wikilink will
	// point at a different name. Only characters Obsidian cannot use in a link
	// target are replaced.
	return (
		name
			.replace(/[\\/:*?"<>|#^[\]]/g, '-')
			.replace(/\s+/g, ' ')
			.trim() || 'Author'
	);
}

async function openFile(plugin: ReferenceList, file: TFile): Promise<void> {
	const leaf = plugin.app.workspace.getLeaf(false);
	await leaf.openFile(file);
}

/**
 * A list property can end up with the same value written once unquoted and once
 * quoted (a hand-written alias vs the template's JSON-quoted one). Collapse by
 * the decoded value, keeping the first line's style.
 */
function dedupeListProperty(frontmatter: string, key: string): string {
	const prop = parseFrontmatter(frontmatter).find((p) => p.key === key);
	if (!prop || prop.lines.length < 2) return frontmatter;
	const seen = new Set<string>();
	const kept: string[] = [prop.lines[0]];
	for (const line of prop.lines.slice(1)) {
		const raw = line.replace(/^\s*-\s*/, '').trim();
		let value = raw;
		try {
			if (raw.startsWith('"')) value = String(JSON.parse(raw));
			else if (raw.startsWith("'") && raw.endsWith("'")) {
				value = raw.slice(1, -1).replace(/\\'/g, "'");
			}
		} catch {
			/* keep the raw text */
		}
		value = value.trim();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		kept.push(line);
	}
	const oldBlock = prop.lines.join('\n');
	const newBlock = kept.join('\n');
	return frontmatter.replace(oldBlock, newBlock);
}

/**
 * Merge an existing note's frontmatter and managed Publications region with a
 * freshly rendered author page, preserving the user's own body and properties.
 */
export function mergeAuthorContent(
	existing: string,
	rendered: string,
	display?: string
): string {
	const prior = splitNote(existing);
	const next = splitNote(rendered);
	const specs: YamlFieldSpec[] = parseFrontmatter(next.frontmatter ?? '').map(
		(prop) => ({
			key: prop.key,
			// `created` and the user's `variants` must never be reset; everything
			// else is a union so hand-added links survive.
			merge:
				prop.key === 'created' || prop.key === 'variants' ? 'keep' : 'append',
			lines: prop.lines,
		})
	);
	let frontmatter = mergeFrontmatter(prior.frontmatter, specs);
	for (const key of ['up', 'aliases', 'related', 'creator-roles']) {
		frontmatter = dedupeListProperty(frontmatter, key);
	}

	let body = prior.body;
	if (display) {
		const escaped = display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const oldHeading = new RegExp(
			`^(?:\\s*\\n)*#\\s+${escaped}[ \\t]*(?:\\n|$)`
		);
		const stillHasHeading = new RegExp(`^#\\s+${escaped}\\s*$`, 'm');
		if (oldHeading.test(body) && !stillHasHeading.test(next.body)) {
			body = body.replace(oldHeading, '');
		}
	}
	if (!body.trim()) {
		body = next.body;
	} else {
		const region = new RegExp(
			`${AUTHOR_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${AUTHOR_CLOSE.replace(
				/[.*+?^${}()|[\]\\]/g,
				'\\$&'
			)}`
		);
		const renderedRegion = region.exec(next.body)?.[0] ?? '';
		if (region.test(body)) {
			body = body.replace(region, renderedRegion);
		} else if (renderedRegion) {
			body = `${body.replace(/\s+$/, '')}\n\n${renderedRegion}\n`;
		}
	}
	return joinNote(frontmatter, body);
}

/** Create, refresh, or fill an author page. */
export async function createAuthorPage(
	plugin: ReferenceList,
	record: AuthorRecord,
	opts: {
		file?: TFile;
		open?: boolean;
		variants?: string[];
		/** Replace a frontmatter-only generic new-note template (Templater,
		 *  the Basic note template) instead of merging its fields into the
		 *  author page. Used for the click-created empty note. */
		replaceTemplate?: boolean;
		index?: AuthorIndex;
	} = {}
): Promise<TFile | null> {
	const app = plugin.app;
	const folder = await ensureAuthorFolder(plugin);
	const target = normalizePath(
		`${folder ? `${folder}/` : ''}${fileSafe(record.display)}.md`
	);
	const existing = app.vault.getAbstractFileByPath(target);
	const sourcePath =
		opts.file?.path ?? (existing instanceof TFile ? existing.path : target);
	const variants =
		existing instanceof TFile
			? variantsOf(app, existing)
			: (opts.variants ?? []);
	const rendered = await renderAuthorPage(plugin, record, {
		variants,
		sourcePath,
		index: opts.index,
	});

	if (opts.file instanceof TFile) {
		const opened = app.vault.getAbstractFileByPath(opts.file.path);
		if (!(opened instanceof TFile)) return null;
		if (existing instanceof TFile && existing.path !== opened.path) {
			if (opts.open) await openFile(plugin, existing);
			return existing;
		}
		try {
			const current = await app.vault.read(opened);
			if (current.trim()) {
				// A generic new-note template can fill the just-created file first.
				// Replace it only when it has NO body; real writing is never touched.
				const body = splitNote(current).body;
				if (!opts.replaceTemplate || body.trim()) return opened;
				await app.vault.modify(opened, rendered);
			} else {
				const content =
					existing instanceof TFile
						? mergeAuthorContent(await app.vault.read(existing), rendered, record.display)
						: rendered;
				await app.vault.modify(opened, content);
			}
			if (normalizePath(opened.path) !== target && !(existing instanceof TFile)) {
				await app.fileManager.renameFile(opened, target);
			}
			return opened;
		} catch (e) {
			console.warn('[sw:author] could not fill author page', opts.file.path, e);
			return null;
		}
	}

	if (existing instanceof TFile) {
		const merged = mergeAuthorContent(await app.vault.read(existing), rendered, record.display);
		await app.vault.modify(existing, merged);
		if (opts.open) await openFile(plugin, existing);
		return existing;
	}
	if (existing) return null;

	try {
		const file = await app.vault.create(target, rendered);
		if (opts.open) await openFile(plugin, file);
		return file;
	} catch (e) {
		console.warn('[sw:author] could not create author page', e);
		return null;
	}
}

/** Fill an empty note created by clicking a creator link. */
export async function maybeAutoCreateAuthorNote(
	plugin: ReferenceList,
	file: TFile
): Promise<void> {
	if (plugin.settings.autoCreateAuthorNotes !== true) return;
	if (file.extension !== 'md' || !isMergeablePath(file.path)) return;
	try {
		await plugin.bibManager.initPromise.promise;
	} catch {
		return;
	}
	// auto-note-mover/Templater may have moved the just-created file while we
	// waited for the library; use the current object at that path.
	const current = plugin.app.vault.getAbstractFileByPath(file.path);
	if (!(current instanceof TFile)) return;
	const content = await plugin.app.vault.read(current).catch(() => '');
	// Only a genuinely empty note: never overwrite Templater/other template
	// output, frontmatter, or anything the user has started typing.
	if (content.trim()) return;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	// Only the exact display name (Last, First) of a two-part creator. Not an
	// alias (Midad's "Hans Wehr") and not a literal creator (a YouTube user).
	const record = index.byDisplay.get(current.basename);
	if (!record || record.literal || !record.given) return;
	await createAuthorPage(plugin, record, {
		file: current,
		replaceTemplate: true,
		index,
	});
}

const MERGE_SKIP_DIRS = new Set([
	'tmp',
	'.obsidian',
	'.git',
	'node_modules',
	'docs',
	'src',
	'Templates',
	'install',
]);

/** Templates, docs, temp backups and plugin code are not author notes. */
export function isMergeablePath(path: string): boolean {
	const first = normalizePath(path).split('/')[0];
	return !MERGE_SKIP_DIRS.has(first);
}

export function hasAuthorsUp(app: App, file: TFile): boolean {
	const raw = app.metadataCache.getFileCache(file)?.frontmatter?.['up'];
	const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
	return values.some(
		(value) =>
			typeof value === 'string' &&
			/\[\[\s*Authors?\s*\]\]|^\s*Authors?\s*$/i.test(value)
	);
}

export interface AuthorMergeCandidate {
	file: TFile;
	record: AuthorRecord;
}

/** A name is a strong author signal when it has at least two words. */
function wordCount(name: string): number {
	return name.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Decide whether a note is a merge candidate.
 *
 * The decisive test is the filename: it must equal the exact display form of
 * a creator in the library (`Last, First`, or a literal such as `One Long
 * Author Name`). A two-word-or-longer match is enough by itself. A one-word
 * name is merged only when it also has `up: "[[Authors]]"`, because a single
 * word is otherwise too easy to collide with an ordinary note. Aliases are
 * deliberately excluded: Midad's `Hans Wehr` must never become `Wehr, Hans`.
 */
export function planAuthorNote(input: {
	basename: string;
	frontmatter: Record<string, unknown> | undefined;
	up: boolean;
	index: AuthorIndex;
}): AuthorRecord | null {
	const { basename, frontmatter, up, index } = input;
	// Dictionary/term pages and Midad's generated repository notes are not
	// author notes, even when a creator shares their name.
	if (frontmatter?.['term']) return null;
	if (
		frontmatter &&
		Object.keys(frontmatter).some((key) => key.startsWith('midad-'))
	) {
		return null;
	}
	if (basename === 'Authors') return null;

	const record = index.byDisplay.get(basename); // exact display, NOT an alias
	if (!record) return null;
	if (wordCount(basename) >= 2) return record;
	return up ? record : null;
}

function planForFile(
	app: App,
	index: AuthorIndex,
	file: TFile
): AuthorRecord | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
		| Record<string, unknown>
		| undefined;
	return planAuthorNote({
		basename: file.basename,
		frontmatter,
		up: hasAuthorsUp(app, file),
		index,
	});
}

/** Return every note that should be merged into an author page. */
export function planAuthorMerge(plugin: ReferenceList): AuthorMergeCandidate[] {
	const app = plugin.app;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const candidates: AuthorMergeCandidate[] = [];
	for (const listed of app.vault.getMarkdownFiles()) {
		if (!isMergeablePath(listed.path)) continue;
		const file = app.vault.getAbstractFileByPath(listed.path);
		if (!(file instanceof TFile)) continue;
		const record = planForFile(app, index, file);
		if (record) candidates.push({ file, record });
	}
	return candidates;
}

/** Merge selected candidates; the index is built once for all of them. */
export async function mergeAuthorCandidates(
	plugin: ReferenceList,
	candidates: AuthorMergeCandidate[]
): Promise<{ merged: number; moved: number }> {
	const app = plugin.app;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const folder = await ensureAuthorFolder(plugin);
	let merged = 0;
	let moved = 0;

	for (const candidate of candidates) {
		const file = app.vault.getAbstractFileByPath(candidate.file.path);
		if (!(file instanceof TFile)) continue;
		try {
			const target = normalizePath(
				`${folder ? `${folder}/` : ''}${fileSafe(candidate.record.display)}.md`
			);
			const variants = variantsOf(app, file);
			const rendered = await renderAuthorPage(plugin, candidate.record, {
				variants,
				sourcePath: file.path,
				index,
			});
			const current = await app.vault.read(file);
			const content = current.trim()
				? mergeAuthorContent(current, rendered, candidate.record.display)
				: rendered;
			await app.vault.modify(file, content);
			merged++;
			if (file.path !== target) {
				if (!(app.vault.getAbstractFileByPath(target) instanceof TFile)) {
					try {
						// The basename is unchanged, so no wikilink needs updating.
						// A direct adapter rename avoids Obsidian's whole-vault link
						// rewrite (which made a 40-note merge take minutes).
						await app.vault.adapter.rename(file.path, target);
						moved++;
					} catch (e) {
						console.warn('[sw:author] could not move author note', e);
					}
				}
			}
		} catch (e) {
			console.warn('[sw:author] skipped author note during merge', file.path, e);
		}
	}
	return { merged, moved };
}

/**
 * A main author note may deliberately have a non-Zotero title (e.g. BN.md)
 * while its `variants` carry the imported creator names. Build a record for
 * that case so the variant works can still populate related/publications.
 */
function recordForAuthorNote(
	display: string,
	index: AuthorIndex,
	variants: string[]
): AuthorRecord | null {
	const exact = index.byDisplay.get(display);
	if (exact) return exact;
	if (!variants.length) return null;
	const comma = display.indexOf(',');
	const family = comma === -1 ? display : display.slice(0, comma).trim();
	const given = comma === -1 ? '' : display.slice(comma + 1).trim();
	const record: AuthorRecord = {
		display,
		alias: family && given ? `${given} ${family}` : null,
		family,
		given,
		literal: comma === -1 ? display : '',
		roles: new Set(),
		citekeys: new Set(),
		tags: new Set(),
	};
	for (const name of variants) {
		const variant = index.get(name);
		if (!variant) continue;
		for (const role of variant.roles) record.roles.add(role);
	}
	return record;
}

export interface AuthorOverviewWork {
	title: string;
	type: string;
}

/** Works by this author page, with books preferred for the LLM context. */
export function authorWorksForPage(
	plugin: ReferenceList,
	file: TFile
): AuthorOverviewWork[] {
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const variants = variantsOf(plugin.app, file);
	const record = recordForAuthorNote(file.basename, index, variants);
	if (!record) return [];
	const keys = new Set(record.citekeys);
	for (const name of variants) {
		const variant = index.get(name);
		if (!variant) continue;
		for (const key of variant.citekeys) keys.add(key);
	}
	const works: AuthorOverviewWork[] = [];
	const seen = new Set<string>();
	for (const key of keys) {
		const entry = plugin.bibManager.bibCache.get(key);
		if (!entry || typeof entry.title !== 'string' || !entry.title.trim()) continue;
		if (seen.has(entry.title)) continue;
		seen.add(entry.title);
		works.push({
			title: entry.title.trim(),
			type: typeof entry.type === 'string' ? entry.type : '',
		});
	}
	const rank = (work: AuthorOverviewWork): number => {
		if (/book|monograph|collection/i.test(work.type)) return 0;
		if (/chapter|article|paper|conference/i.test(work.type)) return 1;
		return 2;
	};
	return works.sort((a, b) => rank(a) - rank(b)).slice(0, 2);
}

const UNASSIGNED_UP_RE = /\[\[\s*Unassigned\s*\]\]|^\s*Unassigned\s*$/i;

/**
 * Templater's basic note template creates every note with
 * `up: "[[Unassigned]]"`. Once a note is clearly an author note (it has
 * `up: "[[Authors]]"`), that placeholder is redundant and pollutes the graph,
 * so remove only Unassigned while preserving every other up value.
 */
export async function stripUnassignedFromAuthorNote(
	plugin: ReferenceList,
	file: TFile
): Promise<boolean> {
	const app = plugin.app;
	const current = app.vault.getAbstractFileByPath(file.path);
	if (!(current instanceof TFile) || !hasAuthorsUp(app, current)) return false;
	const raw = app.metadataCache.getFileCache(current)?.frontmatter?.['up'];
	const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
	if (!values.some((value) => typeof value === 'string' && UNASSIGNED_UP_RE.test(value))) {
		return false;
	}
	let changed = false;
	await app.fileManager.processFrontMatter(current, (frontmatter) => {
		const existing = frontmatter['up'];
		const list = typeof existing === 'string' ? [existing] : Array.isArray(existing) ? existing : [];
		const kept = list.filter(
			(value) => !(typeof value === 'string' && UNASSIGNED_UP_RE.test(value))
		);
		if (kept.length !== list.length) {
			frontmatter['up'] = kept;
			changed = true;
		}
	});
	return changed;
}

/** Give a promoted author note the template block if it has none yet. */
export async function ensureAuthorNoteMaterial(
	plugin: ReferenceList,
	file: TFile
): Promise<void> {
	const app = plugin.app;
	const current = app.vault.getAbstractFileByPath(file.path);
	if (!(current instanceof TFile) || !isMergeablePath(current.path)) return;
	const content = await app.vault.read(current).catch(() => '');
	if (!content.includes(AUTHOR_OPEN)) {
		await refreshAuthorPage(plugin, current);
	}
	await stripUnassignedFromAuthorNote(plugin, current);
}

/** Refresh one author page from the loaded library (used by variant linking). */
export async function refreshAuthorPage(
	plugin: ReferenceList,
	file: TFile,
	variants?: string[]
): Promise<void> {
	const app = plugin.app;
	const current = app.vault.getAbstractFileByPath(file.path);
	if (!(current instanceof TFile)) return;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const variantsForPage = variants ?? variantsOf(app, current);
	const record = recordForAuthorNote(current.basename, index, variantsForPage);
	if (!record) return;
	const rendered = await renderAuthorPage(plugin, record, {
		variants: variantsForPage,
		sourcePath: current.path,
		index,
	});
	const content = await app.vault.read(current);
	const merged = mergeAuthorContent(content, rendered, record.display);
	if (merged !== content) await app.vault.modify(current, merged);
}

/**
 * Refresh author pages affected by one or more Zotero entries. Used both when
 * literature notes are imported and when the Zotero library adds or changes
 * items, so `related` picks up works without literature notes and
 * `Publications` picks up newly imported ones.
 */
export async function refreshAuthorPagesForEntries(
	plugin: ReferenceList,
	entries: Iterable<PartialCSLEntry>
): Promise<void> {
	const app = plugin.app;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const creators = new Set<string>();
	for (const entry of entries) {
		if (!entry) continue;
		for (const name of creatorsOf(entry).map(displayOf)) creators.add(name);
	}
	if (!creators.size) return;

	// Author notes are not necessarily in the Authors folder: an existing
	// people note (BN.md) can be promoted by adding up: "[[Authors]]".
	const notes = app.vault
		.getMarkdownFiles()
		.filter((file) => isMergeablePath(file.path) && hasAuthorsUp(app, file));
	for (const child of notes) {
		const variants = variantsOf(app, child);
		const record = recordForAuthorNote(child.basename, index, variants);
		if (!record) continue;
		const names = new Set(
			[record.display, record.alias ?? '', ...variants]
				.filter(Boolean)
				.map(normalizeAuthorName)
		);
		if (
			![...creators]
				.map(normalizeAuthorName)
				.some((name) => names.has(name))
		) {
			continue;
		}
		const rendered = await renderAuthorPage(plugin, record, {
			variants,
			sourcePath: child.path,
			index,
		});
		const content = await app.vault.read(child);
		const merged = mergeAuthorContent(content, rendered, record.display);
		if (merged !== content) await app.vault.modify(child, merged);
	}
}

/** Refresh author pages touched by one imported literature note. */
export async function refreshAuthorPagesForCitekey(
	plugin: ReferenceList,
	citekey: string
): Promise<void> {
	const entry = plugin.bibManager.bibCache.get(citekey);
	if (!entry) return;
	await refreshAuthorPagesForEntries(plugin, [entry]);
}

export class AuthorSuggestModal extends FuzzySuggestModal<AuthorRecord> {
	constructor(
		private readonly plugin: ReferenceList,
		private readonly index: AuthorIndex
	) {
		super(plugin.app);
		this.setPlaceholder(t('Create an author note…'));
	}

	getItems(): AuthorRecord[] {
		return this.index
			.records()
			.sort((a, b) => a.display.localeCompare(b.display));
	}

	getItemText(record: AuthorRecord): string {
		return record.display;
	}

	onChooseItem(record: AuthorRecord): void {
		void createAuthorPage(this.plugin, record, { open: true, index: this.index });
	}
}

/** Copy the bundled author template into the vault and select it. */
export async function copyAuthorTemplateToVault(
	plugin: ReferenceList,
	folder: string
): Promise<string | null> {
	const source = await readBundledAuthorTemplate(plugin);
	if (!source) return null;
	const dir = (folder ?? '').replace(/^\/+|\/+$/g, '');
	const join = (name: string): string => (dir ? `${dir}/${name}` : name);
	const existing = new Set(
		plugin.app.vault.getFiles().map((file) => normalizePath(file.path))
	);
	let path = join('author.eta.md');
	let n = 2;
	while (existing.has(path)) {
		path = join(`author-${n}.eta.md`);
		n++;
	}
	await plugin.app.vault.adapter.write(normalizePath(path), source);
	plugin.settings.authorTemplatePath = path;
	plugin.settings.useDefaultAuthorTemplate = false;
	await plugin.saveSettings();
	return path;
}

/** Notify via Notice when the merge command finishes. */
export async function mergeAuthorNotesWithNotice(
	plugin: ReferenceList
): Promise<void> {
	const candidates = planAuthorMerge(plugin);
	if (!candidates.length) {
		new Notice(t('No author notes to merge.'), 6000);
		return;
	}

	const notice = new Notice(t('Merging author notes…'), 0);
	try {
		const { merged, moved } = await mergeAuthorCandidates(plugin, candidates);
		notice.hide();
		new Notice(
			t('Merged {merged} author notes ({moved} moved to the Authors folder).')
				.replace('{merged}', String(merged))
				.replace('{moved}', String(moved)),
			8000
		);
	} catch (e) {
		notice.hide();
		new Notice(`ScholarWeft: ${(e as Error).message}`);
	}
}
