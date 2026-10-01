/**
 * Orthographic-variant folding for the citation search.
 *
 * `color`/`colour`, `polarised`/`polarized`, `analyse`/`analyze` are the same
 * word; `aegean`/`egean` are not. A PATTERN alone cannot tell them apart — the
 * `ae`→`e` rule that yields `aesthetic`→`esthetic` also yields `Caesar`→`Cesar`,
 * and that is not a variant of anything.
 *
 * So: a curated STEM LIST decides whether two spellings are variants. Each stem
 * is inflected in both spellings in lockstep, so a form only ever has ONE known
 * counterpart — `colour`↔`color`, `colours`↔`colors`, `colouring`↔`coloring` —
 * and the search never invents a spelling that is not a real word.
 */

/**
 * Stems whose British/American spellings are genuine variants, keyed by the
 * canonical stem with the British stem as the value. Only words here are folded.
 */
const STEM_PAIRS: Record<string, string> = {
  // -or / -our
  color: 'colour', flavor: 'flavour', favor: 'favour', honor: 'honour',
  humor: 'humour', labor: 'labour', neighbor: 'neighbour', rumor: 'rumour',
  behavior: 'behaviour', endeavor: 'endeavour', harbor: 'harbour',
  rigor: 'rigour', vigor: 'vigour', splendor: 'splendour', odor: 'odour',
  valor: 'valour', armor: 'armour', ardor: 'ardour', candor: 'candour',
  demeanor: 'demeanour', parlor: 'parlour', savior: 'saviour',
  tumor: 'tumour', vapor: 'vapour',
  // -ize / -ise
  organize: 'organise', recognize: 'recognise', analyze: 'analyse',
  paralyze: 'paralyse', catalyze: 'catalyse', civilize: 'civilise',
  realize: 'realise', modernize: 'modernise', globalize: 'globalise',
  secularize: 'secularise', standardize: 'standardise',
  characterize: 'characterise', categorize: 'categorise',
  theorize: 'theorise', legitimize: 'legitimise', emphasize: 'emphasise',
  criticize: 'criticise', colonize: 'colonise', polarize: 'polarise',
  mobilize: 'mobilise', normalize: 'normalise', marginalize: 'marginalise',
  institutionalize: 'institutionalise', nationalize: 'nationalise',
  privatize: 'privatise', radicalize: 'radicalise', summarize: 'summarise',
  minimize: 'minimise', maximize: 'maximise', optimize: 'optimise',
  prioritize: 'prioritise', rationalize: 'rationalise', visualize: 'visualise',
  conceptualize: 'conceptualise', contextualize: 'contextualise',
  problematize: 'problematise', democratize: 'democratise',
  industrialize: 'industrialise', urbanize: 'urbanise',
  aestheticize: 'aestheticise', materialize: 'materialise',
  mechanize: 'mechanise', stigmatize: 'stigmatise',
  // -ae / -e, -oe / -e where BOTH spellings are real words
  medieval: 'mediaeval', encyclopedia: 'encyclopaedia',
  aesthetic: 'esthetic', estrogen: 'oestrogen', edema: 'oedema',
  esophagus: 'oesophagus', diarrhea: 'diarrhoea', apnea: 'apnoea',
  anemia: 'anaemia', anesthesia: 'anaesthesia', hemorrhage: 'haemorrhage',
  archaeology: 'archeology', pediatric: 'paediatric',
  orthopedics: 'orthopaedics', paleontology: 'palaeontology',
};

/**
 * Inflections applied to BOTH spellings of a stem. Deliberately a closed list:
 * an inflection not here is simply not folded, which is safer than guessing.
 */
const TAILS = [
  'ations', 'ation',
  'ing', 'ings',
  'ed',
  'es', 's',
  'er', 'ers',
  'al', 'ally',
  'ic', 'ical',
  'ive', 'ives',
  'able', 'ably',
  'ity', 'ities',
  'ism', 'isms',
  'ist', 'ists',
  'ment', 'ments',
  '', // the bare stem
];

/**
 * Inflect a stem. A trailing `e` is dropped before a vowel-initial suffix, the
 * normal English spelling (`polarize` + `ed` → `polarized`, not
 * `polarizeed`), so both spellings stay real words.
 */
function inflect(stem: string, tail: string): string {
  return /^[aeiou]/.test(tail) ? stem.replace(/e$/, '') + tail : stem + tail;
}

/** A known spelling and the other spelling of the same word. */
interface Variant {
  /** The canonical spelling every form of this word folds to. */
  canon: string;
  /** The single other spelling of the SAME word (`colour` → `color`). */
  counterpart: string;
}

/** Every known spelling → its canonical form and counterpart. */
const VARIANT_INDEX = new Map<string, Variant>();

for (const [canonStem, otherStem] of Object.entries(STEM_PAIRS)) {
  for (const tail of TAILS) {
    const canon = inflect(canonStem, tail);
    const other = inflect(otherStem, tail);
    if (!canon || !other || canon === other) continue;
    // The two spellings share a canonical form, so `colour` and `color` fold
    // together while neither folds to anything outside its own stem.
    register(canon, canon, other);
    register(other, canon, canon);
  }
}

/** Add a form, refusing to let two stems claim the same spelling. */
function register(form: string, canon: string, counterpart: string): void {
  const existing = VARIANT_INDEX.get(form);
  if (existing) {
    // A real collision would make the fold ambiguous; keep the first claim so
    // behaviour is deterministic, and let the test suite expose any collision.
    return;
  }
  VARIANT_INDEX.set(form, { canon, counterpart });
}

/** Does `word` have a known other spelling (registered or stem-derived)? */
export function isVariantWord(word: string): boolean {
  return spellingVariants(word).length > 0;
}

/** The canonical spelling a word folds to (itself when not a known variant). */
export function canonicalForm(word: string): string {
  return VARIANT_INDEX.get(word)?.canon ?? word;
}

/** Are these two words the same word under the variant rules? */
export function sameVariantWord(a: string, b: string): boolean {
  if (a === b) return true;
  const av = VARIANT_INDEX.get(a);
  const bv = VARIANT_INDEX.get(b);
  return !!av && !!bv && av.canon === bv.canon;
}

/**
 * The single other spelling of `term`, or `[]` when `term` is not a known
 * variant. Used by the cheap pre-filter so a field holding the other spelling
 * of the query (`colour` for `color`) is not discarded before the scorer runs.
 */
export function spellingVariants(term: string): string[] {
  const out = new Set<string>();
  for (const v of spellingNeedles(term)) if (v !== term) out.add(v);
  const reg = VARIANT_INDEX.get(term);
  if (reg && reg.counterpart !== term) out.add(reg.counterpart);
  return [...out];
}

/* --------------------------------------------------------------------------
 * LEADING-STEM folding for PREFIX / INTERIOR matches.
 *
 * Whole words fold through {@link VARIANT_INDEX}. A term also matches a field
 * word by PREFIX, though, and that comparison used to be spelling-blind:
 * `colour` prefixed `colours`/`coloured`/`colourful`, but `color` did not — so
 * the two spellings returned different sets. The fix is to rotate the LEADING
 * stem between its American and British spellings and test both needles, so
 * `color` matches `colourful` exactly as `colour` matches `colorful`.
 *
 * A stem is registered in two forms, with and without its final `e`, because
 * English drops it before a vowel-initial suffix (`analyse`+`ing` →
 * `analysing`). An e-stripped form is only allowed before a vowel, so the noun
 * `emphasis` is NOT read as a form of `emphasise`.
 * ------------------------------------------------------------------------ */

interface StemSegment {
  /** The American spelling of this leading segment. */
  us: string;
  /** The British spelling of this leading segment. */
  uk: string;
  /** True for the e-dropped variant (`analys` from `analyse`). */
  stripped: boolean;
}

/** Longest-first index of every stem segment → its two spellings. */
const PREFIX_SEGMENTS = new Map<string, StemSegment>();

for (const [us, uk] of Object.entries(STEM_PAIRS)) {
  const usForms = [us, us.replace(/e$/, '')];
  const ukForms = [uk, uk.replace(/e$/, '')];
  for (let i = 0; i < 2; i++) {
    const stripped = i === 1;
    if (!PREFIX_SEGMENTS.has(usForms[i])) {
      PREFIX_SEGMENTS.set(usForms[i], { us: usForms[i], uk: ukForms[i], stripped });
    }
    if (!PREFIX_SEGMENTS.has(ukForms[i])) {
      PREFIX_SEGMENTS.set(ukForms[i], { us: usForms[i], uk: ukForms[i], stripped });
    }
  }
}

const MAX_SEGMENT = Math.max(
  ...Array.from(PREFIX_SEGMENTS.keys(), (s) => s.length)
);

/**
 * E-dropped stems that are themselves real words and must NOT be folded:
 * `emphasis` is a noun, not a form of `emphasise`. Only the BARE form is
 * exempt — `emphasising` is a verb form and does fold.
 */
const STRIPPED_EXCEPTIONS = new Set(['emphasis']);

/** Replace the longest leading stem segment with the requested spelling. */
function replaceLeadingStem(word: string, side: 'us' | 'uk'): string {
  const max = Math.min(word.length, MAX_SEGMENT);
  for (let len = max; len > 0; len--) {
    const seg = word.slice(0, len);
    const hit = PREFIX_SEGMENTS.get(seg);
    if (!hit) continue;
    const rest = word.slice(len);
    if (hit.stripped) {
      // The bare e-dropped stem is a needle too, so a partially typed
      // `polariz` matches `polarised` exactly as `polaris` matches `polarized`.
      if (rest === '' && STRIPPED_EXCEPTIONS.has(seg)) continue;
      // Before a suffix, the e is only dropped before a vowel (`analysing`),
      // never before a consonant (`analyzs` is not a word).
      if (rest !== '' && !/^[aeiou]/.test(rest)) continue;
    }
    return hit[side] + rest;
  }
  return word;
}

/** `colourful` → `colorful`, `analysing` → `analyzing`; unrelated words are unchanged. */
export function canonicalStemPrefix(word: string): string {
  return replaceLeadingStem(word, 'us');
}

/** `colorful` → `colourful`, `analyzing` → `analysing`; unrelated words are unchanged. */
export function britishStemPrefix(word: string): string {
  return replaceLeadingStem(word, 'uk');
}

/** Cached: needles are computed once per query term and reused for every entry. */
const NEEDLE_CACHE = new Map<string, string[]>();

/**
 * The spellings a QUERY TERM may match a field by PREFIX: the term itself plus
 * the American and British rotations of its leading stem. Matching a field word
 * that starts with ANY needle is what makes `color` and `colour` return the
 * same set. The cache keeps this off the per-entry hot path.
 */
export function spellingNeedles(term: string): string[] {
  const cached = NEEDLE_CACHE.get(term);
  if (cached) return cached;
  const us = canonicalStemPrefix(term);
  const uk = britishStemPrefix(term);
  const out = [term];
  if (us !== term) out.push(us);
  if (uk !== term) out.push(uk);
  if (NEEDLE_CACHE.size > 2000) NEEDLE_CACHE.clear();
  NEEDLE_CACHE.set(term, out);
  return out;
}
