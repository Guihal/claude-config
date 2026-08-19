# Select / Dropdown

## Anatomy
Field-обёртка → `<label>` + trigger (значение + chevron) + panel (список
опций). Нативный `<select>` — дефолт; кастомный — только при реальной нужде
(поиск, мультивыбор, rich-опции).

## Layout laws
- Trigger подчиняется законам кнопки/input: flex, высота из font+padding,
  chevron — flex-ребёнок, не absolute.
- Panel: `position: absolute` от обёртки (или popover API), `min-width: 100%`
  триггера, `max-height` + scroll.
- Опция: padding-строка, hover-фон; выбранная — маркер, не только цвет.

## Variants & sizing
- Размерная шкала общая с input/button.
- Мультивыбор — chips в триггере или счётчик «N выбрано», не CSV-строка.

## States
Trigger: `hover`, `focus-visible`, `open` (chevron поворот), `disabled`,
`invalid`. Опции: `hover/highlighted`, `selected`, `disabled`.

## A11y
- Нативный select закрывает всё сам — поэтому он и дефолт.
- Кастомный: роль `combobox`/`listbox`, `aria-expanded`, `aria-activedescendant`,
  клавиатура (стрелки, Enter, Esc, type-ahead). Это дорого — см. пункт выше.
- `<label for>` в обоих случаях.

## Antipatterns
- Кастомный dropdown ради «стилизовать стрелочку» — стрелочка стилизуется и
  на нативном (`appearance: none` + свой chevron).
- Panel обрезается `overflow: hidden` родителя — проверять stacking-контекст.
- Клик-аут не закрывает panel.

## Repo hint
Искать существующий select/dropdown компонент проекта (часто есть в связке с
формами или фильтрами каталога).
