import { zoteroItemToCSL } from '../zotero-csl';

describe('zoteroItemToCSL — retained fields', () => {
  const item = {
    key: 'K1',
    version: 7,
    data: {
      citationKey: 'smithWork2020',
      itemType: 'book',
      title: 'A work',
      creators: [
        { creatorType: 'author', firstName: 'Ada', lastName: 'Bly' },
        { creatorType: 'editor', name: 'An Institute' },
        { creatorType: 'castMember', firstName: 'Cy', lastName: 'Dee' },
        { creatorType: 'author', firstName: 'Eve', lastName: 'Fox' },
      ],
    },
  };

  it('retains ordered creators with Zotero’s own creatorType', () => {
    const csl = zoteroItemToCSL(item, 1)!;
    expect(csl._creators).toEqual([
      { role: 'author', family: 'Bly', given: 'Ada' },
      { role: 'editor', literal: 'An Institute' },
      { role: 'castMember', family: 'Dee', given: 'Cy' },
      { role: 'author', family: 'Fox', given: 'Eve' },
    ]);
  });

  it('keeps the lossy CSL roles for citeproc alongside _creators', () => {
    const csl = zoteroItemToCSL(item, 1)!;
    // castMember collapses into the CSL performer role; _creators keeps it exact.
    expect(csl.performer).toEqual([{ family: 'Dee', given: 'Cy' }]);
    expect(csl.author).toEqual([
      { family: 'Bly', given: 'Ada' },
      { family: 'Fox', given: 'Eve' },
    ]);
  });

  it('omits _creators when the item has none', () => {
    const csl = zoteroItemToCSL(
      { key: 'K2', data: { citationKey: 'x', itemType: 'book' } },
      1
    )!;
    expect(csl._creators).toBeUndefined();
  });
});
