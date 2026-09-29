/**
 * Template-staleness timeline.
 *
 * A note records WHEN it was last rendered (`updated`); a global log records the
 * template hash IN EFFECT over each time range (`{ hash, at }`). The hash a note
 * was rendered with is RECONSTRUCTED as `hashAt(updated)`, so staleness is
 * decided without storing a per-note hash — and a template that changes and later
 * REVERTS does not over-flag (the ranges, not a single cut, decide).
 *
 * Pure, so the range logic (and the pruning off-by-one) is a test.
 */

export interface TemplateTimelineEntry {
  /** Content-hash of the applicable template. */
  hash: string;
  /** When this hash became effective (epoch ms). */
  at: number;
}

/** The persisted log: entries ordered by `at`, oldest first. */
export interface TemplateTimeline {
  entries: TemplateTimelineEntry[];
}

export function emptyTimeline(hash: string, at: number): TemplateTimeline {
  return { entries: hash ? [{ hash, at }] : [] };
}

/**
 * Append `hash` at `at` when it differs from the current one. An unchanged hash
 * appends NOTHING (so a spurious mtime bump cannot split a range). Returns the
 * timeline and whether it changed.
 */
export function recordTemplateHash(
  timeline: TemplateTimeline,
  hash: string,
  at: number
): { timeline: TemplateTimeline; changed: boolean } {
  if (!hash) return { timeline, changed: false };
  const entries = timeline?.entries ?? [];
  const last = entries[entries.length - 1];
  if (last && last.hash === hash) return { timeline, changed: false };
  return { timeline: { entries: [...entries, { hash, at }] }, changed: true };
}

/** The current hash (the last entry), or ''. */
export function currentHash(timeline: TemplateTimeline): string {
  const entries = timeline?.entries ?? [];
  return entries[entries.length - 1]?.hash ?? '';
}

/**
 * The hash in effect at time `t` — the latest entry with `at <= t`. Returns ''
 * when `t` precedes every entry.
 */
export function hashAt(timeline: TemplateTimeline, t: number): string {
  const entries = timeline?.entries ?? [];
  let found = '';
  for (const e of entries) {
    if (e.at <= t) found = e.hash;
    else break;
  }
  return found;
}

/**
 * Is a note rendered at `updatedMs` stale against the current template?
 *
 * - no `updated` → stale (a note we cannot place; safe one-time re-render);
 * - `updated` before the oldest entry → stale (same reason);
 * - otherwise stale when the hash then differs from the hash now.
 */
export function isNoteStale(
  timeline: TemplateTimeline,
  updatedMs: number | null | undefined
): boolean {
  const now = currentHash(timeline);
  if (!now) return false; // no template tracked yet — nothing to compare
  if (updatedMs == null || !Number.isFinite(updatedMs)) return true;
  const then = hashAt(timeline, updatedMs);
  if (!then) return true;
  return then !== now;
}

/**
 * Prune entries that can never be the "latest at or before T" for any surviving
 * note: those whose interval ENDS at or before the earliest `updated`. The FLOOR
 * (the most recent entry at or before `minUpdated`) is ALWAYS kept — a note
 * updated exactly at the earliest stamp resolves to it.
 *
 * Pruning by `at < minUpdated` alone would delete that floor and falsely flag the
 * note; this is why the rule is stated as "interval ends ≤ minUpdated".
 */
export function pruneTimeline(
  timeline: TemplateTimeline,
  minUpdatedMs: number | null
): TemplateTimeline {
  const entries = [...(timeline?.entries ?? [])].sort((a, b) => a.at - b.at);
  if (entries.length <= 1 || minUpdatedMs == null) return { entries };

  // The floor: the last entry whose `at <= minUpdatedMs`. Everything strictly
  // before it can be dropped, because no surviving note resolves into those
  // ranges.
  let floorIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].at <= minUpdatedMs) floorIdx = i;
    else break;
  }
  if (floorIdx <= 0) return { entries };
  return { entries: entries.slice(floorIdx) };
}
