import {
  currentHash,
  emptyTimeline,
  hashAt,
  isNoteStale,
  pruneTimeline,
  recordTemplateHash,
  type TemplateTimeline,
} from '../template-history';

const T = (ms: number) => ms;

describe('recordTemplateHash()', () => {
  it('appends only when the hash actually changes', () => {
    let tl = emptyTimeline('H0', T(0));
    expect(recordTemplateHash(tl, 'H0', T(1000)).changed).toBe(false);
    const r = recordTemplateHash(tl, 'H1', T(2000));
    expect(r.changed).toBe(true);
    expect(r.timeline.entries.map((e) => e.hash)).toEqual(['H0', 'H1']);
    tl = r.timeline;
    expect(currentHash(tl)).toBe('H1');
  });

  it('ignores an empty hash', () => {
    expect(recordTemplateHash(emptyTimeline('H0', 0), '', 5).changed).toBe(false);
  });
});

describe('hashAt()', () => {
  // H0 until 2000, H1 2000-4000, H0 again after 4000 (a revert).
  const tl: TemplateTimeline = {
    entries: [
      { hash: 'H0', at: 0 },
      { hash: 'H1', at: 2000 },
      { hash: 'H0', at: 4000 },
    ],
  };

  it('returns the hash in effect, not just the latest', () => {
    expect(hashAt(tl, 100)).toBe('H0');
    expect(hashAt(tl, 2500)).toBe('H1');
    expect(hashAt(tl, 9000)).toBe('H0');
  });

  it('returns empty before the first entry', () => {
    expect(hashAt({ entries: [{ hash: 'H', at: 500 }] }, 100)).toBe('');
  });
});

describe('isNoteStale() — the revert case', () => {
  const tl: TemplateTimeline = {
    entries: [
      { hash: 'H0', at: 0 },
      { hash: 'H1', at: 2000 },
      { hash: 'H0', at: 4000 },
    ],
  };

  it('does NOT flag a note rendered before a change that was reverted', () => {
    // Rendered at 1000 with H0; current is H0 again → current.
    expect(isNoteStale(tl, 1000)).toBe(false);
  });

  it('flags a note rendered while the intervening template was in effect', () => {
    expect(isNoteStale(tl, 2500)).toBe(true);
  });

  it('treats a missing or pre-history updated as stale', () => {
    expect(isNoteStale(tl, null)).toBe(true);
    expect(isNoteStale(tl, undefined)).toBe(true);
    expect(isNoteStale({ entries: [{ hash: 'H', at: 500 }] }, 100)).toBe(true);
  });

  it('is never stale with no template tracked', () => {
    expect(isNoteStale({ entries: [] }, 1000)).toBe(false);
  });
});

describe('pruneTimeline()', () => {
  const tl: TemplateTimeline = {
    entries: [
      { hash: 'A', at: 100 },
      { hash: 'B', at: 200 },
      { hash: 'C', at: 300 },
    ],
  };

  it('keeps the FLOOR for the earliest updated (exact match)', () => {
    // Earliest note updated at 200 → must keep the entry at 200 (its interval is
    // [200,300)); dropping it would falsely flag that note.
    const pruned = pruneTimeline(tl, 200);
    expect(pruned.entries.map((e) => e.at)).toEqual([200, 300]);
  });

  it('drops entries strictly before the floor', () => {
    const pruned = pruneTimeline(tl, 350);
    expect(pruned.entries.map((e) => e.at)).toEqual([300]);
  });

  it('keeps everything when the earliest updated precedes all entries', () => {
    expect(pruneTimeline(tl, 50).entries).toHaveLength(3);
  });

  it('is a no-op with no known updated time', () => {
    expect(pruneTimeline(tl, null).entries).toHaveLength(3);
  });
});
