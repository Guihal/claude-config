---
name: mcp-inspector-workflow
description: |
  Unified workflow для работы с MCP-серверами mcp-web-inspector (Playwright) и
  browser-inspector-mcp (Puppeteer). Edit-verify-edit-verify cycle применим от
  edit-driven trigger (worker) и от artifact-driven trigger (checker).
  Триггер-слова: верстка, проверить вёрстку, layout, стили, DOM, видимость,
  CSS-каскад, computed styles, селектор, mcp-web-inspector, browser-inspector,
  инспектор, pixel-perfect, match design.
---

# mcp-inspector-workflow

## What this skill is

Unified workflow для работы с двумя MCP-серверами для верификации вёрстки:

- **mcp-web-inspector** (Playwright-based, npm: `mcp-web-inspector`, server name: `web-inspector` в `~/.claude.json`).
- **browser-inspector-mcp** (Puppeteer-based, npm: `browser-inspector-mcp`, server name: `browser-inspector` в `~/.claude.json`).

Edit-verify-edit-verify cycle применим от **trigger A** (edit-driven — worker только что отредактировал файл) и от **trigger B** (artifact-driven — checker получил артефакт для проверки). Один ядерный цикл (open → query → diff → fix/accept), разные триггеры.

## Quickstart: как пользоваться (для начинающих)

Если ты здесь впервые — не паникуй. Вот самый короткий путь:

### За 30 секунд

1. **Скажи, что хочешь проверить.** Например: «проверь, что у этой кнопки правильный стиль» или «сделай DOM-снимок страницы» или «найди, почему элемент не виден».
2. **Skill сам подскажет, какой MCP-сервер вызвать.** Триггер-слова из frontmatter (верстка, layout, стили, DOM, видимость, селектор, computed, каскад, инспектор) активируют reminder. Скилл `mcp-inspector-workflow` уже подсказывает, какой tool какакого сервера.
3. **Вызови tool.** Например: `mcp__browser-inspector__browser_inspect(action="dom")` (через `browser-inspector` MCP-сервер) или mcp-web-inspector visibility tool.
4. **Сравни результат с тем, что ожидал.** Если не совпало → fix → вызови tool ещё раз. Это и есть edit-verify-edit-verify cycle.

### Какую задачу ты решаешь?

| Если ты... | Тебе нужен | Tool / Server |
|---|---|---|
| «Только что поправил CSS, надо проверить, что не сломал» | Trigger A (edit-driven cycle) | см. секцию «Edit-verify-edit-verify cycle» |
| «Получил код на ревью, надо убедиться, что вёрстка правильная» | Trigger B (artifact-driven cycle) | см. секцию «Edit-verify-edit-verify cycle» |
| «Хочу увидеть весь DOM страницы» | Full DOM snapshot | `mcp__browser-inspector__browser_inspect(action="dom")` → browser-inspector |
| «Хочу увидеть весь CSS-каскад для элемента» | Styles cascade | `mcp__browser-inspector__browser_inspect(action="styles")` → browser-inspector |
| «Хочу сравнить текущее состояние с предыдущим» | Visual diff | `mcp__browser-inspector__browser_inspect(action="diff")` → browser-inspector |
| «Скриншот для документации» | Screenshot | `mcp__browser-inspector__browser_inspect(action="screenshot")` → browser-inspector |
| «Почему элемент не видно на странице?» | Visibility diagnostics | `mcp__web-inspector__check_visibility` (clipped / covered / scrolled out) |
| «Откуда у элемента такой margin / width?» | Layout-constraint tracing | `mcp__web-inspector__measure_element` + `mcp__web-inspector__inspect_ancestors` |
| «Надёжен ли мой CSS-селектор? Сколько элементов он ловит?» | Selector-reliability testing | `mcp__web-inspector__query_selector` / `mcp__web-inspector__element_exists` |
| «Это для МойСклада (online)» | Online URL support | mcp-web-inspector (browser-inspector-mcp — local-dev-only) |

### Что дальше?

Прочитай секцию «Tool call chains» ниже — там конкретные примеры вызовов с input/output. Потом «Edit-verify-edit-verify cycle» — там полный цикл.

## MCP server catalog

### mcp-web-inspector (Playwright-based)

Имя в `~/.claude.json`: `web-inspector`. Команда: `npx -y mcp-web-inspector`.
В CC tools зовутся `mcp__web-inspector__<tool>` (34 штуки).

**Capabilities:**
- progressive DOM inspection (drill through wrapper divs к semantic elements)
- visibility diagnostics (clipped, covered, scrolled out — почему click fail)
- layout-constraint tracing (где unexpected margins, width limits, overflow clipping)
- layout validation (compare element positions, alignment, spacing)
- selector-reliability testing (all matches + visibility status)
- computed styles inspection
- find by text (когда нет test IDs)

**Session persistence:** Browser sessions (cookies, localStorage, sessionStorage) автоматически сохраняются в `./.mcp-web-inspector/user-data/` и persist across restarts. На повторных verify-вызовах не нужно re-auth.

**CLI flags:**
- `--no-save-session` — отключить session persistence
- `--user-data-dir <path>` — кастомная директория (default `./.mcp-web-inspector`)
- `--headless` — headless mode
- `--expose-sensitive-network-data` — expose sensitive data в ответах

**Scope:** работает с BOTH online URLs (МойСклад, etc.) и localhost. Default для deep investigation (visibility, layout constraints, selector testing).

### browser-inspector-mcp (Puppeteer-based)

Имя в `~/.claude.json`: `browser-inspector`. Команда: `npx -y browser-inspector-mcp`.

**1 tool:** `mcp__browser-inspector__browser_inspect` с 4 primary actions:
- `action="dom"` — rendered DOM snapshot
- `action="styles"` — full CSS cascade для элемента
- `action="diff"` — before/after comparison
- `action="screenshot"` — visual snapshot

**Scope: LOCAL-DEV-ONLY** (per upstream README: «designed for active development workflows, not for inspecting live public websites»). Скачивает Chromium ~170 MB на первом use. **НЕ использовать для online URLs (МойСклад)** — для online → mcp-web-inspector.

## MCP routing decision table

| Что хочу | Tool | Server |
|---|---|---|
| Full DOM snapshot | `mcp__browser-inspector__browser_inspect(action="dom")` | browser-inspector |
| Computed styles / CSS cascade | `mcp__browser-inspector__browser_inspect(action="styles")` | browser-inspector |
| Visual diff before/after | `mcp__browser-inspector__browser_inspect(action="diff")` | browser-inspector |
| Element visibility diagnostics (clipped, covered, scrolled out) | `mcp__web-inspector__check_visibility` | web-inspector |
| Layout-constraint tracing (margins, width, overflow) | `mcp__web-inspector__measure_element`, `mcp__web-inspector__inspect_ancestors` | web-inspector |
| Selector-reliability testing | `mcp__web-inspector__query_selector`, `mcp__web-inspector__element_exists` | web-inspector |
| **Online URL (МойСклад, etc.)** | любой `mcp__web-inspector__*` | web-inspector |
| **Local dev server** | browser-inspector-mcp preferred | browser-inspector |

## Tool call chains: подробные примеры вызовов

Здесь — конкретные последовательности tool invocations с input/output. Используй как готовые шаблоны.

### Цепочка 1: «Сделай DOM-снимок и найди, что не так»

```text
Шаг 1. mcp__browser-inspector__browser_inspect(action="dom", url="http://localhost:3000/")
   → возвращает: rendered HTML страницы (всё, что в `<body>` после JS-рендера)

Шаг 2. Ищи в выводе нужный элемент (по тексту, id, class).
   Если не нашёл → элемента нет в DOM (проверь conditional render, React state).

Шаг 3. (опц.) mcp__browser-inspector__browser_inspect(action="styles", selector="...")
   → возвращает: computed CSS для элемента (final значения после cascade)
```

**Когда использовать:** первичная разведка страницы, поиск пропавших элементов, валидация JS-рендера.

### Цепочка 2: «Почему CSS не работает?»

```text
Шаг 1. mcp__browser-inspector__browser_inspect(action="styles", selector=".my-button", url="...")
   → возвращает: все применённые CSS-правила для элемента в порядке cascade
   → показаны: rule origin (user-agent / user / author), specificity, computed values

Шаг 2. Смотри «winning» rule (последний non-overridden) — это то, что реально применяется.
   Если winning rule не тот, что ожидал → ищи overriding rule выше.

Шаг 3. (для online URL или deep investigation) mcp__web-inspector__inspect_ancestors(selector="...")
   → показывает: какой CSS-блок установил неожиданный margin/width
```

**Когда использовать:** CSS-каскад не даёт ожидаемый результат, нужно понять кто перебивает.

### Цепочка 3: «Сравни до и после правки» (Trigger A — edit-driven)

```text
Шаг 1. До правки: mcp__browser-inspector__browser_inspect(action="screenshot", url="...", path="before.png")
   → сохраняет screenshot

Шаг 2. Внеси правку в код.

Шаг 3. После правки: mcp__browser-inspector__browser_inspect(action="screenshot", url="...", path="after.png")

Шаг 4. mcp__browser-inspector__browser_inspect(action="diff", before="before.png", after="after.png")
   → возвращает: visual diff (что изменилось пиксель-к-пикселю)
```

**Когда использовать:** Trigger A — worker только что поправил вёрстку, хочет убедиться что не сломал соседние элементы.

### Цепочка 4: «Проверь артефакт на ревью» (Trigger B — artifact-driven)

```text
Шаг 1. mcp__browser-inspector__browser_inspect(action="dom", url="http://localhost:3000/path")
   → rendered DOM

Шаг 2. Сравни структуру с тем, что ожидалось по TZ/design:
   - Все ли секции есть?
   - Порядок правильный?
   - Условный render работает?

Шаг 3. mcp__browser-inspector__browser_inspect(action="styles", selector=".critical-component", url="...")
   → computed CSS для критического элемента

Шаг 4. Сравни computed values с design tokens (если есть design-tz).

Шаг 5. Зафиксируй diff: что не совпало → report worker'у.
```

**Когда использовать:** Trigger B — checker получил артефакт на ревью.

### Цепочка 5: «Почему элемент не видно?»

```text
Шаг 1. mcp__web-inspector__check_visibility(selector="...")
   → возвращает: 
     - clipped (overflow:hidden на parent обрезал)
     - covered (другой элемент сверху, z-index)
     - scrolled out (за пределами viewport)
     - display: none / visibility: hidden / opacity: 0
     - размер 0×0 (родитель не имеет размеров)

Шаг 2. На основе результата — fix в нужном месте:
   - clipped → убрать overflow:hidden или изменить positioning
   - covered → поднять z-index
   - scrolled → scrollIntoView
   - display:none → проверить conditional render
```

**Когда использовать:** элемент есть в DOM, но пользователь его не видит.

### Цепочка 6: «Селектор надёжен?»

```text
Шаг 1. mcp__web-inspector__query_selector(selector="...")
   → возвращает:
     - сколько элементов matched (0 / 1 / N)
     - для каждого: visibility status (visible / hidden)
     - все ли visible

Шаг 2. Если 0 matches → селектор битый, ищи другой.
   Если N>1 matches → селектор не уникален, уточни (добавь nth-of-type, конкретный class, etc).
   Если все hidden → селектор правильный, но элементы не отображаются.
```

**Когда использовать:** перед написанием теста, чтобы убедиться что селектор ловит то что нужно.

### Цепочка 7: «Онлайн-сайт (МойСклад) — verify»

```text
Для online URLs browser-inspector-mcp НЕ работает (local-dev-only).
Используй web-inspector:

Шаг 1. mcp__web-inspector__navigate(url="...")
   → session с cookies сохраняется в ./.mcp-web-inspector/user-data/

Шаг 2. mcp__web-inspector__inspect_dom(...)
   → drill через wrapper divs к semantic elements

Шаг 3. mcp__web-inspector__check_visibility / __measure_element / __query_selector по нужному элементу

Шаг 4. (опц.) screenshot для evidence (но НЕ через browser-inspector action="screenshot" — это для local).
```

**Когда использовать:** работа с МойСклад, любыми online URLs (не localhost).

## Edit-verify-edit-verify cycle (universal)

Один ядерный цикл: **open inspector session → query tool по affected region → сравнить с expected → если mismatch → fix → re-query → до ground truth**.

### Trigger A: edit-driven (worker)

Worker только что отредактировал файл X. Цикл:
1. Refresh inspector session (если нужно).
2. Query tool по affected region (например, `mcp__browser-inspector__browser_inspect(action="dom")` для проверки DOM, `action="styles"` для CSS).
3. Сравнить с expected (что хотели получить).
4. Если mismatch → fix → re-query.
5. До ground truth (до match с expected).

### Trigger B: artifact-driven (checker)

Checker получил артефакт для проверки. Цикл:
1. Open inspector session.
2. Query tools для верификации (например, `mcp__browser-inspector__browser_inspect(action="diff")` для before/after, `action="styles"` для CSS check).
3. Зафиксировать diff (что не совпало с expected).
4. Report worker'у.
5. Ждать правки.
6. Re-verify (return to start of cycle).

**Оба триггера используют один и тот же ядерный цикл** (open → query → diff → fix/accept).

## Per-task guidance

См. MCP routing decision table выше. Если unsure:
- «просто посмотреть что есть на странице» → `mcp__browser-inspector__browser_inspect(action="dom")`.
- «почему элемент не видно» → `mcp__web-inspector__check_visibility`.
- «почему CSS не работает» → `mcp__browser-inspector__browser_inspect(action="styles")` для cascade или `mcp__web-inspector__get_computed_styles` для computed styles.
- «сравнить с предыдущим состоянием» → `mcp__browser-inspector__browser_inspect(action="diff")`.
- «это для МойСклада (online)» → `mcp__web-inspector__*`.

## Common pitfalls

- **Lazy lifecycle.** Оба MCP-сервера `lifecycle: "lazy"` — стартуют на первом use. npx скачает пакет на первом вызове.
- **Chromium download.** browser-inspector-mcp скачает Chromium ~170 MB на первом use. Puppeteer-based, требует network.
- **Server names ≠ npm names.** `web-inspector` (в `~/.claude.json`, tools `mcp__web-inspector__*`) ≠ `mcp-web-inspector` (npm). `browser-inspector` (в `~/.claude.json`, tool `mcp__browser-inspector__browser_inspect`) ≠ `browser-inspector-mcp` (npm).
- **local-dev-only.** browser-inspector-mcp — для localhost dev. Для online URLs (МойСклад) — mcp-web-inspector.
- **Session persistence.** mcp-web-inspector сохраняет cookies в `./.mcp-web-inspector/user-data/`. На повторных verify не нужно re-auth.
- **Reload для новых tools.** После изменения mcp.json требуется `/reload` или новая сессия — pi-mcp-adapter не подхватит новые tools до reload.

## References

- Upstream mcp-web-inspector: github.com/antonzherdev/mcp-web-inspector
- Upstream browser-inspector-mcp: github.com/betson-g/browser-inspector-mcp
- Локальный MCP config: `~/.claude.json` (server names: `web-inspector`, `browser-inspector`)
- Layout skills (read first / cross-reference): `ui-standards`, `lost-pixel`, `ui-audit`
