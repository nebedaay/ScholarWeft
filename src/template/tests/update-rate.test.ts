import {
  DEFAULT_NOTES_PER_MINUTE,
  estimateMinutes,
  nextNotesPerMinute,
  MAX_NOTES_PER_MINUTE,
  MIN_NOTES_PER_MINUTE,
} from '../update-rate';

describe('estimateMinutes()', () => {
  it('uses the default rate when none is supplied', () => {
    expect(estimateMinutes(900)).toBe(1);
    expect(estimateMinutes(1800)).toBe(2);
    expect(estimateMinutes(450)).toBe(1);
  });

  it('never returns 0 — a short job still reads as a minute', () => {
    expect(estimateMinutes(0)).toBe(1);
    expect(estimateMinutes(5)).toBe(1);
  });

  it('scales with the learned rate, so a smaller library waits less', () => {
    // A slow machine / cold cache: 100 notes/min.
    expect(estimateMinutes(1000, 100)).toBe(10);
    // The same count on a cached pass.
    expect(estimateMinutes(1000, DEFAULT_NOTES_PER_MINUTE)).toBe(2);
  });

  it('ignores a nonsense rate rather than producing Infinity', () => {
    expect(estimateMinutes(1000, 0)).toBe(estimateMinutes(1000));
    expect(estimateMinutes(1000, -5)).toBe(estimateMinutes(1000));
    expect(estimateMinutes(1000, NaN)).toBe(estimateMinutes(1000));
    // And clamps an implausibly large rate to the floor.
    expect(Number.isFinite(estimateMinutes(1e9, 1e9))).toBe(true);
  });
});

describe('nextNotesPerMinute()', () => {
  it('moves toward a new sample without jumping straight to it', () => {
    const next = nextNotesPerMinute(900, 300);
    expect(next).toBeGreaterThan(300);
    expect(next).toBeLessThan(900);
  });

  it('ignores non-positive / non-finite samples', () => {
    expect(nextNotesPerMinute(900, 0)).toBe(900);
    expect(nextNotesPerMinute(900, -10)).toBe(900);
    expect(nextNotesPerMinute(900, NaN)).toBe(900);
  });

  it('clamps a wild sample to the sane band', () => {
    expect(nextNotesPerMinute(900, 1)).toBeGreaterThanOrEqual(
      MIN_NOTES_PER_MINUTE * 0.5
    );
    const huge = nextNotesPerMinute(900, 1e9);
    expect(huge).toBeLessThanOrEqual(MAX_NOTES_PER_MINUTE);
  });
});
