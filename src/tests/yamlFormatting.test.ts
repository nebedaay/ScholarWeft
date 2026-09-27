import {
  buildYamlFormattingCss,
  DEFAULT_YAML_TITLE_BACKGROUND,
  DEFAULT_YAML_TITLE_SIZE,
  YAML_FORMATTING_MARKER,
} from '../yamlFormatting';

describe('buildYamlFormattingCss', () => {
  it('substitutes the configured values', () => {
    const css = buildYamlFormattingCss({
      titleBackground: '#123456',
      titleSize: 1.5,
    });
    expect(css).toContain('--title-background: #123456;');
    expect(css).toContain('--title-size: 1.5rem;');
  });

  it('falls back to the defaults', () => {
    const css = buildYamlFormattingCss();
    expect(css).toContain(
      `--title-background: ${DEFAULT_YAML_TITLE_BACKGROUND};`
    );
    expect(css).toContain(`--title-size: ${DEFAULT_YAML_TITLE_SIZE}rem;`);
  });

  it('ignores an empty or invalid size', () => {
    expect(buildYamlFormattingCss({ titleSize: NaN })).toContain(
      `--title-size: ${DEFAULT_YAML_TITLE_SIZE}rem;`
    );
    expect(buildYamlFormattingCss({ titleSize: 0 })).toContain(
      `--title-size: ${DEFAULT_YAML_TITLE_SIZE}rem;`
    );
  });

  it('keeps the W3C CSS @function helpers (do not strip them)', () => {
    const css = buildYamlFormattingCss();
    expect(css).toContain('@function --arrow-gradient(--hue)');
    expect(css).toContain('@function --dashboard-gradient(--hue)');
  });

  it('marks the file as plugin-generated', () => {
    expect(buildYamlFormattingCss()).toContain(YAML_FORMATTING_MARKER);
  });

  it('is well-formed CSS (balanced braces, no stray opening brace)', () => {
    const css = buildYamlFormattingCss();
    const open = (css.match(/\{/g) ?? []).length;
    const close = (css.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
    expect(css).not.toMatch(/\{\s*\{/);
  });
});
