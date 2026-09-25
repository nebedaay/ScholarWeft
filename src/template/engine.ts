// Template engines used to render ZotLit-compatible note templates.
//
// Eta renders the `.eta.md` templates; Liquid renders `.liquid.md` (the filename
// template). Both are bundled into main.js (combined ~88 KB minified) so the
// engine always travels with the templates it renders.
//
// The Eta configuration below mirrors ZotLit's (`packages/templates/src/index.ts`,
// AGPL-3.0 — see NOTICE.md) because the bundled templates were written against
// it. In particular:
//   - `varName: "zt"` — the data root is exposed as `zt`; without it templates
//     fail with "zt is not defined".
//   - `functionHeader` — injects `bq`/`basename`/`suffix`/`embed` as globals, so
//     templates can call them without importing anything.
//   - `include` REPLACES the data root rather than merging it (ZotLit overrides
//     Eta's default). Templates here always pass `zt` explicitly, so this only
//     matters for an `include()` with no second argument.
import { Eta } from 'eta';
import type { EtaConfig } from 'eta';
import { Liquid } from 'liquidjs';

import { formatBlockquote } from './blockquote';

/** Eta variable name the templates read their data from. */
export const ZT_ROOT = 'zt';

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

export function makeEta(): Eta {
  return new Eta({
    cache: true,
    varName: ZT_ROOT,
    autoTrim: [true, true],
    autoEscape: false,
    autoFilter: true,
    // `bq` wraps captured output in callout-safe blockquote prefixes.
    functionHeader:
      'const bq = (fn) => output(this.bqHelper(capture(fn)));',
    plugins: [includeDataPlugin],
  } as unknown as EtaConfig);
}

/** Liquid renders the filename template (`.liquid.md`). */
export function makeLiquid(): Liquid {
  return new Liquid({ greedy: false, strictFilters: true });
}

/** `bq` helper handed to Eta via `functionHeader`. */
export const blockquoteHelper = formatBlockquote;
