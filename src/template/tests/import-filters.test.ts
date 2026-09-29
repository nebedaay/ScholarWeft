import {
  countPassing,
  defaultFilters,
  flagsFromChildren,
  passesImportFilters,
  type ImportFilters,
} from '../import-filters';

const flags = (o: Partial<ReturnType<typeof flagsFromChildren>>) => ({
  hasNotes: false,
  hasAttachment: false,
  hasAnnotations: false,
  hasLitNote: false,
  ...o,
});

describe('defaultFilters()', () => {
  it('starts with only "without a literature note" checked', () => {
    expect(defaultFilters()).toEqual({
      hasNotes: false,
      hasAttachment: false,
      hasAnnotations: false,
      withoutLitNote: true,
    });
  });
});

describe('passesImportFilters()', () => {
  const base = defaultFilters();

  it('with only the default, keeps items lacking a note', () => {
    expect(passesImportFilters(flags({ hasLitNote: false }), base)).toBe(true);
    expect(passesImportFilters(flags({ hasLitNote: true }), base)).toBe(false);
  });

  it('unchecking "without a note" stops excluding existing notes', () => {
    const f: ImportFilters = { ...base, withoutLitNote: false };
    expect(passesImportFilters(flags({ hasLitNote: true }), f)).toBe(true);
  });

  it('ANDs the positive filters', () => {
    const f: ImportFilters = { ...base, hasAnnotations: true, hasAttachment: true };
    expect(passesImportFilters(flags({ hasAnnotations: true, hasAttachment: true }), f)).toBe(true);
    expect(passesImportFilters(flags({ hasAnnotations: true, hasAttachment: false }), f)).toBe(false);
    expect(passesImportFilters(flags({ hasAnnotations: false, hasAttachment: true }), f)).toBe(false);
  });

  it('each positive filter is a no-op when disabled', () => {
    const f: ImportFilters = { ...base, hasNotes: true };
    expect(passesImportFilters(flags({ hasNotes: false }), f)).toBe(false);
    expect(passesImportFilters(flags({ hasNotes: false }), { ...base, hasNotes: false })).toBe(true);
  });
});

describe('flagsFromChildren()', () => {
  it('detects pdf and html as attachments; other types do not count', () => {
    expect(flagsFromChildren({ attachments: [{ contentType: 'application/pdf' }] }, false).hasAttachment).toBe(true);
    expect(flagsFromChildren({ attachments: [{ contentType: 'text/html' }] }, false).hasAttachment).toBe(true);
    expect(flagsFromChildren({ attachments: [{ contentType: 'image/png' }] }, false).hasAttachment).toBe(false);
    expect(flagsFromChildren({}, false).hasAttachment).toBe(false);
  });

  it('detects notes and annotations', () => {
    expect(flagsFromChildren({ notes: [1] }, false).hasNotes).toBe(true);
    expect(flagsFromChildren({ annotations: [1] }, false).hasAnnotations).toBe(true);
    expect(flagsFromChildren(null, false)).toMatchObject({ hasNotes: false, hasAnnotations: false });
  });

  it('carries the literature-note flag through', () => {
    expect(flagsFromChildren({}, true).hasLitNote).toBe(true);
  });
});

describe('countPassing()', () => {
  it('counts items satisfying the filters', () => {
    const items = [flags({ hasLitNote: false }), flags({ hasLitNote: true }), flags({})];
    expect(countPassing(items, (x) => x, defaultFilters())).toBe(2);
  });
});
