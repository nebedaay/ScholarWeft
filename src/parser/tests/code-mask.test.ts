import { maskCodeRegions } from '../code-mask';
import { getCitationSegments } from '../parser';

describe('maskCodeRegions()', () => {
  it('masks an inline code span, preserving length', () => {
    const src = 'see `@key` here';
    const out = maskCodeRegions(src);
    expect(out).toHaveLength(src.length);
    expect(out).not.toContain('@');
    expect(out.startsWith('see')).toBe(true);
    expect(out.endsWith('here')).toBe(true);
  });

  it('masks a fenced block, keeping the surrounding text', () => {
    const src = 'before\n```\n@key [[@other]]\n```\nafter';
    const out = maskCodeRegions(src);
    expect(out).toHaveLength(src.length);
    expect(out).not.toContain('@');
    expect(out.startsWith('before')).toBe(true);
    expect(out.endsWith('after')).toBe(true);
  });

  it('masks tilde fences too', () => {
    const src = '~~~\n@x\n~~~';
    expect(maskCodeRegions(src)).not.toContain('@');
  });

  it('handles doubled backticks containing a single backtick', () => {
    const src = '``a ` b`` @keep';
    const out = maskCodeRegions(src);
    expect(out).not.toContain('`');
    expect(out).toContain('@keep');
  });

  it('leaves an unmatched backtick untouched', () => {
    const src = 'a ` b @key';
    expect(maskCodeRegions(src)).toBe(src);
  });

  it('is a no-op without backticks or tilde fences', () => {
    const src = 'plain [[@key]] text';
    expect(maskCodeRegions(src)).toBe(src);
  });
});

describe('getCitationSegments() skips code', () => {
  const keys = (text: string) =>
    getCitationSegments(text, false, true).flatMap((g) =>
      g.filter((s) => s.type === 'key').map((s) => s.val)
    );

  it('ignores a citekey in inline code', () => {
    expect(keys('real [[@a]] but `@b` code')).toEqual(['a']);
  });

  it('ignores citekeys inside a fenced block', () => {
    expect(keys('[[@a]]\n```\n@b\n[[@c]]\n```\n[@d]')).toEqual(['a', 'd']);
  });
});
