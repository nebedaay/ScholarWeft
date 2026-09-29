import {
  DEFAULT_EXCLUDED_FOLDERS,
  filesToConvert,
  isInFolder,
} from '../convert-scope';

describe('isInFolder()', () => {
  it('matches the folder itself and anything under it', () => {
    expect(isInFolder('docs', 'docs')).toBe(true);
    expect(isInFolder('docs/setup.md', 'docs')).toBe(true);
    expect(isInFolder('docs/deep/nested.md', 'docs')).toBe(true);
  });

  it('matches whole segments only', () => {
    // A sibling whose name merely STARTS with the folder is not inside it.
    expect(isInFolder('docs-notes/a.md', 'docs')).toBe(false);
    expect(isInFolder('mydocs/a.md', 'docs')).toBe(false);
  });

  it('normalises leading and trailing slashes', () => {
    expect(isInFolder('docs/a.md', '/docs/')).toBe(true);
    expect(isInFolder('docs/a.md', './docs')).toBe(true);
  });

  it('never matches an empty folder', () => {
    expect(isInFolder('a.md', '')).toBe(false);
  });
});

describe('filesToConvert()', () => {
  const paths = [
    'Chapter 1.md',
    'notes/Chapter 2.md',
    'docs/setup.md',
    'src/readme.md',
    'node_modules/pkg/x.md',
    'archive/Old.md',
    'Chapter 1.md.bk',
    'notes/Chapter 2.md.bk.md',
    'image.png',
  ];

  it('keeps content files and drops the built-in skips', () => {
    expect(filesToConvert(paths)).toEqual(['Chapter 1.md', 'notes/Chapter 2.md', 'archive/Old.md']);
  });

  it('always drops .bk backups', () => {
    const out = filesToConvert(['a.md', 'a.md.bk', 'b.md.bk.md']);
    expect(out).toEqual(['a.md']);
  });

  it('honours extra excluded folders', () => {
    const out = filesToConvert(paths, [...DEFAULT_EXCLUDED_FOLDERS, 'archive']);
    expect(out).toEqual(['Chapter 1.md', 'notes/Chapter 2.md']);
  });

  it('can exclude a whole subtree', () => {
    expect(filesToConvert(['keep/a.md', 'skipme/b/c.md'], ['skipme'])).toEqual([
      'keep/a.md',
    ]);
  });
});
