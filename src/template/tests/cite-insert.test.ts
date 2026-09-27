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
  it('closes a WIKILINK with ]], not ]', () => {
    // The reported bug: [[@del + ⌘↵ produced [[@key], a broken wikilink.
    expect(computeInsertion('smith1992', ctx('[['), { wrap: true }).text).toBe(
      'smith1992]]'
    );
    expect(computeInsertion('smith1992', ctx('[[del'), { wrap: true }).text).toBe(
      'smith1992]]'
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
