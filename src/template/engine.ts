// Template engines used to render ZotLit-compatible note templates.
//
// Eta renders the `.eta.md` templates; Liquid renders `.liquid.md` (the filename
// template). Both are bundled into main.js (combined ~88 KB minified) so the
// engine always travels with the templates it renders.
//
// The Eta configuration mirrors ZotLit's (`packages/templates/src/index.ts`,
// AGPL-3.0 — see NOTICE.md) because the bundled templates were written against
// it. The parts that matter:
//   - The data root is exposed under TEMPLATE_DATA_ROOT. This is the ONE place
//     that knows about ZotLit's naming: the templates read their data from `zt`,
//     so that name is a property of THESE templates, not of ScholarWeft. Our own
//     code uses its own names throughout.
//   - `functionHeader` injects `bq`/`basename`/`suffix`/`embed` as globals, so
//     templates can call them without importing anything.
//   - `include` REPLACES the data root rather than merging it (ZotLit overrides
//     Eta's default). Templates here always pass the root explicitly, so this
//     only matters for an `include()` with no second argument.
import { Eta } from 'eta';
import type { EtaConfig } from 'eta';
import { Liquid } from 'liquidjs';

import { formatBlockquote } from './blockquote';
import {
  basename,
  coerceOutput,
  embed,
  filenameSuffix,
} from './zotlit-helpers';

/**
 * Variable name our note templates read their data from.
 *
 * Our own templates (`sw-note-templates/`) use `item.…`. The ZotLit-compatible
 * set (`sw-zotlit-templates/`, rendered by ZotLit itself) uses `zt`, so the root
 * is a parameter of the render, not a fixed constant — callers pass whichever
 * their template set expects.
 */
export const TEMPLATE_DATA_ROOT = 'item';

/** Data root used by the ZotLit-compatible templates ZotLit renders. */
export const ZOTLIT_TEMPLATE_DATA_ROOT = 'zt';

/**
 * ZotLit overrides Eta's `include`/`includeAsync` so an explicit second argument
 * REPLACES the data root instead of merging into it (eta-4 spreads the parent
 * data, which breaks v1 templates that pass arrays through `include`).
 *
 * Both helpers are rewritten: eta emits both into every compiled template, so
 * leaving the async one raw would silently reintroduce the spread bug on any
 * `renderAsync` path. A missing pattern means eta's codegen changed — fail loud
 * rather than no-op.
 */
function replaceOnce(
  source: string,
  needle: string,
  replacement: string,
  label: string
): string {
  const at = source.indexOf(needle);
  if (at === -1) {
    throw new Error(
      `[sw template] eta codegen changed (no ${label} helper); update includeDataPlugin`
    );
  }
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

const includeDataPlugin: NonNullable<EtaConfig['plugins']>[number] = {
  processFnString(fnString, config) {
    const varName = config?.varName ?? 'it';
    const spread = `{...${varName}, ...(__eta_d ?? {})}`;
    const out = replaceOnce(
      fnString,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, ${spread}, options);`,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, __eta_d ?? ${varName}, options);`,
      'include'
    );
    return replaceOnce(
      out,
      `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, ${spread}, options);`,
      `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, __eta_d ?? ${varName}, options);`,
      'includeAsync'
    );
  },
};

/**
 * Eta engine with the template helpers attached.
 *
 * Mirrors ZotLit's `TemplateEngine` (`packages/templates/src/index.ts`,
 * AGPL-3.0 — see NOTICE.md) so a template written for ZotLit renders the same
 * with only `zt` → our data root changed: the same `functionHeader` globals
 * (`bq`/`basename`/`suffix`/`embed`), the `coerceOutput` filter, and the
 * include-data override.
 *
 * The helpers must live on the INSTANCE: the injected `functionHeader` calls
 * `this.bqHelper(...)` etc., so a plain `Eta` (or a `configure()` afterwards)
 * throws "this.bqHelper is not a function".
 */
export class NoteTemplateEngine extends Eta {
  /** `bq` wraps captured output in callout-safe blockquote prefixes. */
  readonly bqHelper = formatBlockquote;
  readonly basenameHelper = basename;
  readonly suffixHelper = filenameSuffix;
  readonly embedHelper = embed;

  constructor(dataRoot: string = TEMPLATE_DATA_ROOT) {
    super({
      cache: true,
      varName: dataRoot,
      autoTrim: [true, true],
      autoEscape: false,
      autoFilter: true,
      filterFunction: coerceOutput,
      functionHeader:
        'const bq = (fn) => output(this.bqHelper(capture(fn))); ' +
        'const basename = this.basenameHelper; ' +
        'const suffix = this.suffixHelper; ' +
        'const embed = this.embedHelper;',
      plugins: [includeDataPlugin],
    } as unknown as EtaConfig);
  }
}

export function makeEta(dataRoot: string = TEMPLATE_DATA_ROOT): NoteTemplateEngine {
  return new NoteTemplateEngine(dataRoot);
}

/** Liquid renders the filename template (`.liquid.md`). */
export function makeLiquid(): Liquid {
  return new Liquid({ greedy: false, strictFilters: true });
}

/** `bq` helper handed to Eta via `functionHeader`. */
export const blockquoteHelper = formatBlockquote;
