import {
  excerptImageName,
  findPreviousImagePath,
} from '../excerpt-images';

describe('excerptImageName', () => {
  it('builds @citekey_p<page>_<key>.png', () => {
    expect(excerptImageName('alsaihBughyatAlmustafid2005', 23, 'HGYZJG7W')).toBe(
      '@alsaihBughyatAlmustafid2005_p23_HGYZJG7W.png'
    );
  });

  it('drops the page segment when the page is unknown', () => {
    expect(excerptImageName('k', null, 'ABCD1234')).toBe('@k_ABCD1234.png');
  });
});

describe('findPreviousImagePath', () => {
  it('prefers our named form over ZotLit\'s bare key', () => {
    expect(
      findPreviousImagePath(
        ['Attachments/HGYZJG7W.png', 'Attachments/@k_p6_HGYZJG7W.png'],
        'HGYZJG7W'
      )
    ).toBe('Attachments/@k_p6_HGYZJG7W.png');
  });

  it('falls back to ZotLit\'s bare <key>.png to rename in place', () => {
    expect(
      findPreviousImagePath(['Attachments/HGYZJG7W.png'], 'HGYZJG7W')
    ).toBe('Attachments/HGYZJG7W.png');
  });

  it('does not match a different annotation key', () => {
    expect(
      findPreviousImagePath(['Attachments/@k_p6_OTHERKEY.png'], 'HGYZJG7W')
    ).toBeUndefined();
  });
});
