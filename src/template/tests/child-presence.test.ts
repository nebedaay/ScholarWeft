import { buildChildPresence, presenceHas } from '../child-presence';

describe('buildChildPresence()', () => {
  it('flags a PDF and a snapshot, but not other attachment types', () => {
    const p = buildChildPresence({
      attachments: [
        { itemKey: 'A1', parentItem: 'ITEM1', contentType: 'application/pdf' },
        { itemKey: 'A2', parentItem: 'ITEM2', contentType: 'text/html' },
        { itemKey: 'A3', parentItem: 'ITEM3', contentType: 'image/png' },
      ],
      annotations: [],
      notes: [],
      attachmentToItem: new Map(),
    });
    expect(p.ITEM1.a).toBe(1);
    expect(p.ITEM2.a).toBe(1);
    expect(p.ITEM3).toBeUndefined();
  });

  it('flags child notes against their top-level item', () => {
    const p = buildChildPresence({
      attachments: [],
      annotations: [],
      notes: [{ parentItem: 'ITEM1' }],
      attachmentToItem: new Map(),
    });
    expect(p.ITEM1.n).toBe(1);
  });

  it('attributes an annotation to the top-level item via the attachment map', () => {
    const p = buildChildPresence({
      attachments: [],
      annotations: [{ parentItem: 'ATT1' }],
      notes: [],
      attachmentToItem: new Map([['ATT1', 'ITEM1']]),
    });
    expect(p.ITEM1.an).toBe(1);
  });

  it('ignores an annotation whose attachment is unknown', () => {
    const p = buildChildPresence({
      attachments: [],
      annotations: [{ parentItem: 'UNKNOWN' }],
      notes: [],
      attachmentToItem: new Map(),
    });
    expect(Object.keys(p)).toHaveLength(0);
  });

  it('combines all three flags on one item', () => {
    const p = buildChildPresence({
      attachments: [
        { itemKey: 'A1', parentItem: 'ITEM1', contentType: 'application/pdf' },
      ],
      annotations: [{ parentItem: 'A1' }],
      notes: [{ parentItem: 'ITEM1' }],
      attachmentToItem: new Map([['A1', 'ITEM1']]),
    });
    expect(p.ITEM1).toEqual({ a: 1, n: 1, an: 1 });
  });
});

describe('presenceHas()', () => {
  it('is true when nothing is required', () => {
    expect(presenceHas(undefined, {})).toBe(true);
  });

  it('requires each requested flag', () => {
    const p = { a: 1 as const, n: 1 as const };
    expect(presenceHas(p, { attachment: true, notes: true })).toBe(true);
    expect(presenceHas(p, { annotations: true })).toBe(false);
  });
});
