/**
 * Blockquote `>`-prefix formatting for callout content.
 *
 * Adapted from ZotLit (AGPL-3.0) — `packages/templates/src/blockquote.ts` — so
 * note output matches ZotLit's byte-for-byte. The notable behaviour is that
 * CONSECUTIVE blank lines collapse to a single `>`; without that, multi-paragraph
 * comments render differently inside a callout.
 *
 * @see NOTICE.md — ZotLit attribution.
 */
export function formatBlockquote(content: string): string {
  const lines = content
    .trim()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`));
  return lines
    .filter((line, i) => !(line === '>' && lines[i - 1] === '>'))
    .join('\n');
}
