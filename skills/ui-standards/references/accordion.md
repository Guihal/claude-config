# Accordion / Disclosure

## Anatomy
Список item'ов: item = trigger (заголовок + индикатор +/chevron) + panel.
Нативная основа — `<details>/<summary>`, кастом — при анимации высоты или
exclusive-режиме (хотя `<details name>` уже умеет exclusive).

## Layout laws
- Trigger — на всю ширину item'а, flex: заголовок слева, индикатор справа
  (`justify-content: space-between`), законы кнопки (padding, без height).
- Кликабельная зона = весь trigger, не только текст/иконка.
- Panel: padding согласован с trigger'ом (текст по одной вертикали).
- Анимация раскрытия — `grid-template-rows: 0fr→1fr` или
  `interpolate-size/height: calc-size()`; не JS-мерка scrollHeight без нужды.

## Variants & sizing
- Exclusive (один открыт) vs multiple — поведенческий флаг, одна разметка.
- Индикатор: chevron поворотом / plus↔minus. Transition обязателен.

## States
Trigger: `hover`, `focus-visible`, `expanded` (aria + индикатор), `disabled`.

## A11y
- `<summary>` нативно фокусируем; кастом: `<button aria-expanded
  aria-controls>` + panel `role="region" aria-labelledby`.
- Заголовки item'ов — в иерархии заголовков страницы (`<h3>` внутри trigger).

## Antipatterns
- Заголовок-div с onclick.
- height: auto «анимация» скачком.
- Первый item принудительно открыт без продуктовой причины.

## Repo hint
Искать Accordion-util проекта; для FAQ-подобного контента проверить, не
рендерится ли он уже существующим шаблоном.
