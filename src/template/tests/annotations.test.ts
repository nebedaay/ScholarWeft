jest.mock('obsidian', () => ({ htmlToMarkdown: (h: string) => h }), {
  virtual: true,
});

import type { NoteContextAnnotation } from '../context';
import {
  mergeContinuationAnnotations,
  processAnnotations,
  sortAnnotations,
} from '../annotations';

function ann(over: Partial<NoteContextAnnotation> = {}): NoteContextAnnotation {
  return {
    imgLink: null,
    comment: null,
    fileLink: () => null,
    backlink: 'zotero://select/library/items/K',
    parentItem: null,
    parentAttachment: { key: 'PDF', backlink: 'zotero://open/library/items/PDF' } as any,
    key: 'K',
    indexedKey: 'K',
    libraryID: 1,
    type: 'highlight',
    text: null,
    commentHtml: null,
    colorHex: null,
    colorName: 'yellow',
    pageLabel: null,
    page: null,
    authorName: null,
    isExternal: false,
    dateAdded: '',
    dateModified: '',
    sortIndex: null,
    tags: [],
    ...over,
  };
}

describe('sortAnnotations', () => {
  it('orders by annotationSortIndex, not arrival order', () => {
    const list = [
      ann({ key: 'c', sortIndex: '00006' }),
      ann({ key: 'a', sortIndex: '00005' }),
      ann({ key: 'b', sortIndex: '00115' }),
    ];
    expect(sortAnnotations(list).map((a) => a.key)).toEqual(['a', 'c', 'b']);
  });

  it('falls back to date then key when there is no sort index', () => {
    const list = [
      ann({ key: 'b', dateAdded: '2026-01-02' }),
      ann({ key: 'a', dateAdded: '2026-01-01' }),
    ];
    expect(sortAnnotations(list).map((a) => a.key)).toEqual(['a', 'b']);
  });
});

describe('mergeContinuationAnnotations', () => {
  it('appends a "+" highlight to the previous one, joined with " ... "', () => {
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', text: 'first part', pageLabel: '4' }),
      ann({ key: 'b', text: 'second part', comment: '+', pageLabel: '6' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe('a');
    expect(merged[0].text).toBe('first part ... second part');
    expect(merged[0].pageLabel).toBe('4–6');
  });

  it('combines comments and keeps the first annotation\'s identity', () => {
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', text: 'x', comment: 'note one' }),
      ann({ key: 'b', text: 'y', comment: '+ note two' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].comment).toBe('note one ... note two');
  });

  it('chains several continuations', () => {
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', text: 'one' }),
      ann({ key: 'b', text: 'two', comment: '+' }),
      ann({ key: 'c', text: 'three', comment: '+' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('one ... two ... three');
  });

  it('does not merge across attachments, but still strips the "+"', () => {
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', text: 'one' }),
      ann({
        key: 'b',
        text: 'two',
        comment: '+',
        parentAttachment: { key: 'OTHER' } as any,
      }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1].comment).toBeNull();
  });

  it('folds a "+" image into the previous image callout as extra media', () => {
    const img = () => 'file:///x.png';
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', type: 'image', text: null, imgLink: img, pageLabel: '6' }),
      ann({
        key: 'b',
        type: 'image',
        text: null,
        imgLink: img,
        comment: '+',
        pageLabel: '7',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].pageLabel).toBe('6–7');
    expect(merged[0].continuationMedia).toHaveLength(1);
    expect(merged[0].continuationMedia?.[0].key).toBe('b');
  });

  it('does not merge across annotation types, even with content', () => {
    const img = () => 'file:///x.png';
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', type: 'highlight', text: 'one' }),
      ann({ key: 'b', type: 'image', text: null, imgLink: img, comment: '+' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1].comment).toBeNull();
  });

  it('keeps a "+" comment-only annotation (no content) but strips the marker', () => {
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', text: 'one' }),
      ann({ key: 'b', type: 'text', text: null, comment: '+' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1].comment).toBeNull();
  });

  it('appends comment text after the "+" to the previous comment', () => {
    const img = () => 'file:///x.png';
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', type: 'image', imgLink: img, comment: 'first note' }),
      ann({
        key: 'b',
        type: 'image',
        imgLink: img,
        comment: '+ second note',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].comment).toBe('first note ... second note');
  });

  it('unions tags without duplicating names', () => {
    const merged = mergeContinuationAnnotations([
      ann({ key: 'a', text: 'x', tags: [{ name: 'tawāḍuʿ' } as any] }),
      ann({
        key: 'b',
        text: 'y',
        comment: '+',
        tags: [{ name: 'tawāḍuʿ' } as any, { name: 'Tijāniyya' } as any],
      }),
    ]);
    expect(merged[0].tags.map((t) => t.name)).toEqual(['tawāḍuʿ', 'Tijāniyya']);
  });
});

describe('processAnnotations', () => {
  it('sorts first, so a continuation merges into its PDF-order predecessor', () => {
    const processed = processAnnotations([
      ann({ key: 'later', text: 'second', comment: '+', sortIndex: '00007' }),
      ann({ key: 'first', text: 'first', sortIndex: '00006' }),
    ]);
    expect(processed).toHaveLength(1);
    expect(processed[0].key).toBe('first');
    expect(processed[0].text).toBe('first ... second');
  });
});
