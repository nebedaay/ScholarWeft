jest.mock(
  'obsidian',
  () => ({
    // A minimal stand-in for Obsidian's converter: inline tags → Markdown.
    htmlToMarkdown: (html: string) =>
      html
        .replace(/<i>/g, '*')
        .replace(/<\/i>/g, '*')
        .replace(/<b>/g, '**')
        .replace(/<\/b>/g, '**')
        .replace(/<\/p>/g, '\n\n')
        .replace(/<p>/g, '')
        .replace(/<[^>]+>/g, ''),
  }),
  { virtual: true }
);

import {
  creatorNames,
  displayDate,
  formatCreator,
  groupCreatorsByType,
  renderAnnotationCallout,
  renderCallout,
} from '../format';
import type { NoteContextAnnotation, NoteContextCreator } from '../context';

function annotation(
  overrides: Partial<NoteContextAnnotation> = {}
): NoteContextAnnotation {
  return {
    imgLink: null,
    comment: null,
    fileLink: () => null,
    backlink: 'zotero://open/library/items/X?annotation=A&page=116',
    parentItem: null,
    parentAttachment: {} as NoteContextAnnotation['parentAttachment'],
    key: 'A',
    indexedKey: 'A',
    libraryID: 1,
    type: 'highlight',
    text: null,
    commentHtml: null,
    colorHex: '#ffd400',
    colorName: 'yellow',
    pageLabel: '116',
    page: 116,
    authorName: null,
    isExternal: false,
    dateAdded: '2022-02-12',
    dateModified: '2022-02-12',
    tags: [],
    ...overrides,
  };
}

describe('renderAnnotationCallout()', () => {
  it('keeps the ZT Eta callout structure', () => {
    const out = renderAnnotationCallout(
      annotation({ type: 'highlight', text: 'x' })
    );
    expect(out).toContain('> [!yellow-highlight-annotation] Yellow Highlight');
    expect(out).toContain('> > [!ann-highlight-text-yellow]');
    expect(out).toContain('> - [[Yellow annotations|Yellow]]');
    expect(out).toContain('- ([p. 116](zotero://open/');
  });

  it('sends the excerpt, comment and tags through the shared pipeline', () => {
    const out = renderAnnotationCallout(
      annotation({
        type: 'highlight',
        text: 'Quoted [text] & more',
        comment: '<i>First</i> [[note]]',
        tags: [{ name: 'sufism', type: 'unknown' }],
      })
    );
    // HTML → Markdown for the italic, `[`/`<` escaped, `&` untouched.
    expect(out).toContain('> > *First* \\[\\[note]]');
    expect(out).toContain('> > Quoted \\[text] & more');
    expect(out).toContain('> > - [[sufism]]');
    expect(out).not.toContain('[[note]]');
  });

  it('renders an ISO annotation timestamp as its date', () => {
    const out = renderAnnotationCallout(
      annotation({ type: 'highlight', text: 'x', dateAdded: '2022-02-12T17:19:53Z' })
    );
    expect(out).toContain(', 2022-02-12)');
    expect(out).not.toContain('T17:19:53Z');
  });

  it('falls back to a [View] link when there is no page label', () => {
    const out = renderAnnotationCallout(
      annotation({ type: 'highlight', text: 'x', pageLabel: null })
    );
    expect(out).toContain('- ([View](');
  });

  it('can omit the tags and footer', () => {
    const out = renderAnnotationCallout(
      annotation({ type: 'highlight', text: 'x', tags: [{ name: 't', type: 'unknown' }] }),
      { tags: false, footer: false }
    );
    expect(out).not.toContain('[[t]]');
    expect(out).not.toContain('annotations|');
  });
});

describe('renderAnnotationCallout() — image/ink', () => {
  const imgLink = (alias?: string) =>
    alias ? `[[img.png|${alias}]]` : '[[img.png]]';

  it('embeds the excerpt image for ink', () => {
    const out = renderAnnotationCallout(
      annotation({ type: 'ink', colorName: 'red', imgLink })
    );
    expect(out).toContain('> [!red-ink-annotation] Red Ink');
    expect(out).toContain('> > ![[img.png]]');
    expect(out).toContain('> > - [[img.png|view ink image]]');
  });

  it('embeds an image annotation and its gallery link', () => {
    const out = renderAnnotationCallout(
      annotation({ type: 'image', colorName: 'blue', imgLink })
    );
    expect(out).toContain('> [!blue-image-annotation] Blue Image');
    expect(out).toContain('> > - [[image annotations|images]]');
  });

  it('renders "+" media continuations in one callout, blank-line separated', () => {
    const continuation = annotation({
      key: 'B',
      type: 'image',
      colorName: 'blue',
      imgLink: (alias?: string) => (alias ? `[[b.png|${alias}]]` : '[[b.png]]'),
    });
    const out = renderAnnotationCallout(
      annotation({
        type: 'image',
        colorName: 'blue',
        imgLink,
        continuationMedia: [continuation],
      })
    );
    // Both images sit in one callout, with a blank `>` line between blocks.
    expect(out).toContain('> > ![[img.png]]');
    expect(out).toContain('> > ![[b.png]]');
    expect(out).toContain('>\n> > ![[b.png]]');
    expect(out).not.toContain('> ...');
    // The sub-callout id appears once, not per image.
    expect(out.match(/\[!ann-image-blue\]/g)).toHaveLength(1);
  });
});

describe('renderCallout()', () => {
  it('renders a titled callout with a multi-line body', () => {
    expect(renderCallout({ type: 'ABSTRACT', title: 'Abstract', body: 'One.\n\nTwo.' })).toBe(
      ['> [!ABSTRACT] Abstract', '> One.', '>', '> Two.'].join('\n')
    );
  });

  it('renders a collapsible callout', () => {
    expect(renderCallout({ type: 'note', collapse: true, body: 'x' })).toBe(
      ['> [!note]-', '> x'].join('\n')
    );
  });
});

// ─── Creators ───────────────────────────────────────────────────────────────

const creator = (over: Partial<NoteContextCreator> = {}): NoteContextCreator => ({
  family: 'Smith',
  given: 'Jane',
  literal: null,
  role: 'author',
  fullName: 'Jane Smith',
  ...over,
});

describe('formatCreator()', () => {
  it('applies a token template and drops orphaned separators', () => {
    expect(formatCreator(creator(), '{family}, {given}')).toBe('Smith, Jane');
    expect(formatCreator(creator({ given: '' }), '{family}, {given}')).toBe('Smith');
    expect(formatCreator(creator({ family: '' }), '{family}, {given}')).toBe('Jane');
  });

  it('defaults to {literal} for institutional creators', () => {
    expect(
      formatCreator(creator({ family: '', given: '', literal: 'World Health Organization' }))
    ).toBe('World Health Organization');
  });

  it('wraps in a wikilink when asked', () => {
    expect(formatCreator(creator(), '{family}, {given}', true)).toBe('[[Smith, Jane]]');
  });
});

describe('groupCreatorsByType()', () => {
  it('emits one linked list per role, in first-seen order', () => {
    const creators = [
      creator(),
      creator({ family: 'Lee', given: 'Ada', fullName: 'Ada Lee', role: 'editor' }),
      creator({ family: 'Jones', given: 'Sam', fullName: 'Sam Jones', role: 'author' }),
    ];
    expect(groupCreatorsByType(creators)).toEqual([
      { key: 'authors', values: ['[[Smith, Jane]]', '[[Jones, Sam]]'] },
      { key: 'editors', values: ['[[Lee, Ada]]'] },
    ]);
  });

  it('honours namespacing, role order, and the suffix', () => {
    const creators = [
      creator({ role: 'author' }),
      creator({ family: 'Lee', given: 'Ada', fullName: 'Ada Lee', role: 'castMember' }),
    ];
    expect(
      groupCreatorsByType(creators, '{fullName}', {
        roles: ['castMember'],
        suffix: '',
        link: false,
      })
    ).toEqual([
      { key: 'castMember', values: ['Ada Lee'] },
      { key: 'author', values: ['Jane Smith'] },
    ]);
  });

  it('drops creators that format to nothing', () => {
    expect(groupCreatorsByType([creator({ family: '', given: '', literal: null })])).toEqual([]);
  });
});

describe('creatorNames()', () => {
  const creators = [
    creator(),
    creator({ family: 'Lee', given: 'Ada', fullName: 'Ada Lee', role: 'editor' }),
    creator({ family: 'Jones', given: 'Sam', fullName: 'Sam Jones', role: 'author' }),
  ];

  it('returns a joined string and filters by role', () => {
    expect(creatorNames(creators, { roles: 'author', format: '{family}' })).toBe('Smith, Jones');
    expect(creatorNames(creators, { roles: ['editor'], format: '{fullName}' })).toBe('Ada Lee');
  });
});

describe('displayDate()', () => {
  it('reduces an ISO timestamp to its date and passes a date through', () => {
    expect(displayDate('2022-02-12T17:19:53Z')).toBe('2022-02-12');
    expect(displayDate('2022-02-12')).toBe('2022-02-12');
    expect(displayDate(null)).toBe('');
    expect(displayDate(undefined)).toBe('');
  });
});
