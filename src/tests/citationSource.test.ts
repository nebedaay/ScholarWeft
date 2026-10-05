/**
 * Unit tests for the consolidated DOM→source serializer and range replacement
 * that reading mode now uses (in place of the old per-shape pre-passes).
 */
import { domToCitationSource, replaceSourceRange } from '../citationSource';

describe('domToCitationSource', () => {
  it('serializes a citation wikilink anchor back to [[@key|alias]]', () => {
    const p = document.createElement('p');
    p.innerHTML =
      'see <a class="internal-link" data-href="@smith2005" href="@smith2005">see also @, p. 5</a> now';
    expect(domToCitationSource(p).text).toBe(
      'see [[@smith2005|see also @, p. 5]] now'
    );
  });

  it('collapses a bare-key anchor to [[@key]]', () => {
    const p = document.createElement('p');
    p.innerHTML =
      '<a class="internal-link" data-href="@smith2005" href="@smith2005">@smith2005</a>';
    expect(domToCitationSource(p).text).toBe('[[@smith2005]]');
  });

  it('serializes emphasis, strong and code', () => {
    const p = document.createElement('p');
    p.innerHTML =
      '[@k, p. 1 and <em>passim</em>] <strong>bold</strong> <code>[@notacite]</code>';
    expect(domToCitationSource(p).text).toBe(
      '[@k, p. 1 and *passim*] **bold** `[@notacite]`'
    );
  });

  it('recurses through transparent wrapper elements', () => {
    const p = document.createElement('p');
    p.innerHTML = '<span>[@a]</span><div>[@b]</div>';
    expect(domToCitationSource(p).text).toBe('[@a][@b]');
  });

  it('skips the plugin’s own output spans', () => {
    const p = document.createElement('p');
    p.innerHTML =
      'x <span class="sw-citation" data-citekey="a">(A 2000)</span> y';
    expect(domToCitationSource(p).text).toBe('x  y');
  });

  it('leaves a non-citation wikilink as its text (not a citation)', () => {
    const p = document.createElement('p');
    p.innerHTML =
      '<a class="internal-link" data-href="Some Note" href="Some Note">Some Note</a>';
    expect(domToCitationSource(p).text).toBe('Some Note');
  });
});

describe('replaceSourceRange', () => {
  const replace = (p: HTMLElement, from: number, to: number, text: string) => {
    const { chunks } = domToCitationSource(p);
    const span = document.createElement('span');
    span.textContent = text;
    return replaceSourceRange(p, chunks, from, to, span);
  };

  it('replaces a whole text node', () => {
    const p = document.createElement('p');
    p.textContent = 'before [@a] after';
    expect(replace(p, 7, 11, 'X')).toBe(true);
    expect(p.textContent).toBe('before X after');
  });

  it('splits a text node at both boundaries', () => {
    const p = document.createElement('p');
    p.textContent = 'before [@a] after';
    expect(replace(p, 9, 10, 'X')).toBe(true);
    expect(p.textContent).toBe('before [@X] after');
  });

  it('replaces a range spanning multiple nodes', () => {
    const p = document.createElement('p');
    p.innerHTML = 'a <em>b</em> c';
    // text = "a *b* c"; replace "[*b*]" -> the em plus the space around
    const { text, chunks } = domToCitationSource(p);
    expect(text).toBe('a *b* c');
    const span = document.createElement('span');
    span.textContent = 'X';
    expect(replaceSourceRange(p, chunks, 2, 5, span)).toBe(true);
    expect(p.textContent).toBe('a X c');
  });
});
