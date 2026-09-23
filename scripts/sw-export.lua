-- sw-export.lua
--
-- ScholarWeft export filter. Runs in the --lua-filter chain and applies
-- the vault's document-formatting conventions before the docx/odt writer.
--
-- Reads YAML frontmatter and:
--   1. Selects the reference docx from the "template" property (default
--      "document"), mapped to Export Templates/<template>.docx.
--   2. Maps YAML properties to docx core properties (Author, Keywords, …);
--      missing values fall back to the template's own core-property defaults;
--      the export pipeline's merge step applies the author from plugin settings
--      when no YAML author is present.
--
-- Poetry callouts ([!poetry], [!arabic-poetry], …) are handled by the
-- optional sw-poetry.lua filter, which runs after this one.
-- Footnotes ([^1] ...) and headings (# / ##) are handled natively by pandoc's
-- docx writer (Footnote Text, Heading 1/2 styles) — no lua needed.
--
-- Usage (ScholarWeft export pipeline or CLI):
--   --lua-filter=sw-export.lua
--
-- The vault root comes from the SW_VAULT env var (set by the plugin / by the
-- ScholarWeft export pipeline). For a bare `pandoc --lua-filter` run outside
-- that pipeline, set SW_VAULT yourself. When it is unset, template resolution
-- here is skipped and `reference-doc` is left for the caller (the merge step,
-- or an explicit `--reference-doc`) to supply.

local VAULT_ROOT = os.getenv('SW_VAULT')
local EXPORT_TEMPLATES_DIR = VAULT_ROOT and (VAULT_ROOT .. '/Export Templates')

-- ── template selection + core properties ────────────────────────────────────

function Meta(meta)
  -- Resolve "template" frontmatter → reference docx path.
  local tpl = pandoc.utils.stringify(meta['template'] or '')
  if tpl == '' or tpl == 'null' then tpl = 'document' end
  tpl = tpl:gsub('%.docx$', '')  -- strip extension if given

  -- Only resolve a reference-doc when we know the vault root AND the file
  -- actually exists there — otherwise leave `reference-doc` untouched so the
  -- merge step (or an explicit --reference-doc) provides the template.
  if EXPORT_TEMPLATES_DIR then
    local tpl_path = EXPORT_TEMPLATES_DIR .. '/' .. tpl .. '.docx'
    local f = io.open(tpl_path, 'r')
    if not f then
      tpl_path = EXPORT_TEMPLATES_DIR .. '/document.docx'
      f = io.open(tpl_path, 'r')
    end
    if f then
      f:close()
      meta['reference-doc'] = tpl_path
    end
  end

  -- Map YAML properties to docx core properties. Pandoc reads these from
  -- metadata: author (list ok), keywords (list ok), subject, description,
  -- category. When 'author' is absent, the merge step (lc_export_merge.py)
  -- fills it from the plugin's default-author setting, so we leave it unset
  -- here and let the merge handle the fallback.
  if not meta['keywords'] and meta['tags'] then meta['keywords'] = meta['tags'] end
  return meta
end

-- ── Generic callout handler ─────────────────────────────────────────────────

-- Callout types handled by the dedicated sw-poetry.lua filter.
-- Return nil here so they flow through to that filter unchanged.
local POETRY_CALLOUT_TYPES = {
  ['poetry'] = true, ['english-poetry'] = true,
  ['arabic-poetry'] = true, ['arabic-poetry-callout'] = true,
  ['poetry-callout'] = true,
}

function BlockQuote(el)
  if #el.content == 0 then return nil end
  local first = el.content[1]
  if first.t ~= 'Para' and first.t ~= 'Header' then return nil end
  local marker = pandoc.utils.stringify(first.content):match('^%[!([%w_%-]+)%]')
  if not marker then return nil end
  marker = marker:lower()

  -- Skip poetry callouts — sw-poetry.lua handles them.
  if POETRY_CALLOUT_TYPES[marker] then return nil end

  -- Collect the body. A callout whose title line and content are consecutive
  -- (no blank line) is ONE Para: the marker, the title and the body are joined
  -- by a SoftBreak, so content[2:] is empty. Keep what follows the first
  -- SoftBreak/LineBreak in that case — returning an empty list here used to
  -- DROP the whole callout (title and body) from the output.
  local body = pandoc.List()
  if #el.content == 1 then
    local after, past = pandoc.List(), false
    for _, inl in ipairs(first.content) do
      if not past then
        if inl.t == 'SoftBreak' or inl.t == 'LineBreak' then past = true end
      else
        after:insert(inl)
      end
    end
    if #after > 0 then body:insert(pandoc.Plain(after)) end
  else
    for i = 2, #el.content do body:insert(el.content[i]) end
  end
  if #body == 0 then return nil end

  -- Wrap body in a Div carrying the "Callout heading" custom Word/ODT style.
  return pandoc.Div(body, pandoc.Attr('', {}, {['custom-style'] = 'Callout heading'}))
end

-- ── In-body references ([[@key|reference]]) ─────────────────────────────────
--
-- The export pre-render (src/convertCitations.ts) emits each full-reference
-- entry as a Div carrying custom-style="Bibliographic reference - body". For
-- DOCX/ODT pandoc maps that attribute straight onto the template's paragraph
-- style, so nothing is needed here. LaTeX has no custom paragraph styles, so
-- wrap the Div in the `swrefbody` environment defined in the .tex templates
-- (the LaTeX equivalent of that style: 1cm first line + 0.75cm hanging indent).
local REFERENCE_BODY_STYLE = 'Bibliographic reference - body'

function Div(el)
  if el.attributes['custom-style'] ~= REFERENCE_BODY_STYLE then return nil end
  if FORMAT ~= 'latex' then return nil end
  local out = pandoc.List()
  out:insert(pandoc.RawBlock('latex', '\\begin{swrefbody}'))
  out:extend(el.content)
  out:insert(pandoc.RawBlock('latex', '\\end{swrefbody}'))
  return out
end

-- The former "Notes-section suppression" lived here. It dropped a "# Notes"
-- organizational section that DocumentCompiler.py used to emit and that showed
-- up as an empty chapter. That heading is no longer emitted for DOCX/ODT: the
-- footnote DEFINITIONS are written with no heading (see compile_book), so
-- pandoc makes real page-bottom footnotes. When the note's `endnotes` property
-- is on, the compiler instead emits a populated Notes section for
-- Markdown/LaTeX; DOCX/ODT never receive that scaffold. Either way the decision
-- belongs to the compiler, not to any single writer.

return { { Meta = Meta, BlockQuote = BlockQuote, Div = Div } }
