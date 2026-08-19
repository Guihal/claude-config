# Tabs / Segment control

## Anatomy
Tablist (строка табов) + panels (по одной на таб). Таб = кнопка (законы
button.md), не ссылка — если только табы не роуты (тогда `<a>` + aria-current).

## Layout laws
- Tablist: flex-строка, `gap`; переполнение на узких экранах —
  `overflow-x: auto` со скрытым скроллбаром, НЕ перенос в две строки.
- Активный индикатор — border-bottom/подложка; смена активного таба НЕ должна
  дёргать высоту строки (bold-активный → резерв ширины, напр. через
  text-shadow-трюк или фикс. вес).
- Panel: одна видима; высота меняется по контенту — это норм.

## Variants & sizing
- Underline-табы и segment-контрол (подложка) — один паттерн, разный
  индикатор.
- Размер — padding таба, шкала общая с кнопками.

## States
Таб: `hover`, `focus-visible`, `active/selected`, `disabled`.
Переключение — мгновенное или короткий fade panel'и.

## A11y
- `role="tablist"` / `tab` / `tabpanel`, `aria-selected`,
  `aria-controls`/`aria-labelledby` связки.
- Клавиатура: стрелки по табам, Tab уходит в панель (roving tabindex).
- Если контент панелей тяжёлый и это фактически страницы — переосмысли в
  ссылки-роуты.

## Antipatterns
- Табы на div'ах без ролей и клавиатуры.
- Скрытие панелей через `display:none` при необходимости их SEO/печати —
  решить сознательно.
- Двухстрочный tablist.

## Repo hint
Искать существующий Tabs/Accordion JS-util проекта — часто переключалка уже
написана.
