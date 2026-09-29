import { appendHighlighted, highlightMatchesIn, MATCH_CLASS } from '../highlight';

function div(html = ''): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('appendHighlighted()', () => {
  it('wraps a matched term in a bold match element', () => {
    const el = div();
    appendHighlighted(el, 'Bourdieu, Pierre. 1984.', ['bourdieu']);
    expect(el.innerHTML).toBe(
      `<strong class="${MATCH_CLASS}">Bourdieu</strong>, Pierre. 1984.`
    );
  });

  it('emphasises every occurrence, not just the first', () => {
    const el = div();
    appendHighlighted(el, 'social and social', ['social']);
    expect(el.querySelectorAll(`.${MATCH_CLASS}`)).toHaveLength(2);
    expect(el.textContent).toBe('social and social');
  });

  it('appends plain text (no elements) when nothing matches', () => {
    const el = div();
    appendHighlighted(el, 'Bourdieu', ['xi']);
    expect(el.innerHTML).toBe('Bourdieu');
    expect(el.querySelector(`.${MATCH_CLASS}`)).toBeNull();
  });

  it('appends to existing content rather than replacing it', () => {
    const el = div('<span>pre</span>');
    appendHighlighted(el, 'Distinction', ['distinct']);
    expect(el.querySelector('span')!.textContent).toBe('pre');
    expect(el.querySelector(`.${MATCH_CLASS}`)!.textContent).toBe('Distinct');
  });
});

describe('highlightMatchesIn()', () => {
  it('bolds matches inside text nodes while preserving surrounding markup', () => {
    const root = div('<em>Distinction: A Social Critique</em>. Cambridge.');
    highlightMatchesIn(root, ['social']);

    // The italic wrapper survives; only the matched text is bold.
    expect(root.querySelector('em')).toBeTruthy();
    const strong = root.querySelector(`.${MATCH_CLASS}`)!;
    expect(strong.textContent).toBe('Social');
    expect(strong!.closest('em')).toBeTruthy();
  });

  it('walks multiple text nodes', () => {
    const root = div('<i>Distinction</i> and <i>Distinction</i>');
    highlightMatchesIn(root, ['distinction']);
    expect(root.querySelectorAll(`.${MATCH_CLASS}`)).toHaveLength(2);
  });

  it('is a no-op for empty terms', () => {
    const root = div('<i>Distinction</i>');
    highlightMatchesIn(root, []);
    expect(root.innerHTML).toBe('<i>Distinction</i>');
  });

  it('leaves the DOM untouched when nothing matches', () => {
    const root = div('<i>Distinction</i>. Cambridge.');
    const before = root.innerHTML;
    highlightMatchesIn(root, ['zzz']);
    expect(root.innerHTML).toBe(before);
  });
});
