/**
 * THE compound-forming step for pandoc-style bracket citations.
 *
 * Shared by the plugin's in-process exporter (`src/convertCitations.ts`) and the
 * CLI (`scripts/convert-citations.mjs`, via `parser-bundle.mjs`), so a compound
 * citation is formed by ONE function everywhere.
 *
 * The caller first does the INITIAL PARSING (see `rewriteContainers`): it
 * flattens a container's members into a plain sequence of pandoc citations, so
 * a former container (`[@a] [@b]`) and genuinely adjacent citations
 * (`[[@a]] [[@b]]` → `[@a] [@b]`) arrive here IDENTICALLY and merge into one
 * multi-item citation `[@a; @b]`.
 *
 * Only bracket groups whose content contains `@` are merged, so markdown links
 * (`[text](url)`) and prose brackets are never touched. A bare narrative `@a`
 * (no brackets) is not merged. Separators allowed: spaces/tabs and at most ONE
 * newline — matching the in-app parser's contiguous rule.
 */
export function mergeCompoundCitations(text: string): string {
  const ADJACENT =
    /\[([^\]\n]*@[^\]\n]*)\]([ \t]*\n?[ \t]*)\[([^\]\n]*@[^\]\n]*)\]/g;
  let prev: string;
  let out = text;
  do {
    prev = out;
    out = out.replace(ADJACENT, '[$1; $3]');
  } while (out !== prev);
  return out;
}
