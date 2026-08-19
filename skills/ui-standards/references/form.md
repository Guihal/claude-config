# Form (композиция, валидация, submit)

## Anatomy
`<form>` → поля (field-обёртки из input/select/checkbox references) →
actions-строка (submit + [cancel]). Многосекционная форма → `<fieldset>` с
`<legend>` на секцию.

## Layout laws
- Вертикальный ритм — `gap` на form/грид, не разнобой margin'ов у полей.
- Ширины полей — грид-колонки формы (имя/фамилия в строку и т.п.), сами поля
  всегда `width: 100%` своей ячейки.
- Actions: flex-строка; primary-кнопка — по конвенции проекта (обычно справа
  или на всю ширину в узких формах).
- Одна форма = одна submit-кнопка `type="submit"` (Enter должен работать).

## Variants & sizing
- Все контролы формы — одна размерная шкала (кнопка = высоте input из одних
  токенов font+padding).

## States (флоу валидации)
- Валидация — на blur или на submit; НЕ на каждый символ до первого сабмита.
- После первой попытки submit — поля перепроверяются на input (reward early,
  punish late).
- Submit в процессе: кнопка `loading` + `disabled`, повторный submit запрещён.
- Ошибка сервера — суммарный блок над формой + `aria-live`, фокус на него или
  на первое невалидное поле.

## A11y
- Каждое поле — label; каждая ошибка — `aria-describedby` (см. input.md).
- Суммарные ошибки — `role="alert"` / `aria-live="assertive"`.
- Порядок табуляции = визуальному порядку.

## Antipatterns
- `<div>` + JS-обработчик вместо `<form onsubmit>` — теряется Enter, autofill.
- Ошибки только цветом рамки.
- Disabled submit до валидности всей формы — юзер не видит, ЧТО не так;
  лучше active submit + показ ошибок.

## Repo hint
Искать form-хелперы/классы проекта и существующий ajax-submit паттерн.
