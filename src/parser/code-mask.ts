/**
 * Mask markdown code regions so citation scanning cannot see citekeys inside
 * them.
 *
 * Returns a string of the SAME LENGTH as `text`, with every fenced-code-block
 * and inline-code-span character replaced by a space. Callers scan the returned
 * string while slicing their ORIGINAL text with the same offsets — a code region
 * contains no `@` or `[`, so no citation can be detected inside one.
 *
 * Covered:
 *  - fenced code blocks: a line opening with 3+ backticks or 3+ tildes, closed
 *    by a line with the same character and at least as many markers (or running
 *    to end of file);
 *  - inline code spans: a run of N backticks to the next run of exactly N.
 *
 * NOT covered: 4-space indented code blocks, which cannot be told from ordinary
 * indented prose without full block context. Fences and inline spans are what a
 * vault actually carries stray `@` tokens in.
 */
export function maskCodeRegions(text: string): string {
  // Fast path: no backtick and no tilde-fence at all.
  if (!text || (text.indexOf('`') === -1 && text.indexOf('~~~') === -1)) {
    return text;
  }

  const chars = text.split('');
  const n = text.length;
  const blank = (from: number, to: number) => {
    const end = Math.min(to, n);
    for (let k = from; k < end; k++) chars[k] = ' ';
  };

  let i = 0;
  while (i < n) {
    const atLineStart = i === 0 || text[i - 1] === '\n';
    if (atLineStart) {
      const fence = fenceEnd(text, i);
      if (fence !== null) {
        blank(i, fence);
        i = fence;
        continue;
      }
    }
    if (text[i] === '`') {
      let run = 0;
      while (i + run < n && text[i + run] === '`') run++;
      const close = findBacktickRun(text, i + run, run);
      if (close !== -1) {
        const end = close + run;
        blank(i, end);
        i = end;
        continue;
      }
      i += run;
      continue;
    }
    i++;
  }

  return chars.join('');
}

/**
 * If `at` (a line start) opens a fenced code block, return the index just past
 * its closing line (or end of text for an unterminated fence), else null.
 */
function fenceEnd(text: string, at: number): number | null {
  let j = at;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
  const ch = text[j];
  if (ch !== '`' && ch !== '~') return null;
  let markers = 0;
  while (text[j + markers] === ch) markers++;
  if (markers < 3) return null;

  // Skip the opening line (its info string is irrelevant here).
  let pos = text.indexOf('\n', j);
  pos = pos === -1 ? text.length : pos + 1;

  while (pos < text.length) {
    let k = pos;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
    if (text[k] === ch) {
      let run = 0;
      while (text[k + run] === ch) run++;
      if (run >= markers) {
        // The rest of the closing line must be blank.
        let e = k + run;
        while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
        if (e >= text.length || text[e] === '\n') {
          return e < text.length ? e + 1 : text.length;
        }
      }
    }
    const next = text.indexOf('\n', pos);
    if (next === -1) break;
    pos = next + 1;
  }
  return text.length; // unterminated fence → mask to the end
}

/** Start index of the next run of exactly `runLen` backticks at/after `from`. */
function findBacktickRun(text: string, from: number, runLen: number): number {
  let j = from;
  while (j < text.length) {
    if (text[j] === '`') {
      let run = 0;
      while (text[j + run] === '`') run++;
      if (run === runLen) return j;
      j += run;
    } else {
      j++;
    }
  }
  return -1;
}
