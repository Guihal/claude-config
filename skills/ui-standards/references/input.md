# Input (text/email/number/...)

## Anatomy
Field-обёртка → `<label>` + control-обёртка (`[префикс/иконка?]` + `<input>` +
`[суффикс/clear?]`) + [hint | error]. Ошибка и hint занимают одно
зарезервированное место либо аккуратно раздвигают поток — без прыжков макета.

## Layout laws
- Высота — `font-size + padding-y`, без `height` (тот же закон, что у кнопки:
  input и кнопка в одной форме обязаны получаться одной высоты из одних токенов).
- Иконки/префиксы — flex-дети control-обёртки, не absolute поверх padding.
- `width: 100%` от field-обёртки; геометрию задаёт форма/грид.

## Variants & sizing
- Размеры — та же шкала padding/font-size, что у кнопок проекта.
- Состояние ошибки — модификатор обёртки (border/цвет + текст), не отдельный
  вид поля.

## States
`hover`, `focus` (border/ring — заметнее hover), `disabled`, `readonly`,
`invalid` (+ текст ошибки), `filled`. Placeholder ≠ label: placeholder —
пример значения, исчезает; label — всегда виден.

## A11y
- `<label for>` или label-обёртка. Всегда.
- Ошибка связана с полем: `aria-describedby` + `aria-invalid="true"`.
- Правильные `type` / `inputmode` / `autocomplete` (email, tel, name...).

## Antipatterns
- Placeholder вместо label.
- Ошибка «где-то рядом» без aria-связи.
- Фиксированная высота, из-за которой input ≠ высоте кнопки рядом.
- `outline: none` без замены focus-индикации.

## Repo hint
Искать form-стили/компоненты проекта; шкалу размеров брать общую с кнопками.
