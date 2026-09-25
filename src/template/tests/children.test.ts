jest.mock(
  'obsidian',
  () => ({
    htmlToMarkdown: (html: string) =>
      html
        .replace(
          /<h([1-6])>(.*?)<\/h\1>/g,
          (_m: string, l: string, t: string) =>
            `${'#'.repeat(Number(l))} ${t}\n\n`
        )
        .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
        .replace(/<i>(.*?)<\/i>/g, '*$1*')
        .replace(/<b>(.*?)<\/b>/g, '**$1**')
        .trim(),
  }),
  { virtual: true }
);

import {
  applyChildren,
  buildNoteContextWithChildren,
  fileUrl,
  mapAnnotation,
  mapAttachment,
  mapNote,
  mapTags,
  type RawZoteroChildren,
} from '../children';
import { buildNoteContext, type CachedEntry } from '../context';

// The captured real item the feature is diffed against (see HANDOFF.md).
const entry: CachedEntry = {
  id: 'alsaihBughyatAlmustafid2005',
  type: 'book',
  groupID: 1,
  title: 'Bughyat al-mustafīd',
  _zoteroKey: 'EKUBHHNW',
  _dateAdded: '2022-02-12T17:19:53Z',
};

const PDF = '2VFRLV96';
const ENCLOSURE =
  'file:///Users/josephhill/Zotero/storage/2VFRLV96/Bughyat%20al-mustaf%C4%ABd.pdf';

function attachmentItem(over: Record<string, unknown> = {}): any {
  return {
    key: PDF,
    links: { enclosure: { href: ENCLOSURE } },
    data: {
      key: PDF,
      itemType: 'attachment',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
      filename: 'Bughyat al-mustafīd.pdf',
      ...over,
    },
  };
}

function annotationItem(over: Record<string, unknown> = {}): any {
  return {
    key: 'A1',
    data: {
      key: 'A1',
      itemType: 'annotation',
      parentItem: PDF,
      annotationType: 'highlight',
      annotationText: 'excerpt',
      annotationComment: 'A <i>note</i>',
      annotationColor: '#2EA8E5',
      annotationPageLabel: '42',
      annotationPosition: '{"pageIndex":16,"rects":[]}',
      annotationAuthorName: '',
      dateAdded: '2026-09-16T22:31:36Z',
      dateModified: '2026-09-16T22:31:47Z',
      tags: [],
      ...over,
    },
  };
}

describe('mapAttachment()', () => {
  it('resolves the enclosure path, filename and reader deep link', () => {
    const a = mapAttachment(attachmentItem());

    expect(a.key).toBe(PDF);
    expect(a.indexedKey).toBe(PDF);
    expect(a.contentType).toBe('application/pdf');
    expect(a.linkMode).toBe('imported_file');
    expect(a.filename).toBe('Bughyat al-mustafīd.pdf');
    expect(a.filePath).toBe(
      '/Users/josephhill/Zotero/storage/2VFRLV96/Bughyat al-mustafīd.pdf'
    );
    expect(a.backlink).toBe('zotero://open/library/items/2VFRLV96');
  });

  it('renders fileLink as a percent-encoded file:// markdown link', () => {
    const a = mapAttachment(attachmentItem());
    expect(a.fileLink()).toBe(
      `[Bughyat al-mustafīd.pdf](${fileUrl(a.filePath!)})`
    );
    expect(a.fileLink('open')).toBe(
      `[open](${fileUrl(a.filePath!)})`
    );
    expect(a.fileLink('open', '#page=42')).toBe(
      `[open](${fileUrl(a.filePath!)}#page=42)`
    );
  });

  it('scopes keys and links to a group library', () => {
    const a = mapAttachment(attachmentItem(), { groupID: 7 });
    expect(a.indexedKey).toBe(`${PDF}g7`);
    expect(a.backlink).toBe('zotero://open/groups/7/items/2VFRLV96');
  });

  it('falls back to the storage layout when only the data dir is known', () => {
    const raw = attachmentItem({ path: undefined });
    raw.links = {};
    const a = mapAttachment(raw, { dataDir: '/zot' });
    expect(a.filePath).toBe(`/zot/storage/${PDF}/Bughyat al-mustafīd.pdf`);
  });

  it('resolves an attachments:-relative linked file against the base path', () => {
    const raw = attachmentItem({ linkMode: 'linked_file', path: 'attachments:pdf/x.pdf' });
    raw.links = {};
    const a = mapAttachment(raw, { baseAttachmentPath: '/base' });
    expect(a.filePath).toBe('/base/pdf/x.pdf');
  });

  it('leaves filePath null (and fileLink empty) for URL-only links', () => {
    const raw = attachmentItem({ linkMode: 'linked_url', filename: undefined });
    raw.links = {};
    const a = mapAttachment(raw);
    expect(a.filePath).toBeNull();
    expect(a.fileLink()).toBeNull();
    expect(a.linkMode).toBe('linked_url');
  });

  it('reports an unrecognised link mode as unknown', () => {
    const a = mapAttachment(attachmentItem({ linkMode: 'nonsense' }));
    expect(a.linkMode).toBe('unknown');
  });
});

describe('mapTags()', () => {
  it('maps the API tag shape and its manual/auto type', () => {
    expect(
      mapTags([
        { tag: 'manual one', type: 0 },
        { tag: 'auto one', type: 1 },
        { tag: 'assumed manual' },
      ])
    ).toEqual([
      { name: 'manual one', type: 'manual' },
      { name: 'auto one', type: 'auto' },
      { name: 'assumed manual', type: 'manual' },
    ]);
  });

  it('accepts a bare string list and skips empty names', () => {
    expect(mapTags(['x', '', null, { name: 'y' }])).toEqual([
      { name: 'x', type: 'manual' },
      { name: 'y', type: 'manual' },
    ]);
  });

  it('returns [] for a missing tag list', () => {
    expect(mapTags(undefined)).toEqual([]);
  });
});

describe('mapAnnotation()', () => {
  const parentItem = buildNoteContext(entry);
  const parentAttachment = mapAttachment(attachmentItem());

  it('maps colour, page, comment and provenance', () => {
    const a = mapAnnotation(annotationItem(), parentItem, parentAttachment);

    expect(a.key).toBe('A1');
    expect(a.type).toBe('highlight');
    expect(a.text).toBe('excerpt');
    expect(a.commentHtml).toBe('A <i>note</i>');
    expect(a.comment).toBe('A *note*');
    expect(a.colorHex).toBe('#2EA8E5');
    expect(a.colorName).toBe('blue');
    expect(a.pageLabel).toBe('42');
    expect(a.page).toBe(17);
    expect(a.backlink).toBe('zotero://select/library/items/A1');
    expect(a.parentItem).toBe(parentItem);
    expect(a.parentAttachment).toBe(parentAttachment);
    expect(a.isExternal).toBe(false);
    expect(a.dateAdded).toBe('2026-09-16T22:31:36Z');
  });

  it('has no imgLink for annotation kinds Zotero caches no image for', () => {
    const a = mapAnnotation(
      annotationItem(),
      parentItem,
      parentAttachment,
      { dataDir: '/zot' }
    );
    expect(a.imgLink).toBeNull();
  });

  it('links an ink annotation to its cached excerpt PNG', () => {
    const a = mapAnnotation(
      annotationItem({ annotationType: 'ink', annotationText: null }),
      parentItem,
      parentAttachment,
      { dataDir: '/zot' }
    );
    expect(a.type).toBe('ink');
    expect(a.imgLink?.()).toBe('[A1.png](file:///zot/cache/library/A1.png)');
  });

  it('scopes the excerpt image to the group cache folder', () => {
    const a = mapAnnotation(
      annotationItem({ annotationType: 'image' }),
      parentItem,
      parentAttachment,
      { dataDir: '/zot', groupID: 7 }
    );
    expect(a.imgLink?.()).toBe('[A1.png](file:///zot/cache/groups/7/A1.png)');
  });

  it('links a copied excerpt as an Obsidian wikilink when a vault path exists', () => {
    const a = mapAnnotation(
      annotationItem({ annotationType: 'image' }),
      parentItem,
      parentAttachment,
      {
        dataDir: '/zot',
        imageVaultPath: (key) => `Attachments/@k_p6_${key}.png`,
      }
    );
    expect(a.imgLink?.()).toBe('[[Attachments/@k_p6_A1.png]]');
    expect(a.imgLink?.('view image')).toBe(
      '[[Attachments/@k_p6_A1.png|view image]]'
    );
  });

  it('degrades imgLink to null without a data directory', () => {
    const a = mapAnnotation(
      annotationItem({ annotationType: 'ink' }),
      parentItem,
      parentAttachment
    );
    expect(a.imgLink).toBeNull();
  });

  it('pins fileLink to the annotation page', () => {
    const a = mapAnnotation(annotationItem(), parentItem, parentAttachment);
    expect(a.fileLink()).toBe(
      `[Bughyat al-mustafīd.pdf](${fileUrl(parentAttachment.filePath!)}#page=17)`
    );
    expect(a.fileLink('open')).toBe(
      `[open](${fileUrl(parentAttachment.filePath!)}#page=17)`
    );
  });

  it('reports a future annotation kind as unknown', () => {
    const a = mapAnnotation(
      annotationItem({ annotationType: 'freehand' }),
      parentItem,
      parentAttachment
    );
    expect(a.type).toBe('unknown');
  });
});

describe('mapNote()', () => {
  function noteItem(note: string): any {
    return { key: 'N1', data: { key: 'N1', itemType: 'note', note } };
  }

  it('converts the HTML body to escaped Markdown', () => {
    const n = mapNote(noteItem('<p>See [x]</p>'));
    expect(n.key).toBe('N1');
    expect(n.text).toBe('See \\[x]');
    expect(n.noteLink).toBeNull();
  });

  it('shifts the note\'s top heading to the Notes level', () => {
    const n = mapNote(noteItem('<h1>Wird</h1><p>Body</p>'));
    expect(n.text).toBe('### Wird\n\nBody');
  });

  it('honours a custom heading level', () => {
    const n = mapNote(noteItem('<h1>Wird</h1>'), { noteHeadingLevel: 2 });
    expect(n.text).toBe('## Wird');
  });

  it('yields null text for an empty note', () => {
    expect(mapNote(noteItem('')).text).toBeNull();
  });
});

describe('applyChildren() / buildNoteContextWithChildren()', () => {
  const raw: RawZoteroChildren = {
    attachments: [attachmentItem()],
    annotations: [annotationItem()],
    notes: [
      {
        key: 'N1',
        data: { key: 'N1', itemType: 'note', note: '<p>a note</p>' },
      },
    ],
  };

  it('wires annotations to the SAME attachment object the list holds', () => {
    const ctx = applyChildren(buildNoteContext(entry), raw);
    expect(ctx.attachments).toHaveLength(1);
    expect(ctx.annotations).toHaveLength(1);
    expect(ctx.notes).toHaveLength(1);
    expect(ctx.annotations[0].parentAttachment).toBe(ctx.attachments[0]);
    expect(ctx.annotations[0].parentItem).toBe(ctx);
    expect(ctx.notes[0].text).toBe('a note');
  });

  it('builds a complete context in one call', () => {
    const ctx = buildNoteContextWithChildren(entry, raw, {
      dataDir: '/zot',
      notePath: '_2 Bibliographic notes/@alsaihBughyatAlmustafid2005.md',
    });
    expect(ctx.notePath).toBe(
      '_2 Bibliographic notes/@alsaihBughyatAlmustafid2005.md'
    );
    expect(ctx.annotations[0].parentItem).toBe(ctx);
    expect(ctx.annotations[0].imgLink).toBeNull();
  });

  it('defaults the group scope to the context library', () => {
    const grouped = applyChildren(buildNoteContext({ ...entry, groupID: 7 }), {
      attachments: [attachmentItem()],
    });
    expect(grouped.attachments[0].indexedKey).toBe(`${PDF}g7`);
    expect(grouped.attachments[0].backlink).toBe(
      'zotero://open/groups/7/items/2VFRLV96'
    );
  });

  it('uses a placeholder attachment when the parent was not fetched', () => {
    const ctx = applyChildren(buildNoteContext(entry), {
      annotations: [annotationItem()],
    });
    expect(ctx.attachments).toEqual([]);
    expect(ctx.annotations[0].parentAttachment.key).toBe(PDF);
    expect(ctx.annotations[0].parentAttachment.filePath).toBeNull();
  });
});
