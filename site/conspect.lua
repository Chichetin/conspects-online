-- Pandoc Lua filter: разметка конспектов text-extractor → HTML сайта.
-- HTML-аналог text-extractor/tools/latex/conspect.lua:
--   ::: {.qa title="…"}                       -> <details class="qa"> (свёрнуто)
--   ::: {.abstract title="…"} / keypoints / … -> div.box с заголовком
--   *Таймкод: ЧЧ:ММ:СС · слайды …*            -> p.secmeta
--   [^n]: Примечание составителя: …           -> сноска с меткой «Прим. составителя»
--   **Акцент лектора:** / **Важный вывод:** / **Важно:** -> span.lectmark
--   [текст]{.gl key="Термин"}                 -> ссылка на строку глоссария с подсказкой
--   картинки                                  -> loading="lazy"

local function html(s) return pandoc.RawBlock('html', s) end

local function escape(s)
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;'))
end

local box_titles = { keypoints = 'Главное', emphasis = 'Акценты лектора',
                     watch = 'Стоит посмотреть', plan = 'План' }

local function Div(el)
  if el.classes:includes('qa') then
    local out = { html('<details class="qa"><summary>' .. escape(el.attributes.title or 'Вопросы') .. '</summary>') }
    out[#out + 1] = pandoc.Div(el.content, pandoc.Attr('', { 'qa-body' }))
    out[#out + 1] = html('</details>')
    return out
  end
  for _, c in ipairs(el.classes) do
    if c == 'abstract' or box_titles[c] then
      local title = el.attributes.title
      if c == 'abstract' and title then
        table.insert(el.content, 1, html('<div class="box-title">' .. escape(title) .. '</div>'))
      end
      el.attributes.title = nil
      el.classes = { 'box', 'box-' .. c }
      return el
    end
  end
end

local function Para(el)
  if #el.content == 1 and el.content[1].t == 'Emph' then
    local txt = pandoc.utils.stringify(el.content[1])
    local tc, rest = txt:match('^Таймкод:%s*([%d:–%-]+)%s*·%s*(.*)$')
    if tc then
      return html('<p class="secmeta"><span class="tc">' .. escape(tc) .. '</span> · ' .. escape(rest) .. '</p>')
    end
  end
end

local labels = { ['Акцент лектора:'] = true, ['Важный вывод:'] = true, ['Важно:'] = true }

local function Strong(el)
  local s = pandoc.utils.stringify(el)
  if labels[s] then return pandoc.Span(el.content, pandoc.Attr('', { 'lectmark' })) end
end

local function Note(el)
  local first = el.content[1]
  if first and first.t == 'Para' and pandoc.utils.stringify(first):find('^Примечание составителя:') then
    local c, i = first.content, 1
    while c[i] and not (c[i].t == 'Str' and c[i].text == 'составителя:') do i = i + 1 end
    local newc = { pandoc.Span({ pandoc.Str('Прим. составителя') }, pandoc.Attr('', { 'compnote' })), pandoc.Space() }
    for j = i + 2, #c do newc[#newc + 1] = c[j] end
    local w = newc[3]
    if w and w.t == 'Str' then
      local head, tail = w.text:match('^([%z\1-\127\194-\244][\128-\191]*)(.*)$')
      if head then w.text = pandoc.text.upper(head) .. tail end
    end
    first.content = newc
  end
  return el
end

local function Image(el)
  el.attributes.loading = 'lazy'
  return el
end

-- ---------- глоссарий: якоря у терминов и ссылки на них из текста ----------

local function norm(s)
  s = pandoc.text.lower(s):gsub('ё', 'е')
  return (s:gsub('%b()', ''):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', ''))
end

local function in_glossary(blocks, i)
  for j = i, 1, -1 do
    local b = blocks[j]
    if b.t == 'Header' and b.level <= 2 then
      return pandoc.utils.stringify(b):find('^Глоссарий') ~= nil
    end
  end
  return false
end

function Pandoc(doc)
  local gloss = {}  -- нормализованный термин -> { id, определение }
  local n = 0
  for i, b in ipairs(doc.blocks) do
    if b.t == 'Table' and in_glossary(doc.blocks, i) then
      for _, body in ipairs(b.bodies) do
        for _, row in ipairs(body.body) do
          local cells = row.cells
          if #cells >= 2 then
            n = n + 1
            local id = 'gl-' .. n
            local term = pandoc.utils.stringify(cells[1].contents)
            local def = pandoc.utils.stringify(cells[2].contents)
            local entry = { id = id, def = term .. ' — ' .. def }
            gloss[norm(term)] = entry
            for alt in term:gmatch('%((.-)%)') do gloss[norm(alt)] = gloss[norm(alt)] or entry end
            for alt in (term:gsub('%b()', '') .. '/'):gmatch('([^/]+)/') do
              gloss[norm(alt)] = gloss[norm(alt)] or entry
            end
            cells[1].contents = { pandoc.Div(cells[1].contents, pandoc.Attr(id, { 'gl-term' })) }
          end
        end
      end
    end
  end

  doc.blocks = doc.blocks:walk {
    Span = function(el)
      if not el.classes:includes('gl') then return nil end
      local e = gloss[norm(el.attributes.key or pandoc.utils.stringify(el))]
      if not e then return el.content end
      return pandoc.Link(el.content, '#' .. e.id, '', pandoc.Attr('', { 'gl' }, { { 'data-def', e.def } }))
    end,
  }

  return doc:walk { Div = Div, Para = Para, Strong = Strong, Note = Note, Image = Image }
end
