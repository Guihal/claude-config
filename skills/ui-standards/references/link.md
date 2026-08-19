# Link (текстовые ссылки, breadcrumb)

## Anatomy
`<a href>` + [иконка/стрелка?]. Breadcrumb: `<nav aria-label>` → `<ol>` →
`<li><a>` + разделитель (CSS-псевдоэлемент, не текст в DOM).

## Layout laws
- Inline-ссылка живёт в потоке текста — не flex, не блок.
- Standalone-ссылка с иконкой → `inline-flex; align-items: center; gap`.
- Кликабельная зона мелких ссылок — расширять `padding` + отрицательный
  `margin`, не пустым span'ом.

## Variants & sizing
- Underline: инлайн в тексте — всегда underline (или чёткий цветовой контраст);
  standalone/меню — допустим underline только на hover.
- `text-underline-offset` вместо border-bottom для подчёркивания.

## States
`hover` (смена цвета/underline), `focus-visible` (ring), `visited` — только
для контентных страниц, `active`. Текущая страница в breadcrumb — не ссылка,
`aria-current="page"`.

## A11y
- Осмысленный текст ссылки, не «тут»/«подробнее» без контекста
  (или `aria-label` с уточнением).
- Внешние ссылки с `target="_blank"` → `rel="noopener"`.
- Breadcrumb — `<nav aria-label="breadcrumb">`, разделители скрыты от SR.

## Antipatterns
- `<a>` без `href` как кнопка — это `<button>`.
- `cursor: pointer` на не-интерактивном тексте.
- Разделители breadcrumb («/») как текстовые ноды в разметке.

## Repo hint
Искать существующие классы ссылок/breadcrumb и типографические миксины проекта.
