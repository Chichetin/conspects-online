-- Pandoc Lua filter: разметка конспектов text-extractor → HTML сайта.
-- HTML-аналог text-extractor/tools/latex/conspect.lua:
--   ::: {.qa title="…"}                       -> <details class="qa"> (свёрнуто)
--   ::: {.abstract title="…"} / keypoints / … -> div.box с заголовком
--   *Таймкод: ЧЧ:ММ:СС · слайды …*            -> p.secmeta
--   [^n]: Примечание составителя: …           -> сноска с меткой «Прим. составителя»
--   **Акцент лектора:** / **Важный вывод:** / **Важно:** -> span.lectmark
--   [текст]{.gl key="Термин"}                 -> ссылка на строку глоссария (определение покажет app.js)
--   картинки                                  -> loading="lazy"
-- Учебники к лабораторным (doc-kind: lab, text-extractor/.claude/lab/primer.md):
--   вступление до первого раздела             -> div.box «О работе»
--   ## Вопрос N. Формулировка.                -> якорь qN, без «Вопрос N.» (номер ставит --number-sections)
--   > [!NOTE] / [!WARNING] / [!CAUTION] / [!TIP] + **Заголовок** -> div.box-<тип> с заголовком
--   ```mermaid + *Схема: …*                    -> pre.mermaid (рисует mermaid.js) и подпись
--   **Плохо:** / **Хорошо:** перед кодом      -> p.verdict, рамка у следующего блока кода
--   Файл: `путь`, строки …                    -> p.fileref
-- Класс rv помечает то, что остаётся в режиме «Быстро повторить»: итоговые разделы, глоссарий,
-- аннотацию и выделенные блоки, абзацы с метками лектора и с выносными формулами; в лабораторных — плашки.

local function html(s) return pandoc.RawBlock('html', s) end

local function from(list, i)  -- элементы list начиная с i-го
  local out = pandoc.List()
  for j = i, #list do out:insert(list[j]) end
  return out
end

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
      el.classes = pandoc.List { 'box', 'box-' .. c }
      if c ~= 'watch' and c ~= 'plan' then el.classes:insert('rv') end
      return el
    end
  end
end

local labels = { ['Акцент лектора:'] = true, ['Важный вывод:'] = true, ['Важно:'] = true }

local function is_key(inlines)
  local found = false
  inlines:walk {
    -- к этому моменту Strong с меткой уже стал span.lectmark (inline-фильтры идут раньше блочных)
    Span = function(s) if s.classes:includes('lectmark') then found = true end end,
    Math = function(m) if m.mathtype == 'DisplayMath' then found = true end end,
  }
  return found
end

local review_sections = { ['Главное из лекции'] = true, ['Что подчеркнул лектор'] = true, ['Глоссарий'] = true }

local function Header(el)
  local c = el.content
  if el.level == 2 and c[1] and c[1].t == 'Str' and c[1].text == 'Вопрос' and c[3] and c[3].t == 'Str' then
    local n = c[3].text:match('^(%d+)%.$')
    if n then
      el.identifier = 'q' .. n
      el.content = from(c, 5)
      local last = el.content[#el.content]
      if last and last.t == 'Str' then last.text = last.text:gsub('%.$', '') end
      return el
    end
  end
  if el.level == 2 and review_sections[pandoc.utils.stringify(el)] then
    el.classes:insert('rv')
    return el
  end
end

local function mark_key(el)
  if is_key(el.content) then return pandoc.Div({ el }, pandoc.Attr('', { 'rv' })) end
end

local verdicts = { ['Плохо:'] = 'bad', ['Хорошо:'] = 'good' }

local function Para(el)
  local key = mark_key(el)
  if key then return key end
  local c = el.content
  if #c == 1 and c[1].t == 'Strong' then
    local label = pandoc.utils.stringify(c[1])
    if verdicts[label] then
      return html('<p class="verdict ' .. verdicts[label] .. '">' .. escape(label:sub(1, -2)) .. '</p>')
    end
  end
  if c[1] and c[1].t == 'Str' and c[1].text == 'Файл:' then
    return pandoc.Div({ el }, pandoc.Attr('', { 'fileref' }))
  end
  if #c == 1 and c[1].t == 'Emph' and pandoc.utils.stringify(c[1]):find('^Схема:') then
    return pandoc.Div({ el }, pandoc.Attr('', { 'diagram-caption' }))
  end
  if #el.content == 1 and el.content[1].t == 'Emph' then
    local txt = pandoc.utils.stringify(el.content[1])
    local tc, rest = txt:match('^Таймкод:%s*([%d:–%-]+)%s*·%s*(.*)$')
    if tc then
      return html('<p class="secmeta"><span class="tc">' .. escape(tc) .. '</span> · ' .. escape(rest) .. '</p>')
    end
  end
end

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

local alerts = {
  NOTE = { 'note', 'В твоей работе' }, WARNING = { 'warning', 'Подводный камень' },
  CAUTION = { 'caution', 'Расхождение с практикой' }, TIP = { 'tip', 'Могут спросить' },
  IMPORTANT = { 'important', 'Важно' },
}

local function BlockQuote(el)
  local first = el.content[1]
  if not (first and first.t == 'Para' and first.content[1] and first.content[1].t == 'Str') then return end
  local kind = first.content[1].text:match('^%[!(%u+)%]$')
  local a = kind and alerts[kind]
  if not a then return end
  local rest = from(first.content, 2)
  while rest[1] and (rest[1].t == 'SoftBreak' or rest[1].t == 'Space') do rest:remove(1) end
  local title, blocks = a[2], from(el.content, 2)
  if #rest == 1 and rest[1].t == 'Strong' then
    title = pandoc.utils.stringify(rest[1])
  elseif #rest > 0 then
    blocks:insert(1, pandoc.Para(rest))
  end
  blocks:insert(1, html('<div class="box-title">' .. escape(title) .. '</div>'))
  return pandoc.Div(blocks, pandoc.Attr('', { 'box', 'box-' .. a[1], 'rv' }))
end

local function CodeBlock(el)
  if el.classes:includes('mermaid') then
    return html('<pre class="mermaid">' .. escape(el.text) .. '</pre>')
  end
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
  local gloss = {}  -- нормализованный термин -> { id }
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
            local entry = { id = id }
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
      return pandoc.Link(el.content, '#' .. e.id, '', pandoc.Attr('', { 'gl' }))
    end,
  }

  if pandoc.utils.stringify(doc.meta['doc-kind'] or '') == 'lab' then
    -- вступление учебника (до первого раздела) — в плашку, как аннотация лекции
    local intro, i = pandoc.List(), 1
    while doc.blocks[i] and doc.blocks[i].t ~= 'Header' do
      intro:insert(doc.blocks[i]); i = i + 1
    end
    if #intro > 0 then
      intro:insert(1, html('<div class="box-title">О работе</div>'))
      doc.blocks = pandoc.List({ pandoc.Div(intro, pandoc.Attr('', { 'box', 'box-abstract', 'rv' })) })
          .. from(doc.blocks, i)
    end
  end

  return doc:walk { Div = Div, Header = Header, Para = Para, Plain = mark_key, Strong = Strong, Note = Note,
                    Image = Image, BlockQuote = BlockQuote, CodeBlock = CodeBlock }
end
