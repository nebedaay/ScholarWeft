import { MarkdownPostProcessorContext, TFile } from 'obsidian';

import ReferenceList from './main';
import {
  Segment,
  SegmentType,
  RenderedCitation,
  getCitationSegments,
} from './parser/parser';
import { getLitNoteForCitekey } from './zotlit';
import { domToCitationSource, replaceSourceRange } from './citationSource';
import { matchRendered } from './citationMatch';
import {
  citationSpanClass,
  citationSpanAttributes,
  renderCitationContent,
} from './citationRender';

function getCiteClass(isResolved: boolean, isUnresolved: boolean) {
  const cls = ['sw-citation'];
  if (isResolved) cls.push('is-resolved');
  if (isUnresolved) cls.push('is-unresolved');

  return cls.join(' ');
}

// Obsidian renders footnotes in a <section data-footnotes> element.
// The post-processor is called for that element but getSectionInfo returns
// null because footnotes have no direct line correspondence in the source.
// Detect this case so we can still process citations inside footnotes.
function isFootnoteSection(el: HTMLElement): boolean {
  return !!(
    el.dataset?.footnotes !== undefined ||
    el.closest('[data-footnotes]') ||
    el.hasClass('footnotes')
  );
}

// Obsidian renders callouts (> [!type] …) in Live Preview via a NESTED
// markdown render: the callout body is a separate render context, so the
// post-processor IS called for it but getSectionInfo() returns null (no line
// correspondence — confirmed upstream bug report, obsidian#104289). In
// reading mode getSectionInfo returns the whole-callout range, which is fine.
// Detect callout content so we fall back to the full-file cache instead of
// bailing out (same pattern as footnotes).
function isCalloutSection(el: HTMLElement): boolean {
  return (
    el.hasClass('callout') ||
    !!el.closest('.callout') ||
    !!el.closest('blockquote.callout') ||
    (el.parentElement?.hasClass('callout-content') ?? false)
  );
}

/**
 * Build the reading-mode DOM for a full-reference insertion: one
 * `.sw-reference-entry` per cited work, each holding the formatted CSL entry.
 * The content (and the span class/attributes) come from the SHARED
 * `citationRender` module, so reading mode and live preview are identical.
 */
function buildCitationSpan(
  plugin: ReferenceList,
  rendered: RenderedCitation,
  ctx: MarkdownPostProcessorContext,
  sourceText?: Node
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = citationSpanClass(rendered);
  for (const [k, v] of Object.entries(
    citationSpanAttributes(rendered, ctx.sourcePath)
  )) {
    span.setAttribute(k, v);
  }

  // Reference groups resolve each entry's `.csl-entry` from the bibliography.
  let referenceHtml: (Element | null)[] | undefined;
  if (rendered.reference) {
    const abstract = plugin.app?.vault?.getAbstractFileByPath?.(ctx.sourcePath);
    const file =
      typeof TFile === 'function' && abstract instanceof TFile ? abstract : null;
    referenceHtml = rendered.citations.map((c) =>
      file ? plugin.bibManager.getBibForCiteKey(file, c.id) : null
    );
  }

  span.appendChild(
    renderCitationContent({
      cite: rendered,
      referenceHtml,
      sourceText,
      useSourceText: !plugin.settings.renderCitationsReadingMode,
    })
  );

  // Reference insertions are not links and carry no tooltip.
  if (!rendered.reference) {
    // If "link citations to literature notes" is on, wrap the content in an
    // <a class="internal-link"> so Obsidian's own reading-mode click handler
    // navigates to the note. `appendChild` preserves child order —
    // `insertBefore(c, a.firstChild)` in a loop REVERSES the children.
    if (plugin.settings.renderCitationsAsLinks && rendered.citations.length) {
      const citekey = rendered.citations[0].id;
      const resolved = getLitNoteForCitekey(citekey, ctx.sourcePath, plugin.app);
      const linkTarget = resolved?.linkText ?? '@' + citekey;
      span.classList.add('is-link');
      const a = document.createElement('a');
      a.className = 'internal-link';
      a.setAttribute('data-href', linkTarget);
      a.setAttribute('href', linkTarget);
      while (span.firstChild) a.appendChild(span.firstChild);
      span.appendChild(a);
    }
    plugin.tooltipManager.bindPreviewTooltipHandler(span);
  }

  return span;
}

/**
 * Per-segment fallback used when a parsed citation has no rendered match
 * (unresolved/unimported): render each segment with its status class, matching
 * the live-preview decoration classes.
 */
function buildFallbackFragment(
  plugin: ReferenceList,
  ctx: MarkdownPostProcessorContext,
  match: Segment[],
  text: string,
  from: number,
  to: number
): DocumentFragment {
  const frag = createFragment();
  let pos = from;
  for (let i = 0; i < match.length; i++) {
    const part = match[i];
    const next = match[i + 1];
    frag.appendText(text.substring(pos, part.from));
    pos = part.to;

    switch (part.type) {
      case SegmentType.key: {
        const { isResolved, isUnresolved } =
          plugin.bibManager.getResolution(ctx.sourcePath, part.val) || {
            isResolved: false,
            isUnresolved: false,
          };
        frag.createSpan({
          cls: getCiteClass(isResolved, isUnresolved),
          text: part.val,
          attr: { 'data-citekey': part.val, 'data-source': ctx.sourcePath },
        });
        continue;
      }
      case SegmentType.at: {
        const { isResolved, isUnresolved } =
          plugin.bibManager.getResolution(ctx.sourcePath, next?.val) || {
            isResolved: false,
            isUnresolved: false,
          };
        const classes: string[] = [part.type];
        if (isUnresolved) classes.push('is-unresolved');
        if (isResolved) classes.push('is-resolved');
        frag.createSpan({
          cls: `sw-citation-formatting ${classes.join(' ')}`,
          text: part.val,
        });
        continue;
      }
      default:
        frag.createSpan({
          cls: `sw-citation-formatting ${part.type}`,
          text: part.val,
        });
    }
  }
  frag.appendText(text.substring(pos, to));
  return frag;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function processCiteKeys(plugin: ReferenceList) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const sectionInfo = ctx.getSectionInfo(el);
    const isFootnote = isFootnoteSection(el);
    const isCallout = isCalloutSection(el);

    // Callouts (live preview) and footnotes have no usable sectionInfo; the
    // whole-file cache is used for them instead.
    if (
      !sectionInfo &&
      !isCallout &&
      !el.hasClass('markdown-preview-view') &&
      !isFootnote
    ) {
      return;
    }

    const cache = plugin.bibManager.getCacheForPath(ctx.sourcePath);
    const sectionCites0 =
      sectionInfo && !isFootnote
        ? plugin.bibManager.getCitationsForSection(
            ctx.sourcePath,
            sectionInfo.lineStart,
            sectionInfo.lineEnd
          )
        : cache?.citations;
    // Obsidian's getSectionInfo and metadataCache.sections can disagree on
    // ranges, so fall back to the whole-file cache.
    const sectionCites =
      !sectionCites0?.length && cache?.citations?.length
        ? cache.citations
        : sectionCites0;

    if (!sectionCites?.length) {
      // Reading mode can render a note before bibManager has built that note's
      // citation cache. Ask the plugin to build the cache for THIS file; it
      // re-renders the note and the next pass finds the cached citations.
      // Loop-guarded per path inside the plugin.
      if (typeof plugin.requestPostProcessRender === 'function') {
        plugin.requestPostProcessRender(ctx.sourcePath);
      }
      return;
    }

    const candidates = [...sectionCites, ...(cache?.citations ?? [])];

    // ── The consolidated step ────────────────────────────────────────────────
    // Reconstruct the Markdown source from the DOM and run the SAME parser live
    // preview runs. All merging/composition (contiguous runs, `@author
    // [bracket]`, reference runs, `{}` overrides) then happens identically in
    // both modes — there is no reading-mode-specific citation logic left.
    //
    // Replacements are applied LAST-match-first, re-serializing between each so
    // offsets are always fresh. A replaced span carries the plugin's classes,
    // which `domToCitationSource` skips, so the loop converges.
    let guard = 0;
    for (;;) {
      if (guard++ > 10000) break;
      const { text, chunks } = domToCitationSource(el);
      const segments = getCitationSegments(
        text,
        !plugin.settings.renderLinkCitations,
        plugin.settings.formatLinkAliases
      );
      if (!segments.length) break;

      const match = segments[segments.length - 1];
      const from = match[0].from;
      const to = match[match.length - 1].to;
      const rendered = matchRendered(candidates, match);
      const replacement = rendered
        ? buildCitationSpan(
            plugin,
            rendered,
            ctx,
            document.createTextNode(text.slice(from, to))
          )
        : buildFallbackFragment(plugin, ctx, match, text, from, to);

      if (!replaceSourceRange(el, chunks, from, to, replacement)) break;
    }

    // A reference insertion on its own line is block-level content wrapped in
    // Obsidian's <p>. Mark such paragraphs so CSS can collapse the paragraph's
    // empty line box; inline references mixed with text are left untouched.
    el.querySelectorAll('.sw-reference').forEach((node) => {
      const span = node as HTMLElement;
      const p = span.closest('p');
      if (!p || p === el) return;
      const text = (span.textContent ?? '').trim();
      if (!text || (p.textContent ?? '').trim() !== text) return;
      if (
        Array.from(p.children).some(
          (c) => c !== span && (c.textContent ?? '').trim()
        )
      ) {
        return;
      }
      p.classList.add('sw-reference-paragraph');
    });
  };
}
