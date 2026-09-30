// Pure note-location helpers for the own import path.
//
// A literature note is identified by its managed `zotero-key` frontmatter field
// (the stable Zotero id) rather than only by filename. A citekey rename changes
// the suggested filename, so locating by the stable key keeps re-imports
// updating the SAME note instead of creating a duplicate.

import { normalizePath } from 'obsidian';

export interface NoteCandidate {
  path: string;
  /** The note's `zotero-key` frontmatter value, if any. */
  zoteroKey: unknown;
}

/** First candidate under `folder` whose `zotero-key` matches. */
export function matchNoteByZoteroKey(
  candidates: NoteCandidate[],
  folder: string,
  zoteroKey: string
): string | null {
  if (!zoteroKey) return null;
  const prefix = folder ? `${normalizePath(folder)}/` : '';
  for (const c of candidates) {
    if (prefix && !c.path.startsWith(prefix)) continue;
    if (c.zoteroKey === zoteroKey) return c.path;
  }
  return null;
}

/**
 * Bijective base-26 suffix: 0 → `base`, 1 → `basea`, 2 → `baseb`, … 27 → `baseaa`.
 * Used to sidestep a taken filename instead of overwriting it.
 */
export function suffixCandidate(base: string, index: number): string {
  if (index <= 0) return base;
  let n = index;
  let suffix = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    suffix = String.fromCharCode(97 + rem) + suffix;
    n = Math.floor((n - 1) / 26);
  }
  return base + suffix;
}

/** First `base`, `basea`, `baseb`… path under `folder` not in `taken`. */
export function findAvailableNotePath(
  base: string,
  folder: string,
  taken: ReadonlySet<string>
): string {
  const dir = folder ? normalizePath(folder) : '';
  for (let i = 0; i < 1000; i++) {
    const name = suffixCandidate(base, i);
    const path = dir ? `${dir}/${name}.md` : `${name}.md`;
    if (!taken.has(path)) return path;
  }
  // Practically unreachable; a timestamp keeps the "never overwrite" promise.
  const fallback = `${base}-${Date.now()}`;
  return dir ? `${dir}/${fallback}.md` : `${fallback}.md`;
}

/**
 * True when the note carries ZotLit's managed region. Such a note is CONVERTED
 * when our own template renders it: the merge replaces the `%%zt-managed%%`
 * span with ours, so the note becomes ScholarWeft-managed in place.
 */
export function isZotLitManaged(existing: string | null | undefined): boolean {
  return (existing ?? '').includes('%%zt-managed%%');
}

/** How to treat an existing ZotLit note when our template renders it. */
export type ZotLitHandling = 'ask' | 'convert' | 'leave';

/**
 * A choice from the conversion prompt. Converting is REMEMBERED (`convert`
 * becomes the setting, so the user is never asked again); leaving is NOT — a
 * "no" only applies to this note, and the next ZotLit note asks again, since a
 * user who declines while trying the plugin may switch later.
 */
export type ZotLitChoice = 'convert' | 'leave';

/**
 * Map a prompt choice to the immediate action and the setting to remember.
 * Pure, so the policy is testable.
 */
export function zotLitChoice(choice: ZotLitChoice): {
  action: 'convert' | 'leave';
  remember: 'convert' | null;
} {
  return choice === 'convert'
    ? { action: 'convert', remember: 'convert' }
    : { action: 'leave', remember: null };
}

// ── Citekey reconciliation (Zotero-key → note) ─────────────────────────────
//
// A Zotero item's citekey can change (Better BibTeX pin/edit). The item's
// stable `zotero-key` does not, so the note carrying that key is the item's
// note whatever its filename. The note ITSELF records the old name (its
// filename, and/or its `citekey:` frontmatter), so no separate rename history
// is needed: compare the note against the library's current citekey and rename
// when they differ.

/** True for a character that may continue a Pandoc/BBT citekey. Used as the
 *  boundary when matching `@key` inside a filename: `@foo2012` must never match
 *  `@foo2012a`, an excerpt image (`@key_p3_AB12`), or the note itself
 *  (`@key.md`). */
export function isCitekeyChar(ch: string): boolean {
  return /[\p{L}\p{N}:.#$%&+\-?<>~_/]/u.test(ch);
}

/**
 * The citekey a literature-note filename records (`@key` → `key`), or null when
 * the basename is not a bare `@key` (derived files like `@key - transcription`,
 * hand-named notes). `basename` is the filename WITHOUT its extension.
 */
export function citekeyFromBasename(basename: string): string | null {
  const m = /^@([^\s/]+)$/.exec(basename);
  return m ? m[1] : null;
}

/**
 * New filename for a file derived from a reference — `@old - transcription.md`
 * → `@new - transcription.md` — or null when `name` is not derived from
 * `fromKey` (or is the note/excerpt image itself, which the boundary rule
 * excludes because `.`/`_` continue a citekey).
 */
export function derivedRenameFor(
  name: string,
  fromKey: string,
  toKey: string
): string | null {
  if (!fromKey || fromKey === toKey) return null;
  const prefix = `@${fromKey}`;
  if (!name.startsWith(prefix)) return null;
  const next = name.charAt(prefix.length);
  if (!next || isCitekeyChar(next)) return null;
  return `@${toKey}${name.slice(prefix.length)}`;
}

/** A literature note as reconciliation sees it. */
export interface ReconcileNote {
  path: string;
  /** Filename without extension (`@oldKey`). */
  basename: string;
  /** Frontmatter `citekey:`, if any. */
  citekey: string | null;
  /** Frontmatter `zotero-key` (stable; `KEY` or `KEYgGROUPID`). */
  zoteroKey: string;
}

/** One note whose name/frontmatter no longer matches its item's citekey. */
export interface NoteReconcile {
  path: string;
  /** New path; equal to `path` when only the frontmatter changes. */
  newPath: string;
  /** The stale key recorded by the note (filename, else frontmatter). */
  fromKey: string;
  /** The library's current citekey. */
  toKey: string;
  zoteroKey: string;
  /** True when the `citekey:` frontmatter must be written. */
  rekeyFrontmatter: boolean;
}

/** A derived file (`@old …`) to rename alongside its note. */
export interface DerivedRename {
  path: string;
  newPath: string;
  fromKey: string;
  toKey: string;
}

/** Everything a reconcile pass would change. */
export interface CitekeyReconcilePlan {
  /** Notes that will be renamed/re-keyed. */
  renames: NoteReconcile[];
  /**
   * Old → new citekeys for items that have NO literature note (detected by
   * diffing the persisted library cache against a refresh, matched by
   * `_zoteroKey`). Their citations are rewritten, but there is no note to
   * rename. */
  citeOnly: Array<{ fromKey: string; toKey: string }>;
  /** Notes whose new name is already taken (reported, not acted on). */
  blocked: NoteReconcile[];
  /** Notes whose `zotero-key` is not in the loaded library (reported, not acted on). */
  unresolved: ReconcileNote[];
  derived: DerivedRename[];
  /** Derived-file target names already taken; those renames are skipped. */
  conflicts: string[];
}

/**
 * Cite-only pairs: every detected rename (`pending`) whose old key is NOT the
 * `fromKey` of a note rename (those are handled by the note pass). Pure, so the
 * partition is testable.
 */
export function citeOnlyPairs(
  pending: ReadonlyMap<string, string>,
  noteFromKeys: ReadonlySet<string>
): Array<{ fromKey: string; toKey: string }> {
  const out: Array<{ fromKey: string; toKey: string }> = [];
  for (const [fromKey, toKey] of pending) {
    if (fromKey && toKey && fromKey !== toKey && !noteFromKeys.has(fromKey)) {
      out.push({ fromKey, toKey });
    }
  }
  return out;
}

/**
 * Match notes to their item by stable `zotero-key` and plan the renames. Pure:
 * the caller supplies the library resolver. A note is included only when its
 * filename or `citekey:` differs from the resolved current citekey. A note
 * whose filename is not `@key` is re-keyed in frontmatter but not renamed (the
 * user's own name is respected).
 */
export function planCitekeyReconcile(
  notes: ReconcileNote[],
  resolveCitekey: (zoteroKey: string) => string | null
): { renames: NoteReconcile[]; unresolved: ReconcileNote[] } {
  const renames: NoteReconcile[] = [];
  const unresolved: ReconcileNote[] = [];

  for (const note of notes) {
    const toKey = resolveCitekey(note.zoteroKey);
    if (!toKey) {
      unresolved.push(note);
      continue;
    }

    const fnameKey = citekeyFromBasename(note.basename);
    const fmKey = note.citekey;
    const filenameDiffers = fnameKey != null && fnameKey !== toKey;
    const fmDiffers = fmKey !== toKey;
    if (!filenameDiffers && !fmDiffers) continue; // already current

    const fromKey = filenameDiffers ? fnameKey! : fmKey ?? fnameKey ?? '';
    let newPath = note.path;
    if (filenameDiffers) {
      const dir = note.path.replace(/[^/]+$/, '');
      newPath = normalizePath(`${dir}@${toKey}.md`);
    }

    renames.push({
      path: note.path,
      newPath,
      fromKey,
      toKey,
      zoteroKey: note.zoteroKey,
      rekeyFrontmatter: fmDiffers,
    });
  }

  return { renames, unresolved };
}

// The citekey parser lives in ONE dependency-free module so every detection
// site is identical (reconcile, the converters, the migration tools). Re-export
// it here so existing importers of `note-lookup` keep working.
export {
  CITEKEY_BODY,
  replaceCitekeys,
  scanCitekeys,
  transformBareCitekeys,
  type CitekeyHit,
} from './citekey-grammar';
