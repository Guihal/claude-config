# Checkbox / Radio / Switch

## Anatomy
`<label>`-обёртка → нативный `<input type=checkbox|radio>` (визуально скрыт
доступно: `appearance: none` или sr-only + кастомный бокс) + бокс/индикатор +
текст. Группа → `<fieldset><legend>`.

## Layout laws
- Label-обёртка = кликабельная зона: `display: flex; align-items: flex-start;
  gap` — текст в несколько строк не ломает выравнивание бокса.
- Бокс — фиксированный квадрат (это исключение из «без фикс-размеров»:
  индикатор, не контейнер текста), выровнен по первой строке текста.
- Вертикальный список группы — `gap`, не margin-bottom у каждого.

## Variants & sizing
- Checkbox: states checked / unchecked / indeterminate (JS-свойство).
- Switch — тот же `<input type=checkbox role="switch">`, другой индикатор.
  Switch = мгновенное действие; checkbox = выбор до submit. Не путать роли.

## States
`hover`, `focus-visible` (ring на боксе), `checked`, `disabled`,
`invalid` (для required-групп).

## A11y
- Только нативные input'ы. Никаких div-чекбоксов.
- Радио-группа: одинаковый `name`, стрелки работают нативно.
- Группа с общим вопросом → `fieldset` + `legend`.

## Antipatterns
- `display: none` на input — теряется фокус и клавиатура; скрывать доступно.
- Клик работает только по боксу, текст мёртвый (нет label-обёртки).
- Radio без выбранного по умолчанию там, где пустой выбор невалиден.

## Repo hint
Искать готовые form-контролы проекта; индикаторные размеры — из токенов.
