import { formatImportSummary, IMPORT_SUMMARY_MAX } from '../import-summary';

describe('formatImportSummary()', () => {
  it('names a single imported note', () => {
    expect(formatImportSummary(['@a'])).toBe('Imported 1 literature note: @a');
  });

  it('lists several notes', () => {
    expect(formatImportSummary(['@a', '@b'])).toBe(
      'Imported 2 literature notes: @a, @b'
    );
  });

  it('collapses a long list to "and N other notes"', () => {
    const names = Array.from({ length: IMPORT_SUMMARY_MAX + 3 }, (_, i) => `@k${i}`);
    const s = formatImportSummary(names);
    expect(s.startsWith(`Imported ${names.length} literature notes: `)).toBe(true);
    expect(s).toContain(' and 3 other notes');
    expect(s).not.toContain('@k20');
  });

  it('handles an empty run', () => {
    expect(formatImportSummary([])).toBe('No literature notes were imported.');
  });
});
