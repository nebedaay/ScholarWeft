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

export const AUTHOR_TEMPLATE_ASSET = 'sw-literature-note-templates/author.eta.md';
export const AUTHOR_OPEN = '%%sw-author-managed%%';
export const AUTHOR_CLOSE = '%%/sw-author-managed%%';

const PREFERRED_ROLE_ORDER = ['author', 'editor', 'translator'];
const CSL_CREATOR_ROLES = [
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

	get(name: string): AuthorRecord | undefined {
		return this.byDisplay.get(name) ?? this.byAlias.get(name);
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
		const links = [...value.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
		if (links.length) out.push(...links.map((m) => m[1].trim()));
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
	sourcePath = ''
): AuthorTemplateData {
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const expanded = expandedRecord(record, index, variants);
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
	opts: { variants?: string[]; sourcePath?: string } = {}
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
		opts.sourcePath ?? ''
	);
	try {
		return new Eta({ autoEscape: false, useWith: true, autoTrim: false }).renderString(template, data);
	} catch (e) {
		console.warn('[sw:author] template render failed', e);
		return `---\nup:\n  - "[[Authors]]"\n---\n# ${record.display}\n`;
	}
}

async function ensureAuthorFolder(plugin: ReferenceList): Promise<string> {
	const app = plugin.app;
	const raw = (plugin.settings.authorNoteFolder ?? '').trim() || 'Authors';
	const path = normalizePath(raw);
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
 * Merge an existing note's frontmatter and managed Publications region with a
 * freshly rendered author page, preserving the user's own body and properties.
 */
export function mergeAuthorContent(
	existing: string,
	rendered: string
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
	const frontmatter = mergeFrontmatter(prior.frontmatter, specs);

	let body = prior.body;
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
	});

	if (opts.file instanceof TFile) {
		if (existing instanceof TFile && existing.path !== opts.file.path) {
			if (opts.open) await openFile(plugin, existing);
			return existing;
		}
		const current = await app.vault.read(opts.file).catch(() => '');
		if (current.trim()) {
			// A generic new-note template can fill the just-created file first.
			// Replace it only when it has NO body; real writing is never touched.
			const body = splitNote(current).body;
			if (!opts.replaceTemplate || body.trim()) return opts.file;
			await app.vault.modify(opts.file, rendered);
		} else {
			const content =
				existing instanceof TFile
					? mergeAuthorContent(await app.vault.read(existing), rendered)
					: rendered;
			await app.vault.modify(opts.file, content);
		}
		if (
			normalizePath(opts.file.path) !== target &&
			!(existing instanceof TFile)
		) {
			try {
				await app.fileManager.renameFile(opts.file, target);
			} catch (e) {
				console.warn('[sw:author] could not move author page', e);
			}
		}
		return opts.file;
	}

	if (existing instanceof TFile) {
		const merged = mergeAuthorContent(await app.vault.read(existing), rendered);
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
	if (file.extension !== 'md') return;
	try {
		await plugin.bibManager.initPromise.promise;
	} catch {
		return;
	}
	const content = await plugin.app.vault.read(file).catch(() => '');
	// Only a genuinely empty note: never overwrite Templater/other template
	// output, frontmatter, or anything the user has started typing.
	if (content.trim()) return;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const record = index.get(file.basename);
	if (!record) return;
	await createAuthorPage(plugin, record, { file, replaceTemplate: true });
}

function hasAuthorsUp(app: App, file: TFile): boolean {
	const raw = app.metadataCache.getFileCache(file)?.frontmatter?.['up'];
	const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
	return values.some(
		(value) =>
			typeof value === 'string' &&
			/\[\[\s*Authors\s*\]\]|^\s*Authors\s*$/.test(value)
	);
}

function recordFromDisplay(display: string): AuthorRecord {
	const comma = display.indexOf(',');
	const family = comma === -1 ? display : display.slice(0, comma).trim();
	const given = comma === -1 ? '' : display.slice(comma + 1).trim();
	return {
		display,
		alias: family && given ? `${given} ${family}` : null,
		family,
		given,
		literal: comma === -1 ? display : '',
		roles: new Set(),
		citekeys: new Set(),
		tags: new Set(),
	};
}

/** Move/merge every existing author note into the Authors folder. */
export async function mergeExistingAuthorNotes(
	plugin: ReferenceList
): Promise<{ merged: number; moved: number }> {
	const app = plugin.app;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const folder = await ensureAuthorFolder(plugin);
	let merged = 0;
	let moved = 0;

	for (const file of app.vault.getMarkdownFiles()) {
		if (file.basename === 'Authors') continue; // the MOC, not a person
		const record =
			index.get(file.basename) ??
			(hasAuthorsUp(app, file) ? recordFromDisplay(file.basename) : null);
		if (!record) continue;

		const target = normalizePath(
			`${folder ? `${folder}/` : ''}${fileSafe(record.display)}.md`
		);
		const variants = variantsOf(app, file);
		const rendered = await renderAuthorPage(plugin, record, {
			variants,
			sourcePath: file.path,
		});
		const current = await app.vault.read(file);
		const content = current.trim()
			? mergeAuthorContent(current, rendered)
			: rendered;
		await app.vault.modify(file, content);
		merged++;
		if (file.path !== target) {
			if (!(app.vault.getAbstractFileByPath(target) instanceof TFile)) {
				try {
					await app.fileManager.renameFile(file, target);
					moved++;
				} catch (e) {
					console.warn('[sw:author] could not move author note', e);
				}
			}
		}
	}
	return { merged, moved };
}

/**
 * Refresh existing author pages when a literature note is imported: only pages
 * whose creator (or a listed variant) appears in the new note are touched.
 */
export async function refreshAuthorPagesForCitekey(
	plugin: ReferenceList,
	citekey: string
): Promise<void> {
	const app = plugin.app;
	const entry = plugin.bibManager.bibCache.get(citekey);
	if (!entry) return;
	const index = buildAuthorIndex(plugin.bibManager.bibCache.values());
	const creators = creatorsOf(entry).map(displayOf);
	const folder = (plugin.settings.authorNoteFolder ?? '').trim() || 'Authors';
	const dir = app.vault.getAbstractFileByPath(normalizePath(folder));
	if (!(dir instanceof TFolder)) return;

	for (const child of dir.children) {
		if (!(child instanceof TFile) || child.extension !== 'md') continue;
		const record = index.get(child.basename);
		if (!record) continue;
		const variants = variantsOf(app, child);
		const names = new Set([record.display, ...variants]);
		if (!creators.some((name) => names.has(name))) continue;
		const rendered = await renderAuthorPage(plugin, record, {
			variants,
			sourcePath: child.path,
		});
		const content = await app.vault.read(child);
		const merged = mergeAuthorContent(content, rendered);
		if (merged !== content) await app.vault.modify(child, merged);
	}
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
		void createAuthorPage(this.plugin, record, { open: true });
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
	const notice = new Notice(t('Merging author notes…'), 0);
	try {
		const { merged, moved } = await mergeExistingAuthorNotes(plugin);
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
