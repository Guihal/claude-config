# Modal / Overlay / Drawer

## Anatomy
Overlay (затемнение) + dialog-контейнер → header (title + close) + body
(scrollable) + [footer actions]. Нативный `<dialog>` — дефолтная основа.

## Layout laws
- Dialog: `max-width` по типоразмеру + `width: calc(100% - 2*gutter)`;
  `max-height` (напр. `85dvh`) + scroll ТОЛЬКО у body, header/footer прибиты.
- Центрирование — flex/grid на overlay (или нативный dialog), не
  top:50%/transform-магия.
- Drawer — тот же контракт, прижат к краю, высота 100dvh.
- Скролл страницы под модалкой блокируется (scrollbar-gutter учесть).

## Variants & sizing
- Типоразмеры (sm/md/lg) — только `max-width`.
- Confirm-диалог — тот же компонент, footer с parой кнопок (см. button.md).

## States
`open/close` с transition (fade + лёгкий scale/slide); закрытие: крестик, Esc,
клик по overlay (кроме форм с несохранёнными данными — там confirm).

## A11y
- `<dialog>` + `showModal()` даёт focus-trap, Esc, inert-фон бесплатно —
  поэтому он и дефолт. Кастомный — обязан повторить всё это руками.
- `aria-labelledby` → title; фокус при открытии — на dialog/первый контрол,
  при закрытии — вернуть на триггер.

## Antipatterns
- div-модалка с z-index 9999 без focus-trap и Esc.
- Скролл всего dialog вместе с header'ом.
- Модалка в модалке — пересмотреть флоу.
- Контент, порождающий horizontal scroll внутри body.

## Repo hint
Искать Popup/Modal утилиту проекта (часто уже есть в JS-utils) — расширять её.
