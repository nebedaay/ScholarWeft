-- sw-callouts.lua
--
-- Standard Obsidian callouts → per-type paragraph styles.
--
-- Obsidian's standard callouts (https://obsidian.md/help/callouts) all share a
-- box look with a coloured background and an icon + title on the first line.
-- This filter maps every standard type AND alias (case-insensitively) onto one
-- paragraph style per canonical type — a child of the template's base `callout`
-- style that only changes the background colour — and renders:
--
--   * a first paragraph in that style with the type's icon and the (capitalised)
--     title — the callout's own title text if given, otherwise the alias/type;
--   * one paragraph in the same style per content block.
--
-- The icon is a single neutral PNG per type (black stroke at 60% opacity,
-- transparent background) from the plugin's icons/ folder — see
-- tools/gen-callout-icons.py.  It is looked up via SW_ICONS_DIR (set by
-- DocumentCompiler.py from its own location, so it works for the plugin and the
-- CLI alike).  If the PNG is missing the filter falls back to an emoji.
--
-- Custom / non-standard callouts are LEFT ALONE (return nil) so sw-export.lua
-- and the user's style mappings handle them as before. Poetry callouts are left
-- to sw-poetry.lua.
--
-- Runs FIRST in the filter chain so it claims standard callouts before
-- sw-export.lua's generic handler. The style names here must match the styles
-- added to the templates by tmp/add_callout_styles.py.

local ICONS_DIR = os.getenv('SW_ICONS_DIR')
local ICON_WIDTH = '0.4cm'

local TYPES = {
  note      = { style = 'Callout Note',     file = 'note',     emoji = '\240\159\147\157' }, -- 📝
  abstract  = { style = 'Callout Abstract', file = 'abstract', emoji = '\240\159\147\139' }, -- 📋
  summary   = { style = 'Callout Abstract', file = 'abstract', emoji = '\240\159\147\139' },
  tldr      = { style = 'Callout Abstract', file = 'abstract', emoji = '\240\159\147\139' },
  info      = { style = 'Callout Info',     file = 'info',     emoji = '\226\132\185\239\184\143' }, -- ℹ️
  todo      = { style = 'Callout Todo',     file = 'todo',     emoji = '\226\156\133' }, -- ✅
  tip       = { style = 'Callout Tip',      file = 'tip',      emoji = '\240\159\148\165' }, -- 🔥
  hint      = { style = 'Callout Tip',      file = 'tip',      emoji = '\240\159\148\165' },
  important = { style = 'Callout Tip',      file = 'tip',      emoji = '\240\159\148\165' },
  success   = { style = 'Callout Success',  file = 'success',  emoji = '\226\156\148\239\184\143' }, -- ✔️
  check     = { style = 'Callout Success',  file = 'success',  emoji = '\226\156\148\239\184\143' },
  done      = { style = 'Callout Success',  file = 'success',  emoji = '\226\156\148\239\184\143' },
  question  = { style = 'Callout Question', file = 'question', emoji = '\226\157\147' }, -- ❓
  help      = { style = 'Callout Question', file = 'question', emoji = '\226\157\147' },
  faq       = { style = 'Callout Question', file = 'question', emoji = '\226\157\147' },
  warning   = { style = 'Callout Warning',  file = 'warning',  emoji = '\226\154\160\239\184\143' }, -- ⚠️
  caution   = { style = 'Callout Warning',  file = 'warning',  emoji = '\226\154\160\239\184\143' },
  attention = { style = 'Callout Warning',  file = 'warning',  emoji = '\226\154\160\239\184\143' },
  failure   = { style = 'Callout Failure',  file = 'failure',  emoji = '\226\157\140' }, -- ❌
  fail      = { style = 'Callout Failure',  file = 'failure',  emoji = '\226\157\140' },
  missing   = { style = 'Callout Failure',  file = 'failure',  emoji = '\226\157\140' },
  danger    = { style = 'Callout Danger',   file = 'danger',   emoji = '\226\154\161' }, -- ⚡
  error     = { style = 'Callout Danger',   file = 'danger',   emoji = '\226\154\161' },
  bug       = { style = 'Callout Bug',      file = 'bug',      emoji = '\240\159\144\155' }, -- 🐛
  example   = { style = 'Callout Example',  file = 'example',  emoji = '\240\159\147\132' }, -- 📄
  quote     = { style = 'Callout Quote',    file = 'quote',    emoji = '\240\159\146\172' }, -- 💬
  cite      = { style = 'Callout Quote',    file = 'quote',    emoji = '\240\159\146\172' },
}

local POETRY = {
  poetry = true, ['english-poetry'] = true, ['arabic-poetry'] = true,
  ['arabic-poetry-callout'] = true, ['poetry-callout'] = true,
}

-- Type colour (Obsidian default), keyed by the icon/file name. Keep in sync
-- with tools/add-callout-styles.py and tools/gen-callout-icons.py.
local COLORS = {
  note = '448AFF', abstract = '00B0FF', info = '00B8D4', todo = '00B8D4',
  tip = '00BFA5', success = '08B94E', question = 'EC7500', warning = 'EC7500',
  failure = 'E93147', danger = 'E93147', bug = 'E93147', example = '7852EE',
  quote = '9E9E9E',
}

-- Mix an RRGGBB colour with white at `alpha` (Obsidian's callout background is
-- the type colour at 10% over white). Returns RRGGBB.
local function mix_white(hex, alpha)
  local function part(i)
    local c = tonumber(hex:sub(i, i + 1), 16)
    return string.format('%02X', math.floor(255 * (1 - alpha) + c * alpha + 0.5))
  end
  return part(1) .. part(3) .. part(5)
end

local function capitalise(s)
  if s == '' then return s end
  return s:sub(1, 1):upper() .. s:sub(2)
end

local function styled(blocks, style, extra)
  -- `custom-style` drives the paragraph style; any extra keys are ignored by
  -- the writers and used only to mark callout boundaries for the Pandoc pass.
  local attrs = { ['custom-style'] = style }
  for k, v in pairs(extra or {}) do attrs[k] = v end
  return pandoc.Div(blocks, pandoc.Attr('', {}, attrs))
end

-- The icon as an inline image (falling back to the emoji if the PNG is absent).
local function icon_inline(t)
  if ICONS_DIR then
    local src = ICONS_DIR .. '/' .. t.file .. '.png'
    local f = io.open(src, 'rb')
    if f then
      f:close()
      return pandoc.Image({}, src, '', pandoc.Attr('', {}, { ['width'] = ICON_WIDTH }))
    end
  end
  return pandoc.Str(t.emoji)
end

-- Split the first paragraph's inlines into (marker, title inlines, body inlines
-- after the first soft/line break). Returns nil when there is no callout marker.
local function split_marker(inlines)
  if #inlines == 0 then return nil end
  local first = inlines[1]
  if first.t ~= 'Str' and first.t ~= 'Text' then return nil end
  local marker, tail = first.text:match('^%[!([%w_%-]+)%]%s*(.*)$')
  if not marker then return nil end
  local title, body, after = {}, {}, false
  if tail ~= '' then title[#title + 1] = pandoc.Str(tail) end
  for i = 2, #inlines do
    local inl = inlines[i]
    if inl.t == 'SoftBreak' or inl.t == 'LineBreak' then
      after = true
    elseif after then
      body[#body + 1] = inl
    else
      title[#title + 1] = inl
    end
  end
  return marker:lower(), title, body
end

-- Wrap every leaf paragraph of a block in the callout style (so lists and
-- nested blocks keep the style too).
local function collect(block, style, out)
  if block.t == 'Para' or block.t == 'Plain' then
    out[#out + 1] = styled({ pandoc.Para(block.content) }, style, { ['sw-callout'] = '1' })
  elseif block.t == 'BulletList' or block.t == 'OrderedList' then
    for _, item in ipairs(block.content) do
      for _, b in ipairs(item) do collect(b, style, out) end
    end
  elseif block.t == 'BlockQuote' or block.t == 'Div' then
    for _, b in ipairs(block.content) do collect(b, style, out) end
  else
    out[#out + 1] = block
  end
end

function BlockQuote(el)
  if #el.content == 0 then return nil end
  local first = el.content[1]
  if first.t ~= 'Para' and first.t ~= 'Header' then return nil end
  local marker, title, body = split_marker(first.content)
  if not marker then return nil end
  if POETRY[marker] then return nil end
  local t = TYPES[marker]
  if not t then return nil end   -- custom callout: leave for sw-export/mappings

  local title_text = pandoc.utils.stringify(title)
  title_text = title_text:gsub('^[%-%+]%s*', '')   -- fold marker -/+
  if title_text == '' then title_text = marker end
  title_text = capitalise(title_text)

  -- LaTeX has no named custom paragraph styles, so wrap the callout in a
  -- coloured tcolorbox instead (defined in the .tex templates). Everything
  -- else — the icon image, the bold title, the content — is identical to the
  -- DOCX/ODT path.
  if FORMAT == 'latex' then
    local fg = COLORS[t.file]
    local out = {
      pandoc.RawBlock('latex',
        '\\definecolor{swcbg}{HTML}{' .. mix_white(fg, 0.1) .. '}'
        .. '\\definecolor{swcfg}{HTML}{' .. fg .. '}'
        .. '\\begin{swcalloutbox}{swcbg}{swcfg}'),
      pandoc.Para({
        icon_inline(t),
        pandoc.Space(),
        pandoc.Strong({ pandoc.Str(title_text) }),
      }),
    }
    if #el.content == 1 then
      if #body > 0 then out[#out + 1] = pandoc.Para(body) end
    else
      for i = 2, #el.content do out[#out + 1] = el.content[i] end
    end
    out[#out + 1] = pandoc.RawBlock('latex', '\\end{swcalloutbox}')
    return out
  end

  local out = {}
  -- Icon + title on the first line (title bold).  The `sw-callout-start` class
  -- marks the first paragraph of each callout so the Pandoc pass below can tell
  -- two contiguous callouts apart (their paragraph styles may be identical).
  out[#out + 1] = styled({ pandoc.Para({
    icon_inline(t),
    pandoc.Space(),
    pandoc.Strong({ pandoc.Str(title_text) }),
  }) }, t.style, { ['sw-callout'] = '1', ['sw-callout-start'] = '1' })

  if #el.content == 1 then
    if #body > 0 then
      out[#out + 1] = styled({ pandoc.Para(body) }, t.style, { ['sw-callout'] = '1' })
    end
  else
    for i = 2, #el.content do collect(el.content[i], t.style, out) end
  end
  return out
end

-- Insert a blank separator paragraph between two CONTIGUOUS callouts.  The
-- base `callout` style has "don't add space between paragraphs of the same
-- style" (contextual spacing) so a callout's title and content sit in one box;
-- but Word/LibreOffice then also merge two back-to-back callouts into a single
-- box (even of different types).  A blank Normal paragraph between them breaks
-- the contextual run so each callout gets its own box.
function Pandoc(doc)
  local out = pandoc.List()
  local prev_callout = false
  for _, b in ipairs(doc.blocks) do
    local is_callout = b.t == 'Div' and b.attributes['sw-callout'] ~= nil
    if is_callout and prev_callout
            and b.attributes['sw-callout-start'] ~= nil then
      out:insert(pandoc.Para({}))
    end
    out:insert(b)
    prev_callout = is_callout
  end
  doc.blocks = out
  return doc
end

return { { BlockQuote = BlockQuote, Pandoc = Pandoc } }
