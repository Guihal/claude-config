# Button

## Anatomy
Контейнер (`<button>` / `<a>` в роли кнопки) → [иконка?] + label + [иконка?].
Иконки — отдельные flex-дети с `gap`, не абсолютное позиционирование.

## Layout laws
- `inline-flex; align-items: center; justify-content: center; gap`.
- **Никакого `height`.** Высота = `font-size × line-height + padding-y × 2`.
  Проверка: посчитай для макета — если не сходится с макетной высотой, крути
  padding, не добавляй height.
- `padding-x > padding-y` (обычно ×2–3). Full-width — `width: 100%` от
  родителя/грида, не гигантский padding-x.
- Минимальная тач-цель 44×44px — добирается padding'ом.
- `white-space: nowrap` для коротких label; текст не должен переносить кнопку
  в двухстрочную без сознательного решения.

## Variants & sizing
- Варианты (primary/secondary/ghost/danger) — меняют только цветовые токены.
- Размеры (sm/md/lg) — только шкала `padding` + `font-size`. Одна анатомия.
- Icon-only: квадрат через равный padding, обязателен `aria-label`.

## States
`hover` (сдвиг тона фона), `focus-visible` (ring), `active` (нажатие),
`disabled` (`opacity` + `cursor: not-allowed` + реальный атрибут `disabled`),
`loading` (спиннер, label скрыт но ширина сохранена, `aria-busy`).
Transition на background/border/color, 100–200ms.

## A11y
- Действие → `<button type="button|submit">`; навигация → `<a href>`. Не div.
- `disabled` — атрибутом, не только классом.
- Focus-ring: `outline` / `box-shadow` на `:focus-visible`, не убирать.

## Antipatterns
- `height: 48px` + `line-height: 48px` центрирование — ломается на 2 строках.
- `<div onclick>` — нет клавиатуры, нет ролей.
- padding-x 60px+ ради ширины — это width/грид.
- Разные DOM-структуры для вариантов одной кнопки.

## Repo hint
Сначала найти кнопку проекта (класс `.btn/.button`, компонент, миксин) и её
шкалу размеров. Новый вид кнопки = модификатор существующей.
