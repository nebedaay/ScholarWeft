// Normalized author-name matching used only for resolving creator links and
// variants. Deliberately conservative about preserving name ORDER: `Ali,
// Muhammad` and `Muhammad Ali` remain distinct. It is intentionally broad
// about punctuation, spacing, diacritics, case and ʿayn/hamza marks, because
// those rarely distinguish two different authors.

const AYN_HAMZA = /[\u02BF\u02BE\u02BB\u02BC\u2018\u2019\u201B\u0060\u00B4\u02B9\u02BA]/g;

/** A comparison key: NFKD, no combining marks, no punctuation/spaces, lower. */
export function normalizeAuthorName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(AYN_HAMZA, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
