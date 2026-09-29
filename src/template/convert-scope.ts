/**
 * Which markdown files a VAULT-WIDE rewrite may touch.
 *
 * The whole-vault convert commands ("Convert pandoc citations to linked
 * citations (vault)" and its reverse) walk every markdown file, which means
 * they would also rewrite documentation, archived material, and the plugin's
 * own bundled docs — none of which are the user's citations, and all of which
 * then carry a `.bk` backup as if they were. This narrows that set.
 *
 * Pure: takes the candidate paths and the excluded folders, so the rule is
 * testable without a vault.
 */

/** Folders a vault-wide rewrite never touches. Vault-root relative. */
export const DEFAULT_EXCLUDED_FOLDERS = [
  // The plugin's own docs, if the repo (or a copy of it) lives in the vault.
  'docs',
  'src',
  'node_modules',
];

/** Normalise a vault path/folder for comparison: no leading/trailing slash. */
function norm(s: string): string {
  return s.replace(/^\.?\//, '').replace(/\/+$/, '').trim();
}

/**
 * Is `path` inside `folder` (or the folder itself)? Matches whole path
 * segments only, so `docs` does not exclude `docs-notes/`.
 */
export function isInFolder(path: string, folder: string): boolean {
  const f = norm(folder);
  if (!f) return false;
  const p = norm(path);
  return p === f || p.startsWith(f + '/');
}

/**
 * The paths a vault-wide rewrite should process: everything EXCEPT backups,
 * non-markdown, and anything under an excluded folder.
 *
 * Backups (`.bk`, `.bk.md`) are always skipped — they exist only as the
 * pre-conversion copy, so rewriting one would defeat its purpose.
 */
export function filesToConvert(
  allPaths: readonly string[],
  excludedFolders: readonly string[] = DEFAULT_EXCLUDED_FOLDERS
): string[] {
  const excluded = excludedFolders.map(norm).filter(Boolean);
  return allPaths.filter((path) => {
    if (!/\.md$/i.test(path)) return false;
    if (path.endsWith('.bk') || path.endsWith('.bk.md')) return false;
    if (excluded.some((f) => isInFolder(path, f))) return false;
    return true;
  });
}
