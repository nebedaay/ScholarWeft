/**
 * Reading-mode regression: narrative + adjacent linked citations must merge
 * into ONE citation span (matching live preview), not fall back to literal
 * alias text.
 */
jest.mock(
  'obsidian',
  () => ({ parseYaml: (s: string) => JSON.parse(s), TFile: class TFile {} }),
  { virtual: true }
);

beforeAll(() => {
  (HTMLElement.prototype as any).hasClass = function (cls: string) {
    return this.classList.contains(cls);
  };
  (HTMLElement.prototype as any).addClass = function (cls: string) {
    this.classList.add(cls);
  };
  (globalThis as any).createFragment = () => {
    const frag = document.createDocumentFragment() as any;
    frag.appendText = (t: string) =>
      frag.appendChild(document.createTextNode(t));
    frag.createSpan = (o: any) => {
      const s = document.createElement('span');
      if (o?.cls) s.className = o.cls;
      if (o?.text != null) s.textContent = o.text;
      if (o?.attr) for (const [k, v] of Object.entries(o.attr)) s.setAttribute(k, v as string);
      frag.appendChild(s);
      return s;
    };
    return frag;
  };
});

jest.mock('../zotlit', () => ({
  getLitNoteForCitekey: jest.fn((): undefined => undefined),
}));

import { processCiteKeys } from '../markdownPostprocessor';
import { getCitationSegments, getCitations } from '../parser/parser';

/** Run the postprocessor with a cache built from `src` (or empty, to simulate
 *  a render that beats the bibManager cache). Returns the element plus the
 *  plugin mock so tests can assert on the render-trigger call. */
function render(
  src: string,
  html: string,
  emptyCache = false,
  sectionEmpty = false
): { el: HTMLElement; plugin: any } {
  const el = document.createElement('p');
  el.innerHTML = html;
  document.body.appendChild(el);
  const citations = emptyCache
    ? []
    : getCitationSegments(src, false, true).map((g) => getCitations(g));
  const plugin: any = {
    settings: {
      renderLinkCitations: true,
      renderCitationsAsLinks: true,
      renderCitationsReadingMode: true,
      formatLinkAliases: true,
    },
    app: {},
    tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
    requestPostProcessRender: jest.fn(),
    bibManager: {
      getCacheForPath: () => (emptyCache ? null : { citations }),
      // `sectionEmpty` models Obsidian's getSectionInfo disagreeing with
      // metadataCache.sections: the section-scoped list comes back empty while
      // the whole-file cache is populated.
      getCitationsForSection: () => (sectionEmpty ? [] : citations),
      getResolution: () => undefined,
    },
  };
  processCiteKeys(plugin)(el, {
    sourcePath: 't.md',
    getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
  } as any);
  return { el, plugin };
}

const a = (key: string, text: string) =>
  `<a class="internal-link" data-href="@${key}" href="@${key}">${text}</a>`;

describe('reading mode: narrative + adjacent', () => {
  it('narrative [[@d|@ -]] + [[@f|see also @]]', () => {
    const src = 'As argued by [[@d|@ -]] [[@f|see also @]],';
    const { el, plugin } = render(src, `As argued by ${a('d', '@ -')} ${a('f', 'see also @')},`);
    // eslint-disable-next-line no-console
    console.log('R1 ' + JSON.stringify(el.textContent) + ' spans=' + el.querySelectorAll('span.sw-citation').length);
    expect(el.textContent).not.toContain('@ -');
    expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
    // A warm cache means no render trigger is needed.
    expect(plugin.requestPostProcessRender).not.toHaveBeenCalled();
  });

  it('narrative with body [[@f|@ p. 15 -]] + [[@s|see also @]]', () => {
    const src = '[[@f|@ p. 15 -]] [[@s|see also @]]';
    const { el } = render(src, `${a('f', '@ p. 15 -')} ${a('s', 'see also @')}`);
    // eslint-disable-next-line no-console
    console.log('R2 ' + JSON.stringify(el.textContent) + ' spans=' + el.querySelectorAll('span.sw-citation').length);
    expect(el.textContent).not.toContain('p. 15 -');
    expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
  });

  it('preserves child order when wrapping content into the anchor', () => {
    // Regression: `while (span.firstChild) a.insertBefore(span.firstChild,
    // a.firstChild)` REVERSED the children, so a citation rendered as
    // [text, <em>, text] came out backwards (`)others(…`). The anchor must keep
    // source order.
    const el = document.createElement('p');
    el.innerHTML = '[@key, p. 15 and *more*]';
    document.body.appendChild(el);
    const cache = getCitationSegments('[@key, p. 15 and *more*]', false, true).map(
      (g) => ({ ...getCitations(g), val: '(A 2000, 15 and <em>more</em>)' })
    );
    const plugin: any = {
      settings: {
        renderLinkCitations: true,
        renderCitationsAsLinks: true,
        renderCitationsReadingMode: true,
        formatLinkAliases: true,
      },
      app: {},
      tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
      requestPostProcessRender: jest.fn(),
      bibManager: {
        getCacheForPath: () => ({ citations: cache }),
        getCitationsForSection: () => cache,
        getResolution: () => undefined,
      },
    };
    processCiteKeys(plugin)(el, {
      sourcePath: 't.md',
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
    } as any);

    const span = el.querySelector('span.sw-citation') as HTMLElement;
    expect(span).not.toBeNull();
    // The anchor must contain the children in the ORDER given.
    expect(span!.textContent).toBe('(A 2000, 15 and more)');
    const a = span!.querySelector('a.internal-link') as HTMLElement;
    const kids = Array.from(a.childNodes).map((n) => n.textContent ?? '');
    expect(kids).toEqual(['(A 2000, 15 and ', 'more', ')']);
    // And the emphasis element sits between the two text runs, not reversed.
    expect(a.childNodes[1].nodeName).toBe('EM');
  });

  it('renders a plain [@…] split by inline emphasis (no node holds the ])', () => {
    // Reading mode renders `*passim*` as <em>passim</em>, splitting the `[@…]`
    // so no single text node contains the closing `]`. Without reconstruction
    // the citation can never render.
    const cases: [string, string][] = [
      [
        '[@foucaultSubjectPower2000, p. i–iv, vol. 2–6, chapter 10–13 and *passim*]',
        '[@foucaultSubjectPower2000, p. i–iv, vol. 2–6, chapter 10–13 and <em>passim</em>]',
      ],
      [
        '[@dianteillPierreBourdieu2003, p. 25 and *passim*]',
        '[@dianteillPierreBourdieu2003, p. 25 and <em>passim</em>]',
      ],
      [
        '[@foucaultSubjectPower2000, vol. 1, p. i–iv, chap. 2–6 and *passim*]',
        '[@foucaultSubjectPower2000, vol. 1, p. i–iv, chap. 2–6 and <em>passim</em>]',
      ],
      [
        '[@key, p. 15 and **bold**]',
        '[@key, p. 15 and <strong>bold</strong>]',
      ],
    ];
    for (const [src, html] of cases) {
      const { el } = render(src, html);
      expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
      expect(el.textContent).not.toContain('[@');
    }
  });

  it('adjacent linked run with no cache match triggers a per-file render', () => {
    // Two adjacent linked citations that SHOULD merge into one group, but the
    // cache has no matching citation (build/timing gap). The pre-pass must ask
    // for a rebuild instead of silently degrading to per-segment output.
    const el = document.createElement('p');
    el.innerHTML =
      'Linked format: <a class="internal-link" data-href="@foucaultSubjectPower2000" href="@foucaultSubjectPower2000">@ p. 15 -</a> <a class="internal-link" data-href="@swartzCulturePower1998" href="@swartzCulturePower1998">see also @</a>';
    document.body.appendChild(el);
    const plugin: any = {
      settings: {
        renderLinkCitations: true,
        renderCitationsAsLinks: true,
        renderCitationsReadingMode: true,
        formatLinkAliases: true,
      },
      app: {},
      tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
      requestPostProcessRender: jest.fn(),
      bibManager: {
        // Cache present but WITHOUT the merged group → findRendered misses.
        getCacheForPath: () => ({ citations: [] }),
        getCitationsForSection: () => [],
        getResolution: () => undefined,
      },
    };
    processCiteKeys(plugin)(el, {
      sourcePath: 't.md',
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
    } as any);
    expect(plugin.requestPostProcessRender).toHaveBeenCalledWith('t.md');
  });

  it('merges adjacent linked citations even when wrapped in separate elements', () => {
    // Obsidian may wrap anchors so they are not direct siblings; the run scan
    // must still merge them (this is the shape that reported `citeAnchors= 2`
    // but never merged — anchors separated by an element boundary).
    const el = document.createElement('p');
    el.innerHTML =
      'Linked format: <span><a class="internal-link" data-href="@foucaultSubjectPower2000" href="@foucaultSubjectPower2000">@ p. 15 -</a></span> <span><a class="internal-link" data-href="@swartzCulturePower1998" href="@swartzCulturePower1998">see also @</a></span>';
    document.body.appendChild(el);
    const src =
      'Linked format: [[@foucaultSubjectPower2000|@ p. 15 -]] [[@swartzCulturePower1998|see also @]]';
    const cache = getCitationSegments(src, false, true).map((g) => ({
      ...getCitations(g),
      val: 'VAL',
    }));
    const plugin: any = {
      settings: {
        renderLinkCitations: true,
        renderCitationsAsLinks: true,
        renderCitationsReadingMode: true,
        formatLinkAliases: true,
      },
      app: {},
      tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
      requestPostProcessRender: jest.fn(),
      bibManager: {
        getCacheForPath: () => ({ citations: cache }),
        getCitationsForSection: () => cache,
        getResolution: () => undefined,
      },
    };
    processCiteKeys(plugin)(el, {
      sourcePath: 't.md',
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
    } as any);
    const spans = el.querySelectorAll('span.sw-citation');
    expect(spans.length).toBe(1);
    expect(spans[0].getAttribute('data-citekey')).toBe(
      'foucaultSubjectPower2000|swartzCulturePower1998'
    );
  });

  it('reference run renders ONLY references, leaving no citation leftovers', () => {
    // `[[@a|ref]] [[@b]] [[@c]]` is a reference list (any `ref` member makes the
    // whole run references). Previously only the `|ref` anchor was removed, so
    // the other two re-rendered as citations afterwards.
    const el = document.createElement('p');
    el.innerHTML =
      '<a class="internal-link" data-href="@a" href="@a">ref</a> <a class="internal-link" data-href="@b" href="@b">@b</a> <a class="internal-link" data-href="@c" href="@c">@c</a>';
    document.body.appendChild(el);
    const src = '[[@a|ref]] [[@b]] [[@c]]';
    const cache = getCitationSegments(src, false, true).map((g) => ({
      ...getCitations(g),
      val: 'REF',
    }));
    const plugin: any = {
      settings: {
        renderLinkCitations: true,
        renderCitationsAsLinks: true,
        renderCitationsReadingMode: true,
        formatLinkAliases: true,
      },
      app: {},
      tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
      requestPostProcessRender: jest.fn(),
      bibManager: {
        getCacheForPath: () => ({ citations: cache }),
        getCitationsForSection: () => cache,
        getResolution: () => undefined,
      },
    };
    processCiteKeys(plugin)(el, {
      sourcePath: 't.md',
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
    } as any);
    // Exactly one reference span, no leftover citation span, no stray anchors.
    expect(el.querySelectorAll('span.sw-reference').length).toBe(1);
    expect(el.querySelectorAll('span.sw-citation').length).toBe(0);
    expect(el.querySelectorAll('a.internal-link').length).toBe(0);
  });

  it('composes @author [bracket] with emphasis split across nodes', () => {
    // Reading mode DOM: text "@leezenbergFoucaultIran [@…, p. 25 and " +
    // <em>passim</em> + "]". The cache holds the COMPOSED pair
    // ({@key, composite}, {@other, locator}); the reconstruction must include
    // the leading bare @key or findRendered won't match.
    const el = document.createElement('p');
    el.appendChild(
      document.createTextNode(
        '@leezenbergFoucaultIran [@dianteillPierreBourdieu2003, p. 25 and '
      )
    );
    const em = document.createElement('em');
    em.textContent = 'passim';
    el.appendChild(em);
    el.appendChild(document.createTextNode(']'));
    document.body.appendChild(el);
    const src =
      '@leezenbergFoucaultIran [@dianteillPierreBourdieu2003, p. 25 and *passim*]';
    const cache = getCitationSegments(src, false, true).map((g) => ({
      ...getCitations(g),
      val: 'VAL',
    }));
    const plugin: any = {
      settings: {
        renderLinkCitations: true,
        renderCitationsAsLinks: true,
        renderCitationsReadingMode: true,
        formatLinkAliases: true,
      },
      app: {},
      tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
      requestPostProcessRender: jest.fn(),
      bibManager: {
        getCacheForPath: () => ({ citations: cache }),
        getCitationsForSection: () => cache,
        getResolution: () => undefined,
      },
    };
    processCiteKeys(plugin)(el, {
      sourcePath: 't.md',
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
    } as any);
    expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
    expect(el.textContent).not.toContain('[@dianteillPierreBourdieu2003');
  });

  it('leaves prose after a bare @key as text (pandoc AuthorInText)', () => {
    // Pandoc: `@smith, p. 5` is AuthorInText with citationSuffix = [] — the
    // `, p. 5` is ordinary prose, NOT a locator. Our group is only `@smith`, so
    // the trailing text must survive.
    const src = '@smith, p. 5';
    const { el } = render(src, '@smith, p. 5');
    expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
    expect(el.textContent).toContain(', p. 5');
  });

  it('with an EMPTY cache (render beat the bibManager) — triggers a per-file render', () => {
    const src = 'As argued by [[@d|@ -]] [[@f|see also @]],';
    const { el, plugin } = render(src, `As argued by ${a('d', '@ -')} ${a('f', 'see also @')},`, true);
    // eslint-disable-next-line no-console
    console.log('R3-empty ' + JSON.stringify(el.textContent));
    // The cache was absent, so the post-processor must ask the plugin to build
    // it for this exact file; the rebuild re-renders the note.
    expect(plugin.requestPostProcessRender).toHaveBeenCalledTimes(1);
    expect(plugin.requestPostProcessRender).toHaveBeenCalledWith('t.md');
  });

  it('falls back to the whole-file cache when the SECTION list is empty', () => {
    // Obsidian's getSectionInfo and metadataCache.sections can disagree, so one
    // section comes back with no citations while the whole-file cache is fine.
    // The fallback below uses the file cache, so the citation still renders
    // (no re-render needed).
    const src = '[@key, p. 15]';
    const { el, plugin } = render(src, '[@key, p. 15]', false, true);
    expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
    expect(plugin.requestPostProcessRender).not.toHaveBeenCalled();
  });

  it('matches a citation whose reconstructed segments differ by one entry', () => {
    // The reading-mode reconstruction can drop/alter a trailing segment (e.g. a
    // label suffix) versus what getReferenceList parsed from the raw source.
    // The identity fallback must still find the cached citation and render it.
    const el = document.createElement('p');
    el.innerHTML = '[@key, p. 15]';
    document.body.appendChild(el);
    const cached = getCitationSegments(
      '[@key, p. 15 and more]',
      false,
      true
    ).map((g) => getCitations(g));
    const plugin: any = {
      settings: {
        renderLinkCitations: true,
        renderCitationsAsLinks: true,
        renderCitationsReadingMode: true,
        formatLinkAliases: true,
      },
      app: {},
      tooltipManager: { bindPreviewTooltipHandler: jest.fn() },
      requestPostProcessRender: jest.fn(),
      bibManager: {
        getCacheForPath: () => ({ citations: cached }),
        getCitationsForSection: () => cached,
        getResolution: () => undefined,
      },
    };
    processCiteKeys(plugin)(el, {
      sourcePath: 't.md',
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 1 }),
    } as any);
    expect(el.querySelectorAll('span.sw-citation').length).toBe(1);
    expect(el.textContent).not.toContain('[@key');
  });
});
