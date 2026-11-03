jest.mock(
  'obsidian',
  () => ({
    App: class {},
    TFile: class {},
    TFolder: class {},
    Notice: class {},
    FuzzySuggestModal: class {},
    normalizePath: (path: string) => path,
  }),
  { virtual: true }
);

import {
  cleanVariantName,
  rewriteCreatorFrontmatter,
  variantAliases,
} from '../authorVariants';

describe('author variant names', () => {
  it('normalises a wikilink variant to its target display name', () => {
    expect(cleanVariantName('[[Smith, John Middle]]')).toBe('Smith, John Middle');
    expect(cleanVariantName('[[Smith, John Middle|J. Smith]]')).toBe(
      'Smith, John Middle'
    );
    expect(cleanVariantName('  Smith, John Middle  ')).toBe('Smith, John Middle');
  });

  it('adds the variant and its First Last autocomplete alias', () => {
    expect(variantAliases('Smith, John Middle', 'Smith, John')).toEqual([
      'Smith, John Middle',
      'John Middle Smith',
    ]);
    expect(variantAliases('An Institute', 'Other, Author')).toEqual(['An Institute']);
    expect(variantAliases('Smith, John', 'Smith, John')).toEqual([]);
  });
});

describe('rewriteCreatorFrontmatter()', () => {
  const note = [
    '---',
    'authors:',
    '  - "[[Smith, John Middle]]"',
    'editors:',
    '  - "[[Smith, John Middle|J. M. Smith]]"',
    'translators:',
    '  - "[[Smith, John Middle]]"',
    'related:',
    '  - "[[Smith, John Middle]]"',
    'up:',
    '  - "[[Authors]]"',
    '---',
    'Body [[Smith, John Middle]] stays alone.',
    '',
  ].join('\n');
  const mappings = new Map([['Smith, John Middle', 'Smith, John']]);

  it('rewrites creator properties but leaves related, up, and body alone', () => {
    const result = rewriteCreatorFrontmatter(note, mappings);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      '  - "[[Smith, John|Smith, John Middle]]"'
    );
    expect(result.content).toContain('  - "[[Smith, John|J. M. Smith]]"');
    expect(result.content).toContain(
      'related:\n  - "[[Smith, John Middle]]"'
    );
    expect(result.content).toContain('up:\n  - "[[Authors]]"');
    expect(result.content).toContain('Body [[Smith, John Middle]] stays alone.');
  });

  it('does nothing when the name is not mapped', () => {
    const result = rewriteCreatorFrontmatter(note, new Map());
    expect(result.changed).toBe(false);
    expect(result.content).toBe(note);
  });
});
