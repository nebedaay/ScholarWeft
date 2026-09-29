/** How many imported notes to LIST before collapsing to "(and N other notes)". */
export const IMPORT_SUMMARY_MAX = 20;

/**
 * A human summary of an import run: "Imported 3 literature notes: @a, @b, @c",
 * collapsing a long list to "… and N other notes" so a 200-note batch does not
 * produce an unreadable toast.
 */
export function formatImportSummary(names: readonly string[]): string {
  const n = names.length;
  if (n === 0) return 'No literature notes were imported.';
  const head = names.slice(0, IMPORT_SUMMARY_MAX);
  const rest = n - head.length;
  const noun = `literature note${n === 1 ? '' : 's'}`;
  const list =
    head.join(', ') +
    (rest > 0 ? ` and ${rest} other note${rest === 1 ? '' : 's'}` : '');
  return `Imported ${n} ${noun}: ${list}`;
}
