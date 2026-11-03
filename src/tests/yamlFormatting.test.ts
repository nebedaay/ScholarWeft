import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_YAML_TITLE_BACKGROUND,
  DEFAULT_YAML_TITLE_COLOR,
  DEFAULT_YAML_TITLE_SIZE,
  YAML_FORMATTING_BODY_CLASS,
  YAML_FORMATTING_MARKER,
  yamlFormattingValues,
} from '../yamlFormatting';

describe('yamlFormattingValues()', () => {
  it('uses the configured background and size', () => {
    expect(
      yamlFormattingValues({ titleBackground: '#123456', titleColor: '#ffffff', titleSize: 1.5 })
    ).toEqual({ background: '#123456', color: '#ffffff', sizeRem: '1.5rem' });
  });

  it('falls back to the defaults', () => {
    expect(yamlFormattingValues()).toEqual({
      background: DEFAULT_YAML_TITLE_BACKGROUND,
      color: DEFAULT_YAML_TITLE_COLOR,
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

  it('colours the inner metadata editor, not just its container', () => {
    const css = readFileSync(join(__dirname, '../../styles.css'), 'utf8');
    // Obsidian's own `.metadata-input-longtext` sets
    // `color: var(--metadata-input-text-color)`, so the container rule alone
    // leaves the title text unchanged.
    expect(css).toContain(
      '--metadata-input-text-color: var(--sw-yaml-title-color)'
    );
    expect(css).toContain('.metadata-input-longtext');
  });
});
