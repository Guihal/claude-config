---
name: tilda-bundle-requirements
description: Tilda t123 bundle format — inline css+js+html, module scope for isolation, no CDATA
metadata:
  type: user
---

`tilda-bundle.html` (output `plugins/vite-tilda-bundle.ts`) вставляется напрямую в Tilda HTML-блок t123. Формат:

1. **Inline `<style>`** сверху — минифицированный css. Один блок, без дублей.
2. **HTML калькулятора** — из `form.template.html`. Без `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, `</body>`, `</html>` — Tilda сама оборачивает.
3. **Inline `<script type="module">`** снизу — минифицированный js.

**`type="module"` обязателен** — изоляция scope, переменные внутри js не переопределяют глобальные Tilda-функции (`t123...`, `t456...` и т.д.). Не использовать обычный `<script>` — потеряется инкапсуляция.

**CDATA НЕ нужен** (`//<![CDATA[ ... //]]>`). Tilda парсит HTML-блок как HTML, не XHTML, CDATA в HTML-парсере игнорируется, только шумит.

**Why:** Tilda — embedded-окружение, свои глобалы + чужие блоки могут конфликтовать. Module-scope даёт изоляцию. Inline-only — bundle одним куском в HTML-блок, внешние `<script src=...>` не подгрузятся.

**How to apply:** правки tilda-bundle плагина — соблюдать формат: один inline `<style>`, HTML из template (без doctype/html/body обвязки), один inline `<script type="module">`. Не добавлять CDATA, не выносить js/css во внешние файлы, не дублировать style/script блоки.
