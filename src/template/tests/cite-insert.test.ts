import {
  afterOpenBracketIn,
  computeInsertion,
  insertionHint,
  insertionKind,
  insideUnclosedWikilink,
  type InsertOptions,
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

/** Linked citations on (the default setting). */
const LINKED: InsertOptions = { linked: true };
/** Linked citations off ("Process linked citations" unchecked). */
const PANDOC: InsertOptions = { linked: false };
/** ⌘/Ctrl+Enter while linked citations are on. */
const FORCE: InsertOptions = { linked: true, forcePandoc: true };

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

  it('is false when the closer is after the cursor', () => {
    // Editing `[[@del]]`: the `]]` survives, so none may be added.
    expect(insideUnclosedWikilink('[[', ']]')).toBe(false);
  });
});

describe('computeInsertion() — bare @', () => {
  it('inserts a linked citation when linked citations are on', () => {
    for (const c of [ctx(''), ctx('text '), ctx('[[@done]] then ')]) {
      expect(computeInsertion('smith1992', c, LINKED).text).toBe(
        '[[@smith1992]]'
      );
    }
  });

  it('inserts a Pandoc citation when the setting is off', () => {
    expect(computeInsertion('smith1992', ctx(''), PANDOC).text).toBe(
      '[@smith1992]'
    );
  });

  it('⌘/Ctrl+Enter forces Pandoc from a bare @', () => {
    expect(computeInsertion('smith1992', ctx(''), FORCE).text).toBe(
      '[@smith1992]'
    );
  });
});

describe('computeInsertion() — bracket and wikilink contexts', () => {
  it('closes an already-open single bracket', () => {
    expect(computeInsertion('smith1992', ctx('['), LINKED).text).toBe(
      '@smith1992]'
    );
  });

  it('does NOT double-close when the ] is already after the cursor', () => {
    expect(computeInsertion('smith1992', ctx('[', ']'), LINKED).text).toBe(
      '@smith1992'
    );
  });

  it('appends a member inside a citation block, with or without a closer', () => {
    expect(computeInsertion('smith1992', ctx('[@a; '), LINKED).text).toBe(
      '@smith1992'
    );
    expect(computeInsertion('smith1992', ctx('[@a; ', ']'), LINKED).text).toBe(
      '@smith1992'
    );
  });

  it('appends inside a prefix citation: [see @…', () => {
    expect(computeInsertion('smith1992', ctx('[see '), LINKED).text).toBe(
      '@smith1992'
    );
  });

  it('completes an unclosed wikilink', () => {
    expect(computeInsertion('smith1992', ctx('[['), LINKED).text).toBe(
      '@smith1992]]'
    );
  });

  it('does NOT double-close a wikilink when ]] is already there', () => {
    expect(computeInsertion('smith1992', ctx('[[', ']]'), LINKED).text).toBe(
      '@smith1992'
    );
  });

  it('⌘/Ctrl+Enter does not change an unambiguous bracket context', () => {
    expect(computeInsertion('smith1992', ctx('['), FORCE).text).toBe(
      '@smith1992]'
    );
    expect(computeInsertion('smith1992', ctx('[['), FORCE).text).toBe(
      '@smith1992]]'
    );
  });
});

describe('insertionKind() — one classifier for insertion and hints', () => {
  it('classifies every context', () => {
    expect(insertionKind(ctx(''))).toBe('bare');
    expect(insertionKind(ctx('text '))).toBe('bare');
    expect(insertionKind(ctx('[[@done]] then '))).toBe('bare');
    expect(insertionKind(ctx('[['))).toBe('wikilink');
    expect(insertionKind(ctx('['))).toBe('bracket');
    expect(insertionKind(ctx('[', ']'))).toBe('member');
    expect(insertionKind(ctx('[@a; '))).toBe('member');
    expect(insertionKind(ctx('[see '))).toBe('member');
  });
});

describe('insertionHint() matches what will actually be inserted', () => {
  const hintFor = (beforeStart: string, afterCursor = '') =>
    insertionHint({
      beforeStart,
      afterCursor,
      afterOpenBracket: afterOpenBracketIn(beforeStart),
    });

  it('names ]] inside a wikilink', () => {
    expect(hintFor('[[..[')).toBe('close with ]]');
  });

  it('names ] inside an open single bracket', () => {
    expect(hintFor('[')).toBe('close with ]');
  });

  it('says the citation form otherwise', () => {
    expect(hintFor('')).toBe('insert [[@key]]');
    expect(hintFor('text ')).toBe('insert [[@key]]');
    expect(hintFor('[[@a]] then ')).toBe('insert [[@key]]');
  });

  it('names the Pandoc form when the setting is off', () => {
    expect(
      insertionHint(
        { beforeStart: '', afterCursor: '', afterOpenBracket: false },
        { linked: false }
      )
    ).toBe('insert [@key]');
  });

  it('says "add to citation" inside an existing one', () => {
    expect(hintFor('[@a; ')).toBe('add to citation');
    expect(hintFor('[see ')).toBe('add to citation');
  });

  it('agrees with computeInsertion for every context', () => {
    const cases = ['[[', '[', '', 'text ', '[[@a]] then ', '[@a; ', '[see '];
    for (const beforeStart of cases) {
      const hint = hintFor(beforeStart);
      const inserted = computeInsertion(
        'k',
        {
          beforeStart,
          afterCursor: '',
          charBefore: beforeStart.slice(-1),
          afterOpenBracket: afterOpenBracketIn(beforeStart),
        },
        LINKED
      ).text;
      if (hint === 'close with ]]') expect(inserted.endsWith(']]')).toBe(true);
      else if (hint === 'close with ]')
        expect(inserted.endsWith(']') && !inserted.endsWith(']]')).toBe(true);
      else if (hint === 'add to citation') expect(inserted).toBe('@k');
      else expect(inserted).toBe('[[@k]]');
    }
  });
});

describe('whole-line results (where the bug actually showed)', () => {
  /**
   * The popup's span always starts at the '@'. These tests rebuild the real
   * line so a wrong CONTRACT (returning only a suffix, or adding a closer that
   * was already there) is caught, not just a wrong suffix.
   */
  function accept(
    line: string,
    atStart: number,
    cursor: number,
    citekey: string,
    opts: InsertOptions
  ) {
    // Trigger: everything from the '@' to the cursor is replaced.
    const beforeStart = line.slice(0, atStart);
    const afterCursor = line.slice(cursor);
    return (
      beforeStart +
      computeInsertion(
        citekey,
        {
          beforeStart,
          afterCursor,
          charBefore: beforeStart.slice(-1),
          afterOpenBracket: afterOpenBracketIn(beforeStart),
        },
        opts
      ).text +
      afterCursor
    );
  }

  it('bare @ → a linked citation by default', () => {
    expect(accept('@del', 0, 4, 'smith1992', LINKED)).toBe('[[@smith1992]]');
  });

  it('bare @ → a Pandoc citation when the setting is off', () => {
    expect(accept('@del', 0, 4, 'smith1992', PANDOC)).toBe('[@smith1992]');
  });

  it('bare @ + ⌘/Ctrl+Enter → a Pandoc citation', () => {
    expect(accept('@del', 0, 4, 'smith1992', FORCE)).toBe('[@smith1992]');
  });

  it('produces a valid wikilink: [[@citekey]]', () => {
    // '[[@del', '@' at index 2, cursor after 'del' → '[[@smith1992]]'
    expect(accept('[[@del', 2, 6, 'smith1992', LINKED)).toBe('[[@smith1992]]');
  });

  it('completes an open single bracket: [@del → [@citekey]', () => {
    expect(accept('[@del', 1, 5, 'smith1992', LINKED)).toBe('[@smith1992]');
  });

  it('does not add a second ] when one is already present', () => {
    expect(accept('[@del]', 1, 5, 'smith1992', LINKED)).toBe('[@smith1992]');
    expect(accept('[[@del]]', 2, 6, 'smith1992', LINKED)).toBe('[[@smith1992]]');
  });

  it('appends a member without closing an open citation', () => {
    expect(accept('[@a; @del', 5, 9, 'smith1992', LINKED)).toBe(
      '[@a; @smith1992'
    );
  });

  it('never loses the @ in any context', () => {
    for (const [line, at, cursor] of [
      ['[[@del', 2, 6],
      ['@del', 0, 4],
      ['[@del', 1, 5],
      ['text @del', 5, 9],
      ['[@a; @del', 5, 9],
    ] as const) {
      expect(accept(line, at, cursor, 'k', LINKED)).toContain('@k');
    }
  });
});
