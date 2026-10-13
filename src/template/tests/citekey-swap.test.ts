jest.mock(
  'obsidian',
  () => ({ normalizePath: (p: string) => p.replace(/\\/g, '/') }),
  { virtual: true }
);

import { planCitekeyReconcile } from '../note-lookup';

/**
 * A pair of notes whose FILENAMES are crossed relative to their item ids —
 * the real case: Turner's book (`…1987`) and a chapter of the same name
 * (`…1987a`). The library says the book is `…1987`; the note NAMED `…1987`
 * actually carries the chapter's id.
 *
 * The plan is therefore a two-way swap. It is applied through temporary names
 * (see `applyCitekeyReconcile`), NOT through the citation-rewrite map: the
 * citekeys themselves are unchanged, only which file holds which item is wrong.
 */
describe('planCitekeyReconcile() — crossed filenames', () => {
  const notes = [
    {
      path: '_2 Bibliographic notes/@turnerAnthropologyPerformance1987.md',
      basename: '@turnerAnthropologyPerformance1987',
      citekey: 'turnerAnthropologyPerformance1987a',
      zoteroKey: 'SQ6H9UDU',
    },
    {
      path: '_2 Bibliographic notes/@turnerAnthropologyPerformance1987a.md',
      basename: '@turnerAnthropologyPerformance1987a',
      citekey: 'turnerAnthropologyPerformance1987',
      zoteroKey: 'R9VPT8PF',
    },
  ];
  // Live Zotero: R9VPT8PF = book `…1987`; SQ6H9UDU = chapter `…1987a`.
  const library: Record<string, string> = {
    SQ6H9UDU: 'turnerAnthropologyPerformance1987a',
    R9VPT8PF: 'turnerAnthropologyPerformance1987',
  };

  it('plans a swap, each rename targeting the other name', () => {
    const { renames } = planCitekeyReconcile(notes, (k) => library[k] ?? null);
    expect(renames.map((r) => r.newPath.split('/').pop())).toEqual([
      '@turnerAnthropologyPerformance1987a.md',
      '@turnerAnthropologyPerformance1987.md',
    ]);
    // Each target is the OTHER note's path — the signal that this is a cycle.
    const paths = new Set(renames.map((r) => r.path));
    for (const r of renames) expect(paths.has(r.newPath)).toBe(true);
    // Citekeys are unchanged, so nothing to rekey in the frontmatter.
    expect(renames.every((r) => r.rekeyFrontmatter === false)).toBe(true);
  });

  it('plans nothing when the filenames already match the ids', () => {
    const correct = [
      { ...notes[0], citekey: 'turnerAnthropologyPerformance1987', zoteroKey: 'R9VPT8PF' },
      { ...notes[1], citekey: 'turnerAnthropologyPerformance1987a', zoteroKey: 'SQ6H9UDU' },
    ];
    // The first note is named `…1987` and now carries the BOOK's id, so it is
    // already correct; likewise the second.
    const { renames } = planCitekeyReconcile(correct, (k) => library[k] ?? null);
    expect(renames).toEqual([]);
  });

  it('adds the `@` to a name that is the citekey without it (ZotLit naming)', () => {
    // A note ZotLit named `bourdieuMaisonKabyle1970.md` — no `@`. It must be
    // renamed to `@bourdieuMaisonKabyle1970.md`, not left to prompt forever.
    const bare = [
      {
        path: '_2 Bibliographic notes/bourdieuMaisonKabyle1970.md',
        basename: 'bourdieuMaisonKabyle1970',
        citekey: 'bourdieuMaisonKabyle1970',
        zoteroKey: 'AAAA1111',
      },
    ];
    const { renames } = planCitekeyReconcile(bare, () => 'bourdieuMaisonKabyle1970');
    expect(renames).toHaveLength(1);
    expect(renames[0].newPath).toBe(
      '_2 Bibliographic notes/@bourdieuMaisonKabyle1970.md'
    );
    // The citekey itself is unchanged, so nothing to rewrite in the frontmatter
    // or the vault's citations.
    expect(renames[0].rekeyFrontmatter).toBe(false);
    expect(renames[0].fromKey).toBe('bourdieuMaisonKabyle1970');
  });
});
