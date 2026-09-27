import {
  afterOpenBracketIn,
  computeInsertion,
  insertionHint,
  insideUnclosedWikilink,
} from '../cite-insert';

/**
 * `beforeStart` is the line UP TO the trigger start — which is the '@', so it
 * never contains the query text. These fixtures reflect that: `[@del` arrives
 * as `'['`, and `[[@del` as `'[['`.
 */
const ctx = (
  beforeStart: string,
  afterCursor = '',
  charBefore: string | undefined = beforeStart.slice(-1)
) => ({
  beforeStart,
  afterCursor,
  charBefore,
  afterOpenBracket: afterOpenBracketIn(beforeStart),
});

describe('insideUnclosedWikilink()', () => {
  it('detects `[[` with no closing `]]`', () => {
    expect(insideUnclosedWikilink('[[@del')).toBe(true);
    expect(insideUnclosedWikilink('[[del')).toBe(true);
    expect(insideUnclosedWikilink('see [[@x and [[@del')).toBe(true);
  });

  it('is false outside a wikilink', () => {
    expect(insideUnclosedWikilink('[@del')).toBe(false);
    expect(insideUnclosedWikilink('plain text @del')).toBe(false);
    expect(insideUnclosedWikilink('')).toBe(false);
  });

  it('is false once the wikilink is closed', () => {
    expect(insideUnclosedWikilink('[[@key]] then @del')).toBe(false);
  });
});

describe('computeInsertion() — plain Enter', () => {
  it('always inserts the bare citekey, whatever the context', () => {
    for (const c of [ctx('[['), ctx('['), ctx(''), ctx('text ')]) {
      expect(computeInsertion('smith1992', c, { wrap: false }).text).toBe(
        '@smith1992'
      );
    }
  });
});

describe('computeInsertion() — ⌘/Ctrl+Enter', () => {
  it('closes a WIKILINK with ]], keeping the @', () => {
    // The reported bug: [[@del + ⌘↵ produced [[smith1992]], a DEAD wikilink —
    // the '@' was dropped because only a closing suffix was returned while the
    // replaced span starts at the '@'.
    expect(computeInsertion('smith1992', ctx('[['), { wrap: true }).text).toBe(
      '@smith1992]]'
    );
  });

  it('closes an already-open single bracket', () => {
    expect(computeInsertion('smith1992', ctx('['), { wrap: true }).text).toBe(
      '@smith1992]'
    );
  });

  it('wraps a Pandoc citation fully from a bare @', () => {
    expect(computeInsertion('smith1992', ctx(''), { wrap: true }).text).toBe(
      '[@smith1992]'
    );
  });

  it('adds nothing inside an existing citation block', () => {
    expect(
      computeInsertion('smith1992', ctx('[@a; ', ']'), { wrap: true }).text
    ).toBe('@smith1992');
  });

  it('does NOT treat a closed wikilink as open', () => {
    // [[@done]] then a new @del is a fresh Pandoc-style insertion.
    expect(
      computeInsertion('smith1992', ctx('[[@done]] then '), { wrap: true }).text
    ).toBe('[@smith1992]');
  });
});

describe('insertionHint() matches what will actually be inserted', () => {
  const hintFor = (beforeStart: string) =>
    insertionHint({ beforeStart, afterOpenBracket: afterOpenBracketIn(beforeStart) });

  it('names ]] inside a wikilink', () => {
    expect(hintFor('[[..[')).toBe('close with ]]');
  });

  it('names ] inside an open single bracket', () => {
    expect(hintFor('[')).toBe('close with ]');
  });

  it('names a full wrap otherwise', () => {
    expect(hintFor('')).toBe('wrap with brackets');
    expect(hintFor('text ')).toBe('wrap with brackets');
    expect(hintFor('[[@a]] then ')).toBe('wrap with brackets');
  });

  it('agrees with computeInsertion for every context', () => {
    const cases = ['[[', '[', '', 'text ', '[[@a]] then '];
    for (const beforeStart of cases) {
      const hint = hintFor(beforeStart);
      const inserted = computeInsertion(
        'k',
        { beforeStart, afterCursor: '', charBefore: beforeStart.slice(-1), afterOpenBracket: afterOpenBracketIn(beforeStart) },
        { wrap: true }
      ).text;
      if (hint === 'close with ]]') expect(inserted.endsWith(']]')).toBe(true);
      else if (hint === 'close with ]') expect(inserted.endsWith(']') && !inserted.endsWith(']]')).toBe(true);
      else expect(inserted).toBe('[@k]');
    }
  });
});

describe('whole-line results (where the bug actually showed)', () => {
  /**
   * The popup's span always starts at the '@'. These tests rebuild the real
   * line so a wrong CONTRACT (returning only a suffix) is caught, not just a
   * wrong suffix.
   */
  function accept(line: string, atStart: number, citekey: string, wrap: boolean) {
    // Trigger: everything from the '@' to the cursor is replaced.
    const beforeStart = line.slice(0, atStart);
    const afterCursor = line.slice(atStart);
    const ctx = {
      beforeStart,
      afterCursor,
      charBefore: beforeStart.slice(-1),
      afterOpenBracket: afterOpenBracketIn(beforeStart),
    };
    return line.slice(0, atStart) + computeInsertion(citekey, ctx, { wrap }).text;
  }

  it('produces a valid wikilink: [[@citekey]]', () => {
    // '[[@del', '@' at index 2 → '[[@smith1992]]'
    expect(accept('[[@del', 2, 'smith1992', true)).toBe('[[@smith1992]]');
  });

  it('produces a valid Pandoc citation: [@citekey]', () => {
    // '@del', '@' at index 0 → '[@smith1992]'
    expect(accept('@del', 0, 'smith1992', true)).toBe('[@smith1992]');
  });

  it('completes an open single bracket: [@del → [@citekey]', () => {
    expect(accept('[@del', 1, 'smith1992', true)).toBe('[@smith1992]');
  });

  it('keeps the @ for plain Enter in a wikilink', () => {
    expect(accept('[[@del', 2, 'smith1992', false)).toBe('[[@smith1992');
  });

  it('never loses the @ in any context', () => {
    for (const [line, at] of [['[[@del', 2], ['@del', 0], ['[@del', 1], ['text @del', 5]] as const) {
      expect(accept(line, at, 'k', true)).toContain('@k');
    }
  });
});
