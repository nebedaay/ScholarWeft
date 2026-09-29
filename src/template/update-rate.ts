/**
 * Estimating how long a bulk note update will take.
 *
 * The estimate is LEARNED, not hardcoded: the first pass measures the real rate
 * (notes ÷ elapsed minutes) and later estimates use it. Two things this guards
 * against:
 *
 *   - The rate must never fall to zero or a nonsense value, which would make the
 *     estimate infinite or absurd; it is clamped to a sane band.
 *   - A SINGLE pass is a noisy sample (a pass that mostly hit the children cache
 *     runs far faster than one that had to fetch). Successive samples are folded
 *     in with an exponential moving average, so the estimate settles on a
 *     typical rate instead of jumping to whatever the last pass happened to be.
 */

/** Until a pass has been measured, assume this many notes per minute. Cached
 *  re-renders (no Zotero round trips) are fast, so the default is generous. */
export const DEFAULT_NOTES_PER_MINUTE = 900;

/** The rate is clamped to this band, so no sample can wreck an estimate. */
export const MIN_NOTES_PER_MINUTE = 30;
export const MAX_NOTES_PER_MINUTE = 20_000;

/** Weight given to a NEW sample when folding it into the running rate. */
const EMA_ALPHA = 0.4;

/** Fold a measured rate into the running average (exponential moving average). */
export function nextNotesPerMinute(
  current: number,
  sampled: number
): number {
  if (!Number.isFinite(sampled) || sampled <= 0) return current;
  const clamped = Math.min(
    MAX_NOTES_PER_MINUTE,
    Math.max(MIN_NOTES_PER_MINUTE, sampled)
  );
  return current * (1 - EMA_ALPHA) + clamped * EMA_ALPHA;
}

/**
 * Whole minutes for `count` notes at `notesPerMinute`. Never returns 0 — a short
 * job still reads as "about 1 minute" rather than "0 minutes".
 */
export function estimateMinutes(
  count: number,
  notesPerMinute: number = DEFAULT_NOTES_PER_MINUTE
): number {
  const rate = Math.max(
    MIN_NOTES_PER_MINUTE,
    Number.isFinite(notesPerMinute) && notesPerMinute > 0
      ? notesPerMinute
      : DEFAULT_NOTES_PER_MINUTE
  );
  return Math.max(1, Math.ceil(count / rate));
}
