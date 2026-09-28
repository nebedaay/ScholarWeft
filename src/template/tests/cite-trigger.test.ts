import {
  DOUBLE_AT_PREFIX,
  detectCitationTrigger,
  isWordStartBefore,
  triggerQueryText,
} from '../cite-trigger';

describe('isWordStartBefore()', () => {
  it('accepts start-of-line, whitespace and opening punctuation', () => {
    for (const c of [undefined, '', ' ', '\t', '[', '(', ';', ',', '-', '|']) {
      expect(isWordStartBefore(c)).toBe(true);
    }
  });

  it('rejects letters, numbers and stray symbols (email@, %$#@)', () => {
    for (const c of ['a', 'Z', '1', '%', '$', '#', '`', '"', '@']) {
      expect(isWordStartBefore(c)).toBe(false);
    }
  });
});

describe('detectCitationTrigger()', () => {
  it('matches a bare @ and @@ with an empty query', () => {
    expect(detectCitationTrigger('@')).toEqual({
      atPos: 0,
      query: '',
      isDoubleAt: false,
    });
    expect(detectCitationTrigger('@@')).toEqual({
      atPos: 0,
      query: DOUBLE_AT_PREFIX,
      isDoubleAt: true,
    });
    expect(detectCitationTrigger('text @')).toMatchObject({
      atPos: 5,
      isDoubleAt: false,
      query: '',
    });
  });

  it('matches the bracket forms with an empty query', () => {
    expect(detectCitationTrigger('[@')).toMatchObject({ atPos: 1, isDoubleAt: false });
    expect(detectCitationTrigger('[[@')).toMatchObject({ atPos: 2, isDoubleAt: false });
    expect(detectCitationTrigger('[@@')).toMatchObject({ atPos: 1, isDoubleAt: true });
    expect(detectCitationTrigger('[[@@')).toMatchObject({ atPos: 2, isDoubleAt: true });
  });

  it('captures the query text', () => {
    expect(detectCitationTrigger('@smi')).toMatchObject({ atPos: 0, query: 'smi' });
    expect(detectCitationTrigger('[@smi')).toMatchObject({ atPos: 1, query: 'smi' });
    const dbl = detectCitationTrigger('@@social critique');
    expect(dbl).toMatchObject({ atPos: 0, isDoubleAt: true });
    expect(triggerQueryText(dbl!)).toBe('social critique');
  });

  it('rejects an @ inside a word or after stray symbols', () => {
    expect(detectCitationTrigger('email@')).toBeNull();
    expect(detectCitationTrigger('%$#@')).toBeNull();
    expect(detectCitationTrigger('foo@bar')).toBeNull();
  });

  it('honours the minimum-characters setting', () => {
    expect(detectCitationTrigger('@', { minChars: 1 })).toBeNull();
    expect(detectCitationTrigger('@a', { minChars: 1 })).toMatchObject({ query: 'a' });
    expect(detectCitationTrigger('@ab', { minChars: 2 })).toMatchObject({ query: 'ab' });
    expect(detectCitationTrigger('@@', { minChars: 1 })).toBeNull();
    expect(detectCitationTrigger('[[@', { minChars: 1 })).toBeNull();
    expect(detectCitationTrigger('[[@ab', { minChars: 2 })).toMatchObject({ query: 'ab' });
  });

  it('does not trigger once a space ends the token', () => {
    expect(detectCitationTrigger('@key ')).toBeNull();
  });
});
