import {
  DEFAULT_YAML_TITLE_BACKGROUND,
  DEFAULT_YAML_TITLE_SIZE,
  YAML_FORMATTING_BODY_CLASS,
  YAML_FORMATTING_MARKER,
  yamlFormattingValues,
} from '../yamlFormatting';

describe('yamlFormattingValues()', () => {
  it('uses the configured background and size', () => {
    expect(
      yamlFormattingValues({ titleBackground: '#123456', titleSize: 1.5 })
    ).toEqual({ background: '#123456', sizeRem: '1.5rem' });
  });

  it('falls back to the defaults', () => {
    expect(yamlFormattingValues()).toEqual({
      background: DEFAULT_YAML_TITLE_BACKGROUND,
      sizeRem: `${DEFAULT_YAML_TITLE_SIZE}rem`,
    });
  });

  it('ignores an empty background and an invalid size', () => {
    expect(yamlFormattingValues({ titleBackground: '   ' })).toMatchObject({
      background: DEFAULT_YAML_TITLE_BACKGROUND,
    });
    for (const titleSize of [NaN, 0, -1, Infinity]) {
      expect(yamlFormattingValues({ titleSize })).toMatchObject({
        sizeRem: `${DEFAULT_YAML_TITLE_SIZE}rem`,
      });
    }
  });
});

describe('YAML formatting constants', () => {
  it('uses a body class the stylesheet can target', () => {
    expect(YAML_FORMATTING_BODY_CLASS).toBe('sw-yaml-formatting');
  });

  it('keeps the marker that identifies the retired snippet', () => {
    expect(YAML_FORMATTING_MARKER).toBe('Managed by ScholarWeft');
  });
});
