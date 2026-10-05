/**
 * Shared citation matching: given the citation groups parsed from a source
 * string and the rendered citations cached for a file, find the rendered one
 * that corresponds. Used by BOTH live preview (`editorExtension.ts`) and
 * reading mode (`markdownPostprocessor.ts`) so the two modes agree on what
 * counts as a match.
 *
 * Matching is deliberately tolerant: the primary test is exact segment-data
 * equality (the same `getCitationSegments` produced both sides, so this is the
 * normal path), but a reconstruction that differs by a trailing/zero-width
 * segment still matches by citation identity (citekeys + locator/label/prefix/
 * suffix). Without the fallback a formatting-equivalent citation silently fails
 * to render.
 */
import equal from 'fast-deep-equal';
import { RenderedCitation, Segment, getCitations } from './parser/parser';

export function onlyValType(segs: Segment[]) {
  return segs.map((s) => ({ type: s.type, val: s.val }));
}

function normWs(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function citeIdentity(c: {
  id: string;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
}) {
  return {
    id: c.id,
    locator: normWs(c.locator),
    label: normWs(c.label),
    prefix: normWs(c.prefix),
    suffix: normWs(c.suffix),
  };
}

function sameCiteIdentity(
  a: ReturnType<typeof citeIdentity>,
  b: ReturnType<typeof citeIdentity>
): boolean {
  if (a.id !== b.id) return false;
  const ok = (x: string, y: string) => !x || !y || x === y;
  return (
    ok(a.locator, b.locator) &&
    ok(a.label, b.label) &&
    ok(a.prefix, b.prefix) &&
    ok(a.suffix, b.suffix)
  );
}

/**
 * Find the cached rendered citation for a parsed segment group.
 *
 * 1. exact segment-data equality (the normal path);
 * 2. same ordered citekeys with non-conflicting locator/label/prefix/suffix;
 * 3. a UNIQUE cached entry with the same ordered citekeys (covers a
 *    reconstruction that dropped a whole segment).
 */
export function matchRendered(
  candidates: RenderedCitation[],
  segs: Segment[]
): RenderedCitation | undefined {
  if (!candidates?.length) return undefined;
  const want = onlyValType(segs);
  const exact = candidates.find((c) => equal(onlyValType(c.data), want));
  if (exact) return exact;

  const wanted = getCitations(segs).citations.map(citeIdentity);
  const byIdentity = candidates.find((c) => {
    const got = c.citations.map(citeIdentity);
    if (got.length !== wanted.length) return false;
    return got.every((g, i) => sameCiteIdentity(g, wanted[i]));
  });
  if (byIdentity) return byIdentity;

  const keys = wanted.map((c) => c.id).join('|');
  const sameKeys = candidates.filter(
    (c) => c.citations.map((x) => x.id).join('|') === keys
  );
  return sameKeys.length === 1 ? sameKeys[0] : undefined;
}
