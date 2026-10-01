/**
 * Orthographic-variant folding for the citation search.
 *
 * This is NOT fuzzy matching and never guesses: it folds a small, fixed set of
 * well-known spelling differences so `color` finds `colour`, `colonization`
 * finds `colonisation`, and `medieval` finds `mediaeval`. Both terms must be
 * KNOWN variant forms ({@link VARIANT_WORDS}) and must reduce to the same
 * canonical key before they are treated as equal — so the folding can never
 * turn a near-miss into a match.
 */

/** Suffix/infix rules that map a variant spelling to a canonical one. */
const RULES: Array<[RegExp, string]> = [
  [/([a-z])isation\b/g, '$1ization'],
  [/([a-z])ise\b/g, '$1ize'],
  [/([a-z])iser\b/g, '$1izer'],
  [/our\b/g, 'or'],
  [/ae/g, 'e'],
  [/oe/g, 'e'],
];

/** Words that have a common orthographic variant. Only these are folded. */
export const VARIANT_WORDS: ReadonlySet<string> = new Set([
  'color', 'colour', 'colors', 'colours', 'colored', 'coloured',
  'behavior', 'behaviour', 'behaviors', 'behaviours',
  'favor', 'favour', 'honor', 'honour', 'labor', 'labour',
  'neighbor', 'neighbour', 'rumor', 'rumour', 'humor', 'humour',
  'organize', 'organise', 'organized', 'organised', 'organizing', 'organising',
  'organization', 'organisation', 'organizations', 'organisations',
  'colonize', 'colonise', 'colonized', 'colonised', 'colonization', 'colonisation',
  'colonizing', 'colonising',
  'recognize', 'recognise', 'recognized', 'recognised', 'recognition',
  'analyze', 'analyse', 'analyzed', 'analysed', 'analyzing', 'analysing',
  'civilize', 'civilise', 'civilized', 'civilised', 'civilization', 'civilisation',
  'realize', 'realise', 'realized', 'realised',
  'modernize', 'modernise', 'modernization', 'modernisation',
  'globalize', 'globalise', 'globalization', 'globalisation',
  'secularize', 'secularise', 'secularization', 'secularisation',
  'standardize', 'standardise', 'standardization', 'standardisation',
  'characterize', 'characterise', 'characterization', 'characterisation',
  'categorize', 'categorise', 'categorization', 'categorisation',
  'theorize', 'theorise', 'theorized', 'theorised',
  'legitimize', 'legitimise', 'legitimized', 'legitimised',
  'emphasize', 'emphasise', 'emphasized', 'emphasised',
  'criticize', 'criticise', 'criticized', 'criticised',
  'medieval', 'mediaeval',
  'encyclopedia', 'encyclopaedia',
  'esthetic', 'aesthetic', 'esthetics', 'aesthetics',
]);

/** The canonical key a variant word reduces to. */
export function canonicalForm(word: string): string {
  let s = word;
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}

/** Are these two words a known orthographic-variant pair? */
export function isVariantPair(a: string, b: string): boolean {
  if (a === b) return true;
  if (!VARIANT_WORDS.has(a) || !VARIANT_WORDS.has(b)) return false;
  return canonicalForm(a) === canonicalForm(b);
}

/** Fold a query term to its canonical form when it is a known variant word. */
export function foldQueryTerm(term: string): string {
  return VARIANT_WORDS.has(term) ? canonicalForm(term) : term;
}
