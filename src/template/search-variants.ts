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
  // -or / -our (more)
  clamor: 'clamour', glamor: 'glamour', fervor: 'fervour',
  rancor: 'rancour', succor: 'succour', savor: 'savour', arbor: 'arbour',
  // -er / -re
  center: 'centre', theater: 'theatre', meter: 'metre', liter: 'litre',
  fiber: 'fibre', somber: 'sombre', specter: 'spectre', caliber: 'calibre',
  maneuver: 'manoeuvre', luster: 'lustre', reconnoiter: 'reconnoitre',
  saber: 'sabre', miter: 'mitre', sepulcher: 'sepulchre', ocher: 'ochre',
  meager: 'meagre',
  // -se / -ce
  defense: 'defence', offense: 'offence', pretense: 'pretence',
  license: 'licence', practice: 'practise',
  // -og / -ogue
  catalog: 'catalogue', dialog: 'dialogue', monolog: 'monologue',
  analog: 'analogue', program: 'programme',
  // Doubled / single L (the British stem carries the doubled `l`)
  travel: 'travell', cancel: 'cancell', model: 'modell', label: 'labell',
  fuel: 'fuell', level: 'levell', tunnel: 'tunnell', dial: 'diall',
  marvel: 'marvell', counsel: 'counsell', wool: 'wooll', signal: 'signall',
  total: 'totall', equal: 'equall', skillful: 'skilful',
  // Other well-known pairs
  gray: 'grey', mold: 'mould', smolder: 'smoulder', plow: 'plough',
  molt: 'moult', skeptic: 'sceptic', sulfur: 'sulphur',
  jewelry: 'jewellery', aluminum: 'aluminium',
  // -ae / -e, -oe / -e where BOTH spellings are real words
  medieval: 'mediaeval', encyclopedia: 'encyclopaedia',
  aesthetic: 'esthetic', estrogen: 'oestrogen', edema: 'oedema',
  esophagus: 'oesophagus', diarrhea: 'diarrhoea', apnea: 'apnoea',
  anemia: 'anaemia', anesthesia: 'anaesthesia', hemorrhage: 'haemorrhage',
  archaeology: 'archeology', pediatric: 'paediatric',
  orthopedics: 'orthopaedics', paleontology: 'palaeontology',
  anesthetic: 'anaesthetic', gynecology: 'gynaecology', leukemia: 'leukaemia',
  fetus: 'foetus', homeopathy: 'homoeopathy', hemoglobin: 'haemoglobin',
  etiology: 'aetiology', feces: 'faeces', cesarean: 'caesarean',
  hematology: 'haematology', ischemia: 'ischaemia', eon: 'aeon',
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
      // Before a suffix, the e is only dropped before a vowel (`analysing`),
      // never before a consonant (`analyzs` is not a word).
      if (rest !== '' && !/^[aeiou]/.test(rest)) continue;
    }
    return hit[side] + rest;
  }
  return word;
}

/* --------------------------------------------------------------------------
 * AUTOMATIC -ize/-ise and -yze/-yse folding.
 *
 * Unlike `ae`→`e` (which cannot tell `aesthetic` from `Caesar`), the American
 * `-ize` / British `-ise` ending is a systematic morphological split: every
 * verb in the family has both, and the rest of the word is identical. So this
 * one does NOT need a curated list — `synthesize`/`synthesise`,
 * `customize`/`customise`, `utilize`/`utilise` and every future or rare member
 * fold automatically, including `-ization`/`-isation` nouns.
 * ------------------------------------------------------------------------ */

/** `...ize`/`...yze` (+ an inflection) → the same word spelled `...ise`/`...yse`. */
const IZE_FORM =
  /^(.*?)([iy])([sz])(ations|ation|ably|able|ings|ing|ers|er|es|ed|e)?$/;

/**
 * Words where both spellings are real but DIFFERENT words, so they must not be
 * folded: `prize`/`prise` and `seize`/`seise`.
 */
const IZE_BLOCKED = new Set(['prize', 'prise', 'seize', 'seise']);

/** The counterpart spelling of an -ize/-ise (or -yze/-yse) form. */
function izeiseNeedles(term: string): string[] {
  const m = IZE_FORM.exec(term);
  if (!m) return [];
  const [, prefix, vowel, sibilant, suffix = ''] = m;
  if (term.length < 4) return [];
  if (IZE_BLOCKED.has(prefix + vowel + sibilant + 'e')) return [];
  const other = sibilant === 'z' ? 's' : 'z';
  return [prefix + vowel + other + suffix];
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
  const out = new Set<string>([term]);
  const us = canonicalStemPrefix(term);
  const uk = britishStemPrefix(term);
  if (us !== term) out.add(us);
  if (uk !== term) out.add(uk);
  // The automatic -ize/-ise rule is for words the curated stem list does NOT
  // cover. When the leading stem already folds (`colour…` → `color…`), the
  // stem fold supplies the counterpart (and combining both would invent a
  // hybrid like `coloursation`).
  if (us === term && uk === term) {
    for (const n of izeiseNeedles(term)) out.add(n);
  }
  const needles = [...out];
  if (NEEDLE_CACHE.size > 2000) NEEDLE_CACHE.clear();
  NEEDLE_CACHE.set(term, needles);
  return needles;
}

/** Cached: permissive substring forms for the pre-filter (see spellingPrefixes). */
const PREFIX_CACHE = new Map<string, string[]>();

/**
 * Permissive forms for the cheap SUBSTRING pre-filter. The scorer matches an
 * e-dropped inflection by stem (`analyse` + `ing` → `analysing`), whose stem is
 * a substring of the field even though the full spelling is not — so include
 * the e-dropped stem of every needle. This only has to be a SUPERSET of real
 * matches; false positives are resolved by the scorer.
 */
export function spellingPrefixes(term: string): string[] {
  const cached = PREFIX_CACHE.get(term);
  if (cached) return cached;
  const out = new Set<string>();
  for (const n of spellingNeedles(term)) {
    out.add(n);
    if (n.endsWith('e')) out.add(n.slice(0, -1));
  }
  const forms = [...out];
  if (PREFIX_CACHE.size > 2000) PREFIX_CACHE.clear();
  PREFIX_CACHE.set(term, forms);
  return forms;
}
