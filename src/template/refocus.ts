/**
 * When to refresh the Zotero library after Obsidian regains focus.
 *
 * Zotero can only have changed while the user was AWAY, so the decision hinges
 * on an observed absence — not merely on a focus event arriving. Obsidian's
 * window contains its own tab and pane system, and internal switches keep the
 * document focused, so those must not count as "away" (and must not trigger a
 * whole-library fetch).
 *
 * Pure, so the rules are testable instead of living in the event handler.
 */

export interface RefocusDecisionInput {
  /** `document.hasFocus()` at the moment of the event. */
  hasFocus: boolean;
  /** Timestamp the window was last seen unfocused/hidden, or 0 for none. */
  awayAt: number;
  /** Timestamp of the last refocus-triggered refresh, or 0 for never. */
  lastRefreshAt: number;
  /** "Now", injected for determinism. */
  now: number;
}

/** Wait at least this long between refocus-triggered refreshes. */
export const REFOCUS_MIN_INTERVAL_MS = 60_000;

/** An absence shorter than this couldn't have produced a meaningful edit. */
export const REFOCUS_MIN_ABSENCE_MS = 5_000;

/**
 * Should this refocus pull the library?
 *
 * False when the window never really lost focus (an internal pane/tab switch),
 * when we were only away for a blink (a notification stealing focus), or when
 * we refreshed very recently.
 */
export function shouldRefreshOnRefocus(input: RefocusDecisionInput): boolean {
  const { hasFocus, awayAt, lastRefreshAt, now } = input;
  if (!hasFocus) return false;
  // No recorded absence → the window was never away, so nothing can have
  // changed in Zotero. This is what excludes pane/tab switches.
  if (!awayAt) return false;
  if (now - awayAt < REFOCUS_MIN_ABSENCE_MS) return false;
  if (lastRefreshAt && now - lastRefreshAt < REFOCUS_MIN_INTERVAL_MS) return false;
  return true;
}
