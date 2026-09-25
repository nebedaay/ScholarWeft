// The helper functions ZotLit's Eta engine exposes to templates.
//
// Adapted from ZotLit (AGPL-3.0) — `packages/templates/src/{basename,embed,
// filename-suffix,coerce}.ts` — so a template written for ZotLit renders the
// same here: `basename`, `embed`, `suffix` (filename collision suffix) and the
// `coerceOutput` filter. See NOTICE.md.
//
// These are pure (no Obsidian, no I/O).

/** A lazy link helper: renders to Markdown, with optional alias/subpath. */
export type TemplateLinkHelper = (
  alias?: string,
  subpath?: string
) => string | null | undefined;

/**
 * Final path segment with a trailing extension removed.
 * `basename('a/b/c.md')` → `c`; `basename('a/b/', '')` → `b`.
 */
export function basename(path: string, ext = '.md'): string {
  if (ext !== '' && isOnlySlashes(path)) return path === ext ? '' : path;

  const name = finalSegment(path);
  if (ext === '' || name === '') return name;
  if (path === ext) return '';
  if (name === ext) return name;
  return name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

function finalSegment(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
  if (end === 0) return '';
  const start = path.lastIndexOf('/', end - 1) + 1;
  return path.slice(start, end);
}

function isOnlySlashes(path: string): boolean {
  if (path.length === 0) return false;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) !== 47) return false;
  }
  return true;
}

/**
 * Render a link helper's output as a Markdown embed (`!` prefix). Returns `''`
 * when the link is absent or renders empty, so a missing excerpt image
 * collapses instead of leaving a bare `!`.
 */
export function embed(
  link: TemplateLinkHelper | null | undefined,
  alias?: string,
  subpath?: string
): string {
  if (!link) return '';
  const rendered = link(alias, subpath);
  return rendered ? `!${rendered}` : '';
}

/** Upper bound on a collision suffix's random length. */
export const MAX_SUFFIX_LENGTH = 64;

/** Instructions a suffix marker carries to its fill callback. */
export interface SuffixSpec {
  length: number;
  prepend: string;
  append: string;
}

const SUFFIX_MARKER_RE = /%zt-suffix:(\d+):([^:%]*):([^:%]*)%/g;

/**
 * A sentinel the WRITER replaces with `prepend + <random> + append` when the
 * rendered filename already exists, or `''` when it is free — so the suffix
 * appears only on a real collision. The requested length and affixes ride along
 * in the marker.
 */
export function filenameSuffix(length = 6, prepend = '_', append = ''): string {
  if (!Number.isInteger(length) || length < 1 || length > MAX_SUFFIX_LENGTH) {
    throw new Error(
      `suffix() length must be an integer in 1..${MAX_SUFFIX_LENGTH}, got ${length}`
    );
  }
  for (const [name, value] of [
    ['prepend', prepend],
    ['append', append],
  ] as const) {
    if (/[:%]/.test(value)) {
      throw new Error(
        `suffix() ${name} must not contain ':' or '%', got ${JSON.stringify(value)}`
      );
    }
  }
  return `%zt-suffix:${length}:${prepend}:${append}%`;
}

/** Does a rendered filename still carry a suffix marker? */
export function hasSuffixMarker(rendered: string): boolean {
  SUFFIX_MARKER_RE.lastIndex = 0;
  return SUFFIX_MARKER_RE.test(rendered);
}

/** Replace every suffix marker with `fill(spec)` (`() => ''` drops them). */
export function replaceSuffixMarkers(
  rendered: string,
  fill: (spec: SuffixSpec) => string
): string {
  SUFFIX_MARKER_RE.lastIndex = 0;
  let out = '';
  let last = 0;
  for (let m = SUFFIX_MARKER_RE.exec(rendered); m; m = SUFFIX_MARKER_RE.exec(rendered)) {
    out +=
      rendered.slice(last, m.index) +
      fill({ length: Number(m[1]), prepend: m[2], append: m[3] });
    last = m.index + m[0].length;
  }
  return out + rendered.slice(last);
}

/**
 * Coerce a rendered value to text for the Eta `autoFilter`/output hook: `''` for
 * null/undefined, ISO for a `Date`, the local date for a `Temporal.Instant`, and
 * `String(value)` otherwise (ItemDate/creators carry their own `toString`).
 */
export function coerceOutput(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const T = (globalThis as { Temporal?: any }).Temporal;
  if (T && value instanceof T.Instant) {
    return (value as any)
      .toZonedDateTimeISO(T.Now.timeZoneId())
      .toPlainDate()
      .toString();
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}
