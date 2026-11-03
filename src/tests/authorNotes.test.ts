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

import { readFileSync } from 'fs';
import { join } from 'path';
import { Eta } from 'eta';

import {
  buildAuthorIndex,
  mergeAuthorContent,
  planAuthorNote,
} from '../authorNotes';
import type { PartialCSLEntry } from '../bib/types';

const entries: PartialCSLEntry[] = [
  {
    id: 'smith2000',
    title: 'A work',
    _creators: [
      { role: 'author', family: 'Smith', given: 'Jane' },
      { role: 'editor', family: 'Doe', given: 'John' },
    ],
    _tags: ['Islam', 'Sufism'],
  },
  {
    id: 'smith2001',
    title: 'Another work',
    author: [{ family: 'Smith', given: 'Jane' }],
    _tags: ['Sufism'],
  },
  {
    id: 'institute2000',
    title: 'An institutional work',
    _creators: [{ role: 'author', literal: 'An Institute' }],
  },
  {
    id: 'wehr',
    title: 'A dictionary',
    _creators: [{ role: 'author', family: 'Wehr', given: 'Hans' }],
  },
  {
    id: 'youtube',
    title: 'A video',
    _creators: [{ role: 'author', literal: 'kashf' }],
  },
];

describe('buildAuthorIndex()', () => {
  const index = buildAuthorIndex(entries);

  it('formats the link text and the First Last alias', () => {
    const record = index.get('Smith, Jane')!;
    expect(record).toBeDefined();
    expect(record.alias).toBe('Jane Smith');
    expect(index.get('Jane Smith')).toBe(record);
  });

  it('merges roles, works and tags across items', () => {
    const record = index.get('Smith, Jane')!;
    expect([...record.citekeys].sort()).toEqual(['smith2000', 'smith2001']);
    expect([...record.tags].sort()).toEqual(['Islam', 'Sufism']);
    expect(record.roles.has('author')).toBe(true);
  });

  it('keeps literal creators as single-part pages', () => {
    const record = index.get('An Institute')!;
    expect(record.alias).toBeNull();
    expect([...record.citekeys]).toEqual(['institute2000']);
  });

  it('reads CSL role groups when _creators is absent', () => {
    const record = index.get('John Doe')!;
    expect(record.alias).toBe('John Doe');
    expect([...record.citekeys]).toEqual(['smith2000']);
    expect(record.roles.has('editor')).toBe(true);
  });
});

describe('planAuthorNote()', () => {
  const index = buildAuthorIndex(entries);
  const classify = (
    basename: string,
    frontmatter: Record<string, unknown> | undefined,
    up = false
  ) => planAuthorNote({ basename, frontmatter, up, index });

  it('merges a multi-word exact creator name without up: Authors', () => {
    expect(classify('Smith, Jane', {}, false)).not.toBeNull();
    expect(classify('Wehr, Hans', {}, false)).not.toBeNull();
  });

  it('merges a multi-word literal creator name', () => {
    expect(classify('An Institute', {}, false)).not.toBeNull();
  });

  it('merges a one-word exact creator only with up: Authors', () => {
    expect(classify('kashf', {}, false)).toBeNull();
    expect(classify('kashf', { up: ['[[Authors]]'] }, true)).not.toBeNull();
  });

  it('never matches the First Last alias', () => {
    expect(classify('Hans Wehr', { up: ['[[Authors]]'] }, true)).toBeNull();
  });

  it('ignores a title with an extra comma', () => {
    expect(classify('Smith, Jane, Jr.', {}, false)).toBeNull();
  });

  it('ignores unrelated notes', () => {
    expect(classify('Nobody, Unrelated', {}, false)).toBeNull();
    expect(classify('A Note', {}, false)).toBeNull();
  });

  it('ignores Midad repository notes', () => {
    expect(
      classify('Hans Wehr', {
        'midad-up': ['[[Midad Arabic Sources]]'],
      })
    ).toBeNull();
  });

  it('ignores dictionary/term pages', () => {
    expect(classify('kashf', { term: 'kashf' }, true)).toBeNull();
  });
});

describe('mergeAuthorContent()', () => {
  const existing = [
    '---',
    'up:',
    '  - "[[Home]]"',
    'aliases:',
    '  - "Existing"',
    'related:',
    '  - "[[friend]]"',
    'variants:',
    '  - "[[Other, Name]]"',
    'created: 2020-01-01',
    '---',
    'My own body.',
    '',
    '%%sw-author-managed%%',
    '## Publications',
    '',
    '[[@old|ref]]',
    '%%/sw-author-managed%%',
    '',
  ].join('\n');

  const rendered = [
    '---',
    'up:',
    '  - "[[Authors]]"',
    'aliases:',
    '  - "Jane Smith"',
    'created: 2026-01-01',
    'related:',
    '  - "[[@smith2000]]"',
    'variants: []',
    '---',
    '# Smith, Jane',
    '',
    '%%sw-author-managed%%',
    '## Publications',
    '',
    '[[@smith2000|ref]]',
    '%%/sw-author-managed%%',
    '',
  ].join('\n');

  it('adds the managed fields and keeps the user’s own', () => {
    const merged = mergeAuthorContent(existing, rendered);
    expect(merged).toContain('  - "[[Home]]"');
    expect(merged).toContain('  - "[[Authors]]"');
    expect(merged).toContain('  - "Existing"');
    expect(merged).toContain('  - "Jane Smith"');
    expect(merged).toContain('  - "[[friend]]"');
    expect(merged).toContain('  - "[[@smith2000]]"');
    expect(merged).toContain('  - "[[Other, Name]]"');
    expect(merged).toContain('created: 2020-01-01');
  });

  it('preserves the body and replaces only the Publications region', () => {
    const merged = mergeAuthorContent(existing, rendered);
    expect(merged).toContain('My own body.');
    expect(merged).not.toContain('# Smith, Jane');
    expect(merged).toContain('[[@smith2000|ref]]');
    expect(merged).not.toContain('[[@old|ref]]');
  });


  it('collapses an alias already present unquoted and quoted', () => {
    const unquoted = existing.replace('  - "Existing"', '  - Existing');
    const merged = mergeAuthorContent(unquoted, rendered);
    expect(merged.match(/Existing/g)).toHaveLength(1);
    expect(merged.match(/Jane Smith/g)).toHaveLength(1);
  });

  it('uses the full rendered body for an empty note', () => {
    const empty = '---\nup:\n  - "[[Home]]"\n---\n';
    const merged = mergeAuthorContent(empty, rendered);
    expect(merged).toContain('# Smith, Jane');
    expect(merged).toContain('[[@smith2000|ref]]');
  });
});

describe('author template', () => {
  const template = readFileSync(
    join(__dirname, '../../sw-literature-note-templates/author.eta.md'),
    'utf8'
  );

  it('writes up, alias, roles, related links and the publication run', () => {
    const out = new Eta({ autoEscape: false, useWith: true, autoTrim: false }).renderString(template, {
      display: 'Smith, Jane',
      alias: 'Jane Smith',
      roles: ['author', 'editor'],
      related: ['[[@smith2000]]', '[[Islam]]'],
      publications: ['[[@smith2000|ref]]', '[[@smith2001]]'],
      date: '2026-11-02',
    });
    expect(out).toContain('  - "[[Authors]]"');
    expect(out).toContain('  - "Jane Smith"');
    expect(out).toContain('creator-roles:\n  - author\n  - editor');
    expect(out).toContain('  - "[[@smith2000]]"');
    expect(out).toContain('  - "[[Islam]]"');
    expect(out).toContain('[[@smith2000|ref]] [[@smith2001]]');
    expect(out).toContain('# Smith, Jane');
  });

  it('omits aliases for a literal creator', () => {
    const out = new Eta({ autoEscape: false, useWith: true, autoTrim: false }).renderString(template, {
      display: 'An Institute',
      alias: null,
      roles: [],
      related: [],
      publications: [],
      date: '2026-11-02',
    });
    expect(out).not.toContain('aliases:');
    expect(out).toContain('related: []');
  });
});
