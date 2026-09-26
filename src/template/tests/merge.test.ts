import {
  findManagedRegion,
  joinNote,
  MANAGED_CLOSE,
  MANAGED_OPEN,
  mergeFrontmatter,
  mergeManagedRegion,
  mergeNote,
  parseFrontmatter,
  splitNote,
  ZOTLIT_MANAGED_CLOSE,
  ZOTLIT_MANAGED_OPEN,
} from '../merge';
import { YamlBuilder, type YamlFieldSpec, type YamlValue } from '../yaml';

function buildSpecs(
  entries: Array<[string, YamlValue, ('replace' | 'append' | 'keep')?]>
): YamlFieldSpec[] {
  const b = new YamlBuilder();
  b.start();
  for (const [key, value, merge] of entries) b.add(key, value, { merge });
  b.end();
  return b.fieldSpecs();
}

describe('splitNote / joinNote', () => {
  it('round-trips a note with frontmatter', () => {
    const content = '---\na: 1\n---\n\n# Title\n\nbody\n';
    const { frontmatter, body } = splitNote(content);
    expect(frontmatter).toBe('a: 1');
    expect(body).toBe('\n# Title\n\nbody\n');
    expect(joinNote(frontmatter!, body)).toBe(content);
  });

  it('treats a note without frontmatter as all body', () => {
    const { frontmatter, body } = splitNote('# Title\n');
    expect(frontmatter).toBeNull();
    expect(body).toBe('# Title\n');
  });
});

describe('parseFrontmatter', () => {
  it('keeps list items and block scalars with their key', () => {
    const props = parseFrontmatter(
      ['title: T', 'tags:', '  - a', '  - b', 'abstract: |-', '  line one', '  line two'].join(
        '\n'
      )
    );
    expect(props.map((p) => p.key)).toEqual(['title', 'tags', 'abstract']);
    expect(props[1].lines).toEqual(['tags:', '  - a', '  - b']);
    expect(props[2].lines).toEqual(['abstract: |-', '  line one', '  line two']);
  });

  it('preserves a leading comment', () => {
    const props = parseFrontmatter('# user note\na: 1');
    expect(props[0].key).toBe('');
    expect(props[1].key).toBe('a');
  });
});

describe('mergeFrontmatter', () => {
  const existing = [
    'title: Old title',
    'custom: keep me',
    'tags:',
    '  - a',
    'edition: 3',
  ].join('\n');

  it('replaces in-scope keys and preserves out-of-scope ones verbatim', () => {
    const specs = buildSpecs([
      ['title', 'New title'],
      ['citekey', 'newKey'],
    ]);
    const out = mergeFrontmatter(existing, specs);
    expect(out).toContain('title: New title');
    expect(out).toContain('custom: keep me');
    expect(out).toContain('tags:\n  - a');
    expect(out).toContain('edition: 3');
    expect(out).toContain('citekey: newKey');
  });

  it('removes an in-scope property whose template value became empty', () => {
    const specs = buildSpecs([['edition', null]]);
    const out = mergeFrontmatter(existing, specs);
    expect(out).not.toContain('edition');
  });

  it('keep leaves the existing value, and writes when absent', () => {
    const specs = buildSpecs([
      ['title', 'From template', 'keep'],
      ['citekey', 'K', 'keep'],
    ]);
    const out = mergeFrontmatter(existing, specs);
    expect(out).toContain('title: Old title');
    expect(out).toContain('citekey: K');
  });

  it('append adds only new list items', () => {
    const specs = buildSpecs([['tags', ['a', 'c'], 'append']]);
    const out = mergeFrontmatter(existing, specs);
    expect(out).toContain('tags:\n  - a\n  - c');
  });
});

describe('managed region', () => {
  const renderedBody = `\n# T\n\n${MANAGED_OPEN}\n## Notes\n\nnew notes\n${MANAGED_CLOSE}\n`;

  it('locates the region', () => {
    const r = findManagedRegion(renderedBody);
    expect(r).not.toBeNull();
    expect(renderedBody.slice(r!.start, r!.end)).toBe(
      `${MANAGED_OPEN}\n## Notes\n\nnew notes\n${MANAGED_CLOSE}`
    );
  });

  it('replaces only the region, keeping user text ABOVE and BELOW', () => {
    const existingBody = [
      '',
      '# My title',
      '',
      'My own introduction.',
      '',
      MANAGED_OPEN,
      '## Notes',
      '',
      'old notes',
      MANAGED_CLOSE,
      '',
      'My own closing thoughts.',
      '',
    ].join('\n');

    const merged = mergeManagedRegion(existingBody, renderedBody);
    expect(merged).toContain('My own introduction.');
    expect(merged).toContain('My own closing thoughts.');
    expect(merged).toContain('new notes');
    expect(merged).not.toContain('old notes');
  });

  it('appends the region when the note has none (annotations added later)', () => {
    const existingBody = '\n## Notes\n\nonly the user\u2019s writing\n';
    const merged = mergeManagedRegion(existingBody, renderedBody);
    expect(merged).toContain('only the user\u2019s writing');
    expect(merged).toContain(MANAGED_OPEN);
    expect(merged).toContain('new notes');
    // The user text stays above the appended region.
    expect(merged.indexOf('only the user')).toBeLessThan(merged.indexOf(MANAGED_OPEN));
  });

  it('removes an existing region when the render has none and the template manages regions', () => {
    const existingBody = [
      '',
      '## Notes',
      '',
      'user',
      '',
      MANAGED_OPEN,
      '## Annotations',
      '',
      'old',
      MANAGED_CLOSE,
      '',
    ].join('\n');
    const merged = mergeManagedRegion(existingBody, '\n## Notes\n\nuser\n', {
      managesRegion: true,
    });
    expect(merged).not.toContain(MANAGED_OPEN);
    expect(merged).toContain('user');
  });

  it('leaves the region alone when the template does not manage regions', () => {
    const existingBody = `\n${MANAGED_OPEN}\nx\n${MANAGED_CLOSE}\n`;
    expect(mergeManagedRegion(existingBody, 'no region here')).toBe(existingBody);
  });

  it('converts a ZotLit region to ours in place', () => {
    const existingBody = [
      '',
      '## Notes',
      '',
      'user note',
      '',
      ZOTLIT_MANAGED_OPEN,
      '## Annotations',
      '',
      'zotlit annotations',
      ZOTLIT_MANAGED_CLOSE,
      '',
    ].join('\n');
    const merged = mergeManagedRegion(existingBody, renderedBody);
    expect(merged).not.toContain(ZOTLIT_MANAGED_OPEN);
    expect(merged).toContain(MANAGED_OPEN);
    expect(merged).toContain('new notes');
    expect(merged).not.toContain('zotlit annotations');
    // The user's own text is preserved.
    expect(merged).toContain('user note');
  });

  it('removes a ZotLit region when the render has no annotations', () => {
    const existingBody = [
      '',
      '## Notes',
      '',
      'user',
      '',
      ZOTLIT_MANAGED_OPEN,
      '',
      ZOTLIT_MANAGED_CLOSE,
      '',
    ].join('\n');
    const merged = mergeManagedRegion(existingBody, '\n## Notes\n\nuser\n', {
      managesRegion: true,
    });
    expect(merged).not.toContain(ZOTLIT_MANAGED_OPEN);
    expect(merged).toContain('user');
  });
});

describe('mergeNote', () => {
  it('merges frontmatter and the region in one pass', () => {
    const existing = [
      '---',
      'title: Old title',
      'custom: keep me',
      'citekey: EKUBHHNW',
      '---',
      '# Old title',
      '',
      'User prose before.',
      '',
      MANAGED_OPEN,
      '## Notes',
      '',
      'old',
      MANAGED_CLOSE,
      '',
      'User prose after.',
      '',
    ].join('\n');

    const rendered = [
      '---',
      'title: New title',
      'citekey: EKUBHHNW',
      '---',
      '# New title',
      '',
      MANAGED_OPEN,
      '## Notes',
      '',
      'fresh annotation',
      MANAGED_CLOSE,
      '',
    ].join('\n');

    const specs = buildSpecs([
      ['title', 'New title'],
      ['citekey', 'EKUBHHNW'],
    ]);
    const out = mergeNote(existing, rendered, specs);

    expect(out).toContain('title: New title');
    expect(out).toContain('custom: keep me');
    // Body: the region refreshes, but the user's prose and (stale) H1 stay.
    expect(out).toContain('fresh annotation');
    expect(out).not.toContain('\nold\n');
    expect(out).toContain('User prose before.');
    expect(out).toContain('User prose after.');
    expect(out).toContain('# Old title');
  });

  it('passes a first import through untouched', () => {
    const rendered = '---\ntitle: T\n---\n\n# T\n';
    const specs = buildSpecs([['title', 'T']]);
    // Caller passes existing = null; mergeInto returns rendered unchanged.
    expect(mergeNote(rendered, rendered, specs)).toBe(rendered);
  });
});
