import {
  REFOCUS_MIN_ABSENCE_MS,
  REFOCUS_MIN_INTERVAL_MS,
  shouldRefreshOnRefocus,
} from '../refocus';

const T = 1_000_000_000_000;

describe('shouldRefreshOnRefocus()', () => {
  it('refreshes after a real absence', () => {
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        // Away well past the blink threshold, and nothing recent.
        awayAt: T - 30_000,
        lastRefreshAt: 0,
        now: T,
      })
    ).toBe(true);
  });

  it('does NOT refresh on an internal pane or tab switch', () => {
    // The whole point: Obsidian's own tab/pane switches fire focus events but
    // the window never lost focus, so no absence is recorded and nothing can
    // have changed in Zotero.
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        awayAt: 0, // never actually away
        lastRefreshAt: 0,
        now: T,
      })
    ).toBe(false);
  });

  it('ignores a blink away (a notification stealing focus)', () => {
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        awayAt: T - (REFOCUS_MIN_ABSENCE_MS - 1),
        lastRefreshAt: 0,
        now: T,
      })
    ).toBe(false);
  });

  it('refreshes once the absence is long enough', () => {
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        awayAt: T - REFOCUS_MIN_ABSENCE_MS,
        lastRefreshAt: 0,
        now: T,
      })
    ).toBe(true);
  });

  it('throttles rapid Obsidian↔Zotero bouncing', () => {
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        awayAt: T - 30_000,
        lastRefreshAt: T - (REFOCUS_MIN_INTERVAL_MS - 1),
        now: T,
      })
    ).toBe(false);
    // ...but allows it again once the interval has passed.
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        awayAt: T - 30_000,
        lastRefreshAt: T - REFOCUS_MIN_INTERVAL_MS,
        now: T,
      })
    ).toBe(true);
  });

  it('does nothing when the window is not focused', () => {
    expect(
      shouldRefreshOnRefocus({
        hasFocus: false,
        awayAt: T - 30_000,
        lastRefreshAt: 0,
        now: T,
      })
    ).toBe(false);
  });

  it('treats a first-ever refocus (no prior refresh) as allowed', () => {
    expect(
      shouldRefreshOnRefocus({
        hasFocus: true,
        awayAt: T - 60_000,
        lastRefreshAt: 0,
        now: T,
      })
    ).toBe(true);
  });
});
