// Naming for annotation excerpt images copied into the vault.
//
// Obsidian cannot render Zotero's `file://` cache path inside a note, so the
// importer copies each excerpt PNG into the vault and embeds it as `![[…]]`.
// These functions are pure, so the naming rule is unit-testable on its own
// (the copy itself is I/O and lives in `noteImport.ts`).

/**
 * `@<citekey>_p<page>_<annotationKey>.png`.
 *
 * The annotation key is immutable and globally unique, so the name is stable
 * across re-imports and can never collide. The citekey and page are the
 * readable part — which reference, and where the quote is — and they keep one
 * reference's images together in a sorted listing. The `p<page>` segment is
 * dropped when the page is unknown.
 *
 * This improves on ZotLit's bare `<annotationKey>.png` (stable but cryptic) and
 * on a per-reference page-sequence number (readable but shifted whenever an
 * earlier annotation is added on the same page).
 */
export function excerptImageName(
  citekey: string,
  page: number | null,
  key: string
): string {
  return `@${citekey}${page != null ? `_p${page}` : ''}_${key}.png`;
}

/**
 * An existing vault copy of the SAME annotation, so it is reused/renamed rather
 * than duplicated: our named form first (`*_<key>.png`), else ZotLit's bare
 * `<key>.png`. Renaming to the current `excerptImageName` keeps the file stable
 * (the key is unchanged) while refreshing the readable citekey/page part.
 */
export function findPreviousImagePath(
  files: readonly string[],
  key: string
): string | undefined {
  return (
    files.find((f) => f.endsWith(`_${key}.png`)) ??
    files.find((f) => f.endsWith(`/${key}.png`))
  );
}
