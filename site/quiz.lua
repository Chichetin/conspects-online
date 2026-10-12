-- Pandoc Lua filter: тест для самопроверки (quiz.md из text-extractor, .claude/lecture/quiz.md) → HTML сайта.
--   вступление до первого уровня        -> div.quiz-intro
--   ## Лёгкий / Средний / Сложный уровень -> div.quiz-level#easy|medium|hard
--   ### Вопрос N                         -> div.quiz-q#eN|mN|hN, data-type = single|multi|num|open
--   - [ ] / - [x]                        -> div.quiz-options > div.quiz-option[data-ok]
--   **Ответ:** 0.92 ± 0.01               -> div.quiz-num[data-answer, data-tol]
--   **Эталон:** … **Ключевые пункты:** … -> в ответ: div.quiz-etalon и div.quiz-points
--   **Разбор:** …                        -> в ответ: div.quiz-explain
--   **Где в конспекте:** раздел N «…»    -> ссылки на разделы конспекта (id из метаданных secmap: «N=id|…»);
--   **Где в учебнике:** вопрос N «…»     -> то же у лабораторной: ссылки на вопросы учебника
--   блоки кода (в тексте, эталоне, разборе) -> как есть
-- Ответ и разбор лежат в <details class="quiz-key">: без JS их можно раскрыть вручную, с JS их
-- показывает app.js после проверки.

local function html(s) return pandoc.RawBlock('html', s) end

local LEVELS = {
  ['Лёгкий уровень'] = { 'easy', 'e' }, ['Средний уровень'] = { 'medium', 'm' }, ['Сложный уровень'] = { 'hard', 'h' },
}

local function label_of(block)  -- «Ответ:» для абзаца, начинающегося с **Ответ:**
  if block.t == 'Para' and block.content[1] and block.content[1].t == 'Strong' then
    return pandoc.utils.stringify(block.content[1])
  end
end

local function after_label(block)  -- содержимое абзаца без жирной метки
  local c = pandoc.List()
  for i = 2, #block.content do c:insert(block.content[i]) end
  while c[1] and (c[1].t == 'Space' or c[1].t == 'SoftBreak') do c:remove(1) end
  return c
end

local function task_item(item)  -- пункт чек-листа: (верный?, блоки без ☐/☒) или nil
  local first = item[1]
  if not (first and (first.t == 'Plain' or first.t == 'Para') and first.content[1]) then return nil end
  local mark = first.content[1].t == 'Str' and first.content[1].text
  if mark ~= '☐' and mark ~= '☒' then return nil end
  local inl = pandoc.List()
  for i = 2, #first.content do inl:insert(first.content[i]) end
  while inl[1] and inl[1].t == 'Space' do inl:remove(1) end
  local blocks = pandoc.List { pandoc.Plain(inl) }
  for i = 2, #item do blocks:insert(item[i]) end
  return mark == '☒', blocks
end

local secmap = {}

local function where_para(block, label)
  local text = pandoc.utils.stringify(after_label(block))
  local unit = label == 'Где в учебнике:' and 'вопрос ' or 'раздел '
  local out = pandoc.List { pandoc.Strong { pandoc.Str(label) }, pandoc.Space() }
  local refs = 0
  for n, title in text:gmatch('(%d+)%s*«([^»]+)»') do
    if refs > 0 then out:insert(pandoc.Str(',')); out:insert(pandoc.Space()) end
    local ref = pandoc.Str(unit .. n .. ' «' .. title .. '»')
    local id = secmap[n]
    out:insert(id and pandoc.Link({ ref }, './#' .. id) or ref)
    refs = refs + 1
  end
  if refs == 0 then return pandoc.Div({ block }, pandoc.Attr('', { 'quiz-where' })) end
  return pandoc.Div({ pandoc.Para(out) }, pandoc.Attr('', { 'quiz-where' }))
end

local function question(id, header, blocks)
  local body, key = pandoc.List(), pandoc.List()
  local options, correct = pandoc.List(), pandoc.List()
  local etalon, points, explain, where = pandoc.List(), nil, pandoc.List(), nil
  local qtype, answer, tol, n_ok
  local mode = 'body'
  for _, b in ipairs(blocks) do
    local label = label_of(b)
    if label == 'Ответ:' then
      local a, t = pandoc.utils.stringify(after_label(b)):match('^([-+]?[%d.]+)%s*±%s*([%d.]+)')
      qtype, answer, tol, mode = 'num', a, t, 'answer'
      key:insert(pandoc.Div({ pandoc.Para({ pandoc.Strong { pandoc.Str('Ответ:') }, pandoc.Space(), table.unpack(after_label(b)) }) },
        pandoc.Attr('', { 'quiz-answer' })))
    elseif label == 'Эталон:' then
      qtype, mode = 'open', 'etalon'
      etalon:insert(pandoc.Para(after_label(b)))
    elseif label == 'Ключевые пункты:' then
      mode = 'points'
    elseif label == 'Разбор:' then
      mode = 'explain'
      explain:insert(pandoc.Para(after_label(b)))
    elseif label == 'Где в конспекте:' or label == 'Где в учебнике:' then
      mode, where = 'where', where_para(b, label)
    elseif b.t == 'BulletList' and mode == 'points' then
      points = b
    elseif b.t == 'BulletList' and mode == 'body' and task_item(b.content[1] or {}) ~= nil then
      n_ok = 0
      for _, item in ipairs(b.content) do
        local ok, content = task_item(item)
        if ok then n_ok = n_ok + 1; correct:insert(content) end
        options:insert(pandoc.Div(content, pandoc.Attr('', { 'quiz-option' }, { ['data-ok'] = ok and '1' or '0' })))
      end
      qtype, mode = 'choice', 'options'
    elseif mode == 'body' then
      body:insert(b)
    elseif mode == 'etalon' then
      etalon:insert(b)
    elseif mode == 'explain' then
      explain:insert(b)
    end
  end
  if qtype == 'choice' then qtype = n_ok >= 2 and 'multi' or 'single' end

  header.identifier = ''
  -- пустой RawBlock впереди: Div, который начинается с заголовка, pandoc пишет как <section>,
  -- а секции на сайте прячет режим «Быстро повторить»
  local out = pandoc.List { html(''), header, pandoc.Div(body, pandoc.Attr('', { 'quiz-body' })) }
  if qtype == 'single' or qtype == 'multi' then
    out:insert(pandoc.Div(options, pandoc.Attr('', { 'quiz-options' })))
    local title = #correct > 1 and 'Верные ответы:' or 'Верный ответ:'
    key:insert(pandoc.Div({ pandoc.Para { pandoc.Strong { pandoc.Str(title) } }, pandoc.BulletList(correct) },
      pandoc.Attr('', { 'quiz-answer' })))
  elseif qtype == 'num' then
    out:insert(pandoc.Div({}, pandoc.Attr('', { 'quiz-num' }, { ['data-answer'] = answer or '', ['data-tol'] = tol or '0' })))
  elseif qtype == 'open' then
    out:insert(pandoc.Div({}, pandoc.Attr('', { 'quiz-open' })))
    etalon:insert(1, pandoc.Para { pandoc.Strong { pandoc.Str('Эталон') } })
    key:insert(pandoc.Div(etalon, pandoc.Attr('', { 'quiz-etalon' })))
    if points then
      key:insert(pandoc.Div({ pandoc.Para { pandoc.Strong { pandoc.Str('Ключевые пункты') } }, points },
        pandoc.Attr('', { 'quiz-points' })))
    end
  end
  if #explain > 0 then
    explain:insert(1, pandoc.Para { pandoc.Strong { pandoc.Str('Разбор') } })
    key:insert(pandoc.Div(explain, pandoc.Attr('', { 'quiz-explain' })))
  end
  if where then key:insert(where) end
  out:insert(html('<details class="quiz-key"><summary>Ответ и разбор</summary>'))
  out:extend(key)
  out:insert(html('</details>'))
  return pandoc.Div(out, pandoc.Attr(id, { 'quiz-q' }, { ['data-type'] = qtype or 'unknown' }))
end

function Pandoc(doc)
  for pair in pandoc.utils.stringify(doc.meta.secmap or ''):gmatch('[^|]+') do
    local n, id = pair:match('^(%d+)=(.+)$')
    if n then secmap[n] = id end
  end

  local out, intro = pandoc.List(), pandoc.List()
  local level, q = nil, nil  -- текущий уровень: { id, prefix, header, items }; вопрос: { header, blocks }
  local levels = pandoc.List()
  local function close_q()
    if q and level then
      level.items:insert(question(level.prefix .. q.n, q.header, q.blocks))
    end
    q = nil
  end
  for _, b in ipairs(doc.blocks) do
    if b.t == 'Header' and b.level == 2 then
      close_q()
      local name = pandoc.utils.stringify(b)
      local l = LEVELS[name] or { 'level' .. (#levels + 1), 'x' }
      level = { id = l[1], prefix = l[2], header = b, items = pandoc.List() }
      levels:insert(level)
    elseif b.t == 'Header' and b.level == 3 and level then
      close_q()
      q = { header = b, n = pandoc.utils.stringify(b):match('(%d+)') or tostring(#level.items + 1), blocks = pandoc.List() }
    elseif q then
      q.blocks:insert(b)
    elseif not level then
      intro:insert(b)
    end
  end
  close_q()

  if #intro > 0 then out:insert(pandoc.Div(intro, pandoc.Attr('', { 'quiz-intro' }))) end
  for _, l in ipairs(levels) do
    l.header.identifier = ''
    local content = pandoc.List { html(''), l.header }
    content:extend(l.items)
    out:insert(pandoc.Div(content, pandoc.Attr(l.id, { 'quiz-level' })))
  end
  doc.blocks = out
  return doc
end
