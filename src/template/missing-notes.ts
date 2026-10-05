// Pure helpers for "insert literature notes for linked citations".
//
// The behaviour is a three-way choice (radio), not a boolean:
//   `all`      — ensure a literature note exists for every linked citation the
//                plugin sees, as part of its normal work (insertion + when a
//                note's citations are resolved);
//   `onInsert` — only when a linked citation is inserted in the editor;
//   `never`    — never create a note implicitly (only the explicit commands).
//
// Kept dependency-free so both the settings UI and the citation/render paths
// can share one definition and the predicates are unit-testable.

/** How ScholarWeft fills in literature notes for linked citations. */
export type MissingLinkedNoteAction = 'all' | 'onInsert' | 'never';

/** True when a linked citation INSERTION should create the missing note. */
export function insertsNoteOnInsertion(
  action: MissingLinkedNoteAction | undefined
): boolean {
  return action === 'all' || action === 'onInsert';
}

/** True when resolving a note's citations should sweep them for missing notes. */
export function sweepsNoteOnResolve(
  action: MissingLinkedNoteAction | undefined
): boolean {
  return action === 'all';
}

/**
 * The citekeys cited as WIKILINKS in `text` (`[[@key]]` / `[[@key|alias]]`), in
 * order, de-duplicated.
 *
 * A derived-file link (`[[@key - transcription]]`) is deliberately excluded: the
 * key must be immediately followed by `|` or `]`, matching the editor's own
 * linked-citation detection. Plain `[@key]` and bare `@key` are not linked
 * citations and are not returned.
 */
export function linkedCitekeysIn(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[@([^|\]\s]+)(?=[|\]])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}
