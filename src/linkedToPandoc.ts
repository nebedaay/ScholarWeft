import { Notice, TFile } from 'obsidian';
import type ReferenceList from './main';
import {
  DEFAULT_EXCLUDED_FOLDERS,
  filesToConvert,
} from './template/convert-scope';
import { convertLinksToPandoc } from './parser/compound';
import { rewriteContainers } from './convertCitations';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * The vault-wide folders this plugin's convert commands should skip: the
 * built-in non-content folders plus whatever the user added in settings.
 */
export function convertExcludedFolders(extra?: string): string[] {
  const user = (extra ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_EXCLUDED_FOLDERS, ...user];
}

/**
 * Convert a single [[@key|alias]] member to its pandoc equivalent.
 *
 * Alias conventions (set by pandocToLinked.ts):
 *   "@"       → [@key]          simple bracketed citation
 *   "@ -"     → @key            narrative (in-text) citation, no brackets
 *   "-@..."   → [-@key...]      suppress-author with optional suffix
 *   "pfx @ sfx" → [pfx @key sfx]  prefix / suffix
 */
function singleToPandoc(key: string, alias: string | undefined): string {
  const a = (alias ?? '').trim();
  if (!a || a === '@') return `[@${key}]`;
  if (a === '@ -') return `@${key}`;
  if (a.startsWith('-@')) return `[-@${key}${a.slice(2)}]`;
  return `[${a.replace('@', `@${key}`)}]`;
}

/** A `[[@key]]` / `[[@key|alias]]` link, captured as key + optional alias. */
const LINK_RE = /\[\[@([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** Is this alias a full-reference insertion (`reference` / `ref`)? */
const isRefAlias = (alias: string | undefined): boolean =>
  alias !== undefined && /^\s*(?:ref|reference)\s*$/i.test(alias);

// ── core rewrite ──────────────────────────────────────────────────────────────

/**
 * Rewrite all linked citations in `body` back to Pandoc-style citations.
 *
 * Three steps, sharing the EXPORT path's implementation so both agree:
 *
 *  1. `rewriteLinks` turns each `[[@key|alias]]` into an individual citation.
 *  2. `rewriteContainers` flattens a container (`[ [[@a]]; [[@b]] ]`) into a
 *     plain sequence — the same flattener export uses.
 *  3. `mergeCompoundCitations` (also shared) merges ADJACENT bracketed citations
 *     into ONE. This is what makes contiguous links (`[[@a]] [[@b]]`) and a
 *     container BOTH come out as `[@a; @b]` — one citation, not `[@a] [@b]`,
 *     which pandoc reads as two unrelated citations.
 *
 * Handles:
 *   [[@key]]              → [@key]
 *   [[@key|@ -]]          → @key  (narrative)
 *   [[@key|-@, p.6]]      → [-@key, p.6]  (suppress-author)
 *   [[@key|see @, p.6]]   → [see @key, p.6]
 *   [[@a]] [[@b]]         → [@a; @b]  (contiguous — ONE pandoc citation)
 *   [ [[@a]]; [[@b]] ]    → [@a; @b]  (multi-work container)
 *
 * Full-reference insertions (`[[@key|reference]]`) and code (fenced or inline)
 * have no pandoc equivalent and are left byte-for-byte untouched.
 */
export function rewriteLinkedToPandoc(body: string): { out: string; changed: boolean } {
  // Mask the things neither step may touch, so container flattening cannot
  // mistake a full-reference link for a container member.
  const masked: string[] = [];
  const shield = (m: string) => `\u0000${masked.push(m) - 1}\u0000`;

  let out = body
    .replace(/```[\s\S]*?```/g, shield)
    .replace(/`[^`\n]+`/g, shield)
    .replace(/\[\[@[^\]|]*\|(?:ref|reference)\]\]/gi, shield);

  // ONE pipeline, shared with the export converter (see `convertLinksToPandoc`).
  out = convertLinksToPandoc(out, {
    linkRe: LINK_RE,
    flatten: rewriteContainers,
    renderLink: ({ key, alias }) => {
      if (isRefAlias(alias)) return null; // full-reference — leave as-is
      return singleToPandoc(key, alias);
    },
  });

  out = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => masked[+i]);
  return { out, changed: out !== body };
}

// ── per-note conversion ───────────────────────────────────────────────────────

/**
 * Revert linked citations to pandoc-style in the active note.
 * Writes a "<file>.bk" backup on first conversion.
 */
export async function convertNoteToPandoc(
  plugin: ReferenceList,
  file: TFile
): Promise<void> {
  const content = await plugin.app.vault.read(file);

  let body = content;
  let frontmatter = '';
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(content);
  if (fm) {
    frontmatter = fm[0];
    body = content.slice(fm[0].length);
  }

  const { out, changed } = rewriteLinkedToPandoc(body);
  if (!changed) {
    new Notice(`No linked citations found in ${file.basename}.`, 4000);
    return;
  }

  const bkPath = `${file.path}.bk`;
  if (!(await plugin.app.vault.adapter.exists(bkPath))) {
    await plugin.app.vault.adapter.write(bkPath, content);
  }
  await plugin.app.vault.modify(file, frontmatter + out);
  new Notice(`Reverted linked citations to pandoc-style in ${file.basename}.`, 5000);
}

// ── vault-wide conversion ─────────────────────────────────────────────────────

/**
 * Revert linked citations to pandoc-style across the entire vault.
 * Writes per-file ".bk" backups (only when none exist yet).
 */
export async function convertVaultToPandoc(plugin: ReferenceList): Promise<void> {
  const allowed = new Set(
    filesToConvert(
      plugin.app.vault.getMarkdownFiles().map((f) => f.path),
      convertExcludedFolders(plugin.settings.convertExcludeFolders)
    )
  );
  const files = plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => allowed.has(f.path));

  const progress = new Notice(`Reverting citations across ${files.length} files…`, 0);
  let convertedFiles = 0;

  try {
    for (const file of files) {
      const content = await plugin.app.vault.read(file);

      let body = content;
      let frontmatter = '';
      const fm = /^---\n[\s\S]*?\n---\n?/.exec(content);
      if (fm) {
        frontmatter = fm[0];
        body = content.slice(fm[0].length);
      }

      const { out, changed } = rewriteLinkedToPandoc(body);
      if (!changed) continue;

      const bkPath = `${file.path}.bk`;
      if (!(await plugin.app.vault.adapter.exists(bkPath))) {
        await plugin.app.vault.adapter.write(bkPath, content);
      }
      await plugin.app.vault.modify(file, frontmatter + out);
      convertedFiles++;
    }
  } finally {
    progress.hide();
  }

  new Notice(
    convertedFiles > 0
      ? `Reverted linked citations in ${convertedFiles} file${convertedFiles !== 1 ? 's' : ''}.`
      : `No linked citations found in vault.`,
    6000
  );
}
