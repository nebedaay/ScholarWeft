/**
 * Full-reference insertion syntax:
 *
 *   [[@key|reference]]        -> bibliography entry for @key
 *   [[@key|ref]]              -> same (case-insensitive)
 *   [ [[@a|reference]] [[@b]] [[@c]] ] -> a list of three entries
 *
 * A reference group is still a citation (its keys reach the sidebar / citeproc
 * bibliography); it just renders the full entry instead of the in-text form.
 */
jest.mock('obsidian', () => ({ parseYaml: (s: string): any => JSON.parse(s) }), {
  virtual: true,
});
import {
  getCitationSegments,
  getCitations,
  mergeContainerExpression,
} from '../parser/parser';
import type { CitationSegments } from '../parser/parser';

const valTypes = (segs: CitationSegments[]): string[] =>
  segs.map((g) =>
    g.map((s) => s.type + ':' + s.val).join(',')
  );

describe('reference insertion syntax', () => {
  it('flags [[@key|reference]] as a reference group', () => {
    const segs = getCitationSegments('[[@smith|reference]]', false, true);
    expect(valTypes(segs)).toEqual([
      'bracket:[,at:@,key:smith,bracket:],reference:',
    ]);
    expect(segs[0].reference).toBe(true);
    expect(segs[0].referenceRange).toEqual([0, 20]);
    const group = getCitations(segs[0]);
    expect(group.reference).toBe(true);
    expect(group.citations.map((c) => c.id)).toEqual(['smith']);
  });

  it('accepts the ref abbreviation and any case', () => {
    for (const alias of ['ref', 'REF', 'Reference', ' reference ']) {
      const segs = getCitationSegments(`[[@smith|${alias}]]`, false, true);
      expect(segs).toHaveLength(1);
      expect(segs[0].reference).toBe(true);
    }
  });

  it('leaves other literal aliases alone', () => {
    // No '@' in the alias and not a reference marker -> stays a native
    // wikilink, so no citation group is produced at all.
    const segs = getCitationSegments('[[@smith|references]]', false, true);
    expect(segs).toHaveLength(0);
  });

  it('does not flag plain or ordinary alias citations', () => {
    const plain = getCitationSegments('[[@smith]]', false, true);
    expect(plain[0].reference).toBeUndefined();

    const aliased = getCitationSegments('[[@smith|see @, p. 5]]', false, true);
    expect(aliased[0].reference).toBeUndefined();
  });

  it('flags a bracket container with any reference member', () => {
    const segs = getCitationSegments(
      '[ [[@a|reference]] [[@b]] [[@c]] ]',
      false,
      true
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].reference).toBe(true);
    expect(getCitations(segs[0]).citations.map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not flag an all-citation container', () => {
    const segs = getCitationSegments('[ [[@a]] [[@b]] ]', false, true);
    expect(segs[0].reference).toBeUndefined();
  });

  it('flags a ⟦…⟧ multi-work container with a reference member', () => {
    const segs = getCitationSegments('⟦[[@a|reference]]; [[@b]]⟧', false, true);
    expect(segs).toHaveLength(1);
    expect(segs[0].reference).toBe(true);
    expect(getCitations(segs[0]).citations.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('a reference ⟦…⟧ container is permissive about between-member text', () => {
    for (const src of [
      '⟦[[@a|reference]] [[@b]]⟧',
      '⟦[[@a|reference]]; see also [[@b]]⟧',
      '⟦[[@a|ref]] and [[@b]] and [[@c]]⟧',
    ]) {
      const segs = getCitationSegments(src, false, true);
      expect(segs).toHaveLength(1);
      expect(segs[0].reference).toBe(true);
    }
  });

  it('a reference container discards plain-label members (uses their keys)', () => {
    const segs = getCitationSegments(
      "[ [[@a|reference]] [[@b|Smith's work]] ]",
      false,
      true
    );
    expect(segs).toHaveLength(1);
    expect(getCitations(segs[0]).citations.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('mergeContainerExpression reports reference containers', () => {
    expect(mergeContainerExpression('⟦[[@a|reference]]; [[@b]]⟧')).toMatchObject({
      expr: '[@a; @b]',
      members: [{ key: 'a' }, { key: 'b' }],
      reference: true,
    });
    expect(mergeContainerExpression('⟦[[@a]]; [[@b|ref]]⟧')).toMatchObject({
      expr: '[@a; @b]',
      reference: true,
    });
    expect(mergeContainerExpression('⟦[[@a]]; [[@b]]⟧')).toMatchObject({
      expr: '[@a; @b]',
      reference: false,
    });
    // Reference containers ignore between-member text entirely.
    expect(mergeContainerExpression('⟦[[@a|reference]] [[@b]]⟧')).toMatchObject({
      expr: '[@a; @b]',
      reference: true,
    });
    expect(
      mergeContainerExpression('⟦[[@a|reference]]; see [[@b]]⟧')
    ).toMatchObject({ expr: '[@a; @b]', reference: true });
  });

  it('mergeContainerExpression handles both delimiter forms', () => {
    expect(
      mergeContainerExpression('[ [[@a|reference]] [[@b]] ]')
    ).toMatchObject({ expr: '[@a; @b]', reference: true });
    expect(mergeContainerExpression('[ [[@a]]; [[@b]] ]')).toMatchObject({
      expr: '[@a; @b]',
      reference: false,
    });
    // Plain [@key] members and a single-member outer container.
    expect(mergeContainerExpression('[ [@a]; [@b, p. 5] ]')).toMatchObject({
      expr: '[@a; @b, p. 5]',
      reference: false,
    });
    expect(mergeContainerExpression('[ [[@a]] ]')).toMatchObject({
      expr: '[@a]',
      reference: false,
    });
    expect(mergeContainerExpression('[note]')).toBeNull();
    expect(mergeContainerExpression('[text](url)')).toBeNull();
  });
});
