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
 * ZotLit overrides Eta's `include` so that an explicit second argument REPLACES
 * the data root instead of merging into it.
 */
const includeDataPlugin: NonNullable<EtaConfig['plugins']>[number] = {
  processFnString(fnString, config) {
    const varName = config?.varName ?? 'it';
    return fnString.replace(
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, __eta_d ?? ${varName}, options);`
    );
  },
};

/**
 * Eta engine with the template helpers attached.
 *
 * The helpers must live on the INSTANCE: the injected `functionHeader` calls
 * `this.bqHelper(...)`, so a plain `Eta` (or a `configure()` afterwards) throws
 * "this.bqHelper is not a function". Same shape as ZotLit's `TemplateEngine`.
 */
export class NoteTemplateEngine extends Eta {
  /** `bq` wraps captured output in callout-safe blockquote prefixes. */
  readonly bqHelper = formatBlockquote;

  constructor(dataRoot: string = TEMPLATE_DATA_ROOT) {
    super({
      cache: true,
      varName: dataRoot,
      autoTrim: [true, true],
      autoEscape: false,
      autoFilter: true,
      functionHeader: 'const bq = (fn) => output(this.bqHelper(capture(fn)));',
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
