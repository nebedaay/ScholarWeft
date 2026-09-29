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

/** The whole linked→pandoc pipeline: flatten containers, render each link, then
 *  form compounds. The two steps that differ between callers are supplied as
 *  `renderLink` (how to turn one `[[@key|alias]]` match into pandoc text) and
 *  the container handling, so the ORDER and the compound step exist once. */

/** One `[[@key|alias]]` / `[[@key]]` match, as the caller's own regex captures it. */
export interface LinkMatch {
  /** The full matched text. */
  full: string;
  key: string;
  alias: string | undefined;
  index: number;
  /** The caller's match object, for any extra capture groups it needs. */
  match: RegExpExecArray;
}

/** Render one link match to its pandoc text, or `null` to leave it untouched. */
export type RenderLink = (m: LinkMatch) => string | null;

/**
 * Run the shared linked→pandoc pipeline over `text`.
 *
 * Write-once orchestration of the three steps every converter must perform in
 * this order:
 *   1. `flatten` — rewrite any container (`[ [[@a]]; [[@b]] ]`) to a plain
 *      sequence of citations, using the caller's container logic.
 *   2. `renderLink` — turn each remaining `[[@key|alias]]` into pandoc text.
 *   3. `mergeCompoundCitations` — merge ADJACENT citations into one
 *      (`[@a] [@b]` → `[@a; @b]`), so contiguous links and containers agree.
 *
 * Keeping the order in ONE place is the point: a second copy is free to run the
 * steps in a different order and diverge.
 */
export function convertLinksToPandoc(
  text: string,
  opts: {
    /** Match every `[[@key|alias]]` link; `renderLink` is called per match. */
    linkRe: RegExp;
    renderLink: RenderLink;
    /** Container flattening, applied BEFORE link rendering. Default: identity. */
    flatten?: (s: string) => string;
  }
): string {
  let out = opts.flatten ? opts.flatten(text) : text;

  out = out.replace(opts.linkRe, (...args: unknown[]) => {
    const match = args.slice(0, -2) as unknown as RegExpExecArray;
    (match as { index?: number }).index = args[args.length - 2] as number;
    const full = args[0] as string;
    const rendered = opts.renderLink({
      full,
      key: (args[1] as string) ?? '',
      alias: args.length > 3 ? (args[2] as string | undefined) : undefined,
      index: args[args.length - 2] as number,
      match,
    });
    return rendered == null ? full : rendered;
  });

  return mergeCompoundCitations(out);
}

