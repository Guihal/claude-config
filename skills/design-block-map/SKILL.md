---
name: design-block-map
description: >
  Фаза 1 пайплайна «дизайн-выгрузка → ТЗ»: скриншоты дизайна → иерархическая
  словесная карта блоков (block-map.md). Только структура/порядок/поведение,
  БЕЗ цифр и стилей (значения — фаза design-style-map). Универсальный,
  project-agnostic. Triggers: "карта блоков", "block map", "разбери скрины
  дизайна", "структура макета", старт разбора дизайн-папки со скринами.
argument-hint: "<путь к папке дизайна или скринам> [имя страницы]"
---

# design-block-map — скрины → карта блоков

Первая фаза цепочки: `design-block-map` → `design-style-map` →
`design-tz-draft` → `design-project-bind` → `design-tz-split`
(справочник поперёк: `ui-standards`).

Принцип разделения источников: **скрины = структура, код-выгрузка = значения.**
Эта фаза смотрит ТОЛЬКО на скрины. Никаких пикселей, цветов, шрифтов — любое
число в block-map = баг фазы.

## Вход

- Скриншоты страницы (все, по порядку сверху вниз; читать КАЖДЫЙ).
- Имя страницы (из папки/контекста, напр. `factory`).

## Процесс

1. Прочитать все скрины. Определить ширину макета → `breakpoint:` (напр.
   `desktop-1440`). Несколько комплектов скринов разных ширин → несколько
   breakpoint'ов в заголовке, карта одна.
2. Разбить страницу на секции сверху вниз. Внутри секции — блоки, внутри —
   элементы. Карта обязана быть иерархией до листьев (кнопка, заголовок,
   карточка → её внутренности); плоский список секций = недоделка.
3. Каждому узлу — **slug**: dotted-path, kebab-case (`hero.media`,
   `bestsellers.slider.card.title`). Слаги минтятся ЗДЕСЬ, стабильны,
   последующие фазы ссылаются на них и не переименовывают.
4. Scope: `[S]` — общий для сайта chrome (header, footer, попапы...),
   `[P]` — уникальное для страницы.
5. Поведение — словами inline: `(slider · N slides · dots · arrows)`,
   `(grid, ~3 cols)`, `(accordion, exclusive)`. Количество колонок/слайдов —
   это структура, можно; размеры — нельзя.
6. Непонятно, как блок себя ведёт → `behavior: UNCLEAR` + вопрос в
   `## Open questions`. Не выдумывать.

## Выход

`<design-dir>/block-map.<page>.md` — карта страницы (только `[P]`-ветки +
ссылки на shared-слаги).

`<design-root>/shared.block-map.md` — `[S]`-ветки. **Один на проект**, лежит в
корне design-папки (родительская папка, группирующая страницы: `дизайны/`, не
`дизайны/Фабрики/`; если папка страницы единственная — её родитель). Нет —
создать; есть — сверить: совпадающие блоки реюзаем по слагу, отличия дописываем
с флагом `[divergence: <page>]`, не форкаем файл.

## Формат + пример

```markdown
# block-map: factory
breakpoint: desktop-1440
shared: ../shared.block-map.md   # header, footer — слаги оттуда

- [P] hero
  - hero.breadcrumb  (link chain, последний элемент — текущая страница)
  - hero.title
  - hero.kicker      (строка-подпись под title)
  - hero.lead        (2–3 абзаца)
  - hero.media       (slider · 4 slides · dots)
- [P] bestsellers
  - bestsellers.kicker
  - bestsellers.title
  - bestsellers.slider  (card carousel · arrows по краям)
    - bestsellers.slider.card
      - bestsellers.slider.card.image
      - bestsellers.slider.card.title

## Open questions
- hero.media: dots кликабельны или только индикатор? behavior: UNCLEAR
```

`shared.block-map.md` — тот же формат, узлы `[S]`, без секции breakpoint
(shared живёт во всех).

## Далее

Следующая фаза — `design-style-map` (нужна код-выгрузка). Карту можно
перезапускать независимо: слаги существующих узлов сохранять.
