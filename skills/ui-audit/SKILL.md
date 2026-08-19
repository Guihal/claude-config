---
name: ui-audit
description: >
  UI-валидация живой страницы через playwright MCP: WCAG 2.1 AA (axe-core)
  + overflow / position / overlap / touch-targets sniffer + structured JSON-репорт.
  Triggers: «проверь вёрстку», «ui-audit», «валидация страницы»,
  «проверь overflow», «проверь accessibility», «audit page»,
  «touch-target audit», «overflow check», «mobile-баги», «DOM inspection без injection».
argument-hint: "<url> [--mobile] [--no-axe]"
---

# ui-audit — UI валидация страницы

Локальная проверка живой страницы на layout-баги и a11y-issues. Использует
**playwright MCP** (browser engine) + **axe-core** (WCAG 2.1 AA) + собственный
sniffer для overflow / position / overlap / touch-targets.

Самодостаточен: не требует других скиллов.

## Когда запускать

- После правки SCSS/HTML/PHP-шаблона — поймать regression на overflow / position.
- Перед merge / перед сдачей блока редактору — проверить accessibility.
- На этапе «вёрстка вслепую» — увидеть, что видит пользователь.

## Workflow (8 шагов)

Шаг 1. Resize viewport:
```
mcp__plugin_playwright_playwright__browser_resize({width: 1920, height: 1080})
```

Шаг 2. Navigate:
```
mcp__plugin_playwright_playwright__browser_navigate({url: "<URL>"})
```

Шаг 3. Axe-core WCAG 2.1 AA — `mcp__plugin_playwright_playwright__browser_evaluate` со стрелкой
из `references/axe-snippet.js`. Возвращает JSON-массив violations:
`{id, impact, count, elements[], help, helpUrl}`.

Шаг 4. Layout-sniffer — `mcp__plugin_playwright_playwright__browser_evaluate` со стрелкой
из `references/sniffer.js`. Возвращает:
- `overflow[]` — `scrollWidth > clientWidth && overflowX != hidden`
- `position_outside_viewport[]` — `fixed/absolute` вне `vw×vh`
- `touch_targets_small[]` — `a/button/input/...` < 44×44 px
- `overlap_count` — кол-во пар siblings с overlap > 5×5 px

Шаг 5. Console errors: `mcp__plugin_playwright_playwright__browser_console_messages({})`.

Шаг 6. Screenshot desktop: `mcp__plugin_playwright_playwright__browser_take_screenshot`
с `fullPage: true, filename: "/tmp/ui-audit-<slug>-desktop.png"`.

Шаг 7. Mobile pass — повторить шаги 1-6 с `width: 375, height: 667`.

Шаг 8. Свести в JSON-репорт по шаблону:
```json
{
  "url": "<URL>",
  "desktop": { "axe": {...}, "sniffer": {...}, "console_errors": [] },
  "mobile":  { "axe": {...}, "sniffer": {...}, "console_errors": [] },
  "screenshot_desktop": "/tmp/ui-audit-<slug>-desktop.png",
  "screenshot_mobile":  "/tmp/ui-audit-<slug>-mobile.png"
}
```

## Готовые inline-скрипты

Ниже — тела функций, которые нужно передать в `mcp__plugin_playwright_playwright__browser_evaluate`
как `function`-аргумент (строкой). Это убирает зависимость от того, что файлы
доступны на хосте.

### Axe-core WCAG 2.1 AA

```js
async () => {
  if (!window.axe) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const r = await window.axe.run(document, { runOnly: ['wcag2a','wcag2aa'] });
  return JSON.stringify(r.violations.map(v => ({
    id: v.id, impact: v.impact, count: v.nodes.length,
    elements: v.nodes.slice(0,3).map(n => n.target.join(' ')),
    help: v.help, helpUrl: v.helpUrl
  })), null, 2);
}
```

### Layout sniffer

```js
() => {
  const out = { overflow: [], position_outside_viewport: [], touch_targets_small: [], overlap_count: 0 };
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = Array.from(document.querySelectorAll('*'));
  const rects = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 && r.height === 0) continue;
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'hidden') {
      out.overflow.push({ tag: el.tagName.toLowerCase(), cls: String(el.className||'').slice(0,80), scroll: el.scrollWidth, client: el.clientWidth });
    }
    if ((cs.position === 'fixed' || cs.position === 'absolute') && (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh)) {
      out.position_outside_viewport.push({ tag: el.tagName.toLowerCase(), pos: cs.position });
    }
    if (el.matches('a, button, input, select, textarea, [role=button], [role=link]')) {
      if ((r.width < 44 || r.height < 44)) {
        out.touch_targets_small.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText||'').trim().slice(0,30) });
      }
    }
    rects.push({ el, r });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i+1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      if (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom) continue;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 5 && iy > 5) out.overlap_count++;
    }
  }
  return JSON.stringify({ vw, vh, ...out }, null, 2);
}
```

## Пример вызова

```text
/skill:ui-audit http://localhost:8090/factories/elie-saab-maison/
```

После этого агент последовательно дёргает 6 MCP-tools на каждый viewport,
собирает JSON, выводит короткий summary:

```
URL: http://localhost:8090/factories/elie-saab-maison/
Desktop (1920×1080): axe=0 violations, sniffer={overflow:0, position:0, touch:2, overlap:0}
Mobile  (375×667):   axe=1 violation [color-contrast], sniffer={overflow:0, position:0, touch:5, overlap:1}
Screenshots: /tmp/ui-audit-single-elie-{desktop,mobile}.png
```

## Границы применения

**Ловит:**
- Overflow по `scrollWidth > clientWidth`
- Position outside viewport
- Touch-targets < 44×44 (Apple HIG / WCAG 2.5.5)
- WCAG 2.1 AA: color-contrast, alt-text, ARIA, heading-order, label, link-name
- Overlapping siblings > 5×5 px (heuristic)

**Не ловит (out of scope):**
- Pixel-diff (используй `lost-pixel`)
- Off-token color/radius/spacing (используй `mcp__swatchdog__check_design_drift`)
- CLS / perf (используй Lighthouse)
- Cross-browser rendering (нужен отдельный run)

## Files

```
~/.claude/skills/ui-audit/
├── SKILL.md               # этот файл
└── references/
    ├── sniffer.js         # file-relative копия sniffer-функции
    └── axe-snippet.js     # file-relative копия axe-функции
```

## Role-safe variant (для Reviewer / Escalation Advisor)

Эти роли по [`system-constitution §Toolkits`](~/.claude/skills/system-constitution/SKILL.md)
имеют read-only MCP-границы: NO DOM injection, NO click, NO fill.

`--no-axe` режим — **только sniffer** (без axe-core.script-inject, без DOM-модификации):

1. Resize viewport: `mcp__plugin_playwright_playwright__browser_resize({width: 1920, height: 1080})`
2. Navigate: `mcp__plugin_playwright_playwright__browser_navigate({url: "<URL>"})`
3. Sniffer: `mcp__plugin_playwright_playwright__browser_evaluate` со стрелкой из `references/sniffer.js`
4. Screenshot: `mcp__plugin_playwright_playwright__browser_take_screenshot` (уже входит в MCP-toolset,
   не модифицирует DOM страницы)
5. Mobile pass: повторить шаги 1-4 с `width: 375, height: 667`.

**Полный ui-audit (axe + sniffer + screenshot) — только для Teamlead /
Auditor / Operator** (full MCP use per §Toolkits).
