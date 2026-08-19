---
name: design-tz-draft
description: >
  Фаза 3 пайплайна «дизайн-выгрузка → ТЗ»: merge block-map × style-map →
  черновое чисто-UI ТЗ (tz-draft.md), прогнанное через стандарты ui-standards.
  Без проектной привязки (токены/данные — фаза design-project-bind).
  Универсальный. Triggers: "черновик тз по картам", "tz draft", "собери
  ui-тз", продолжение после design-style-map.
argument-hint: "<block-map.md> <style-map.md>"
---

# design-tz-draft — merge карт → чистое UI-ТЗ

Фаза 3 цепочки (после `design-block-map` и `design-style-map`). Форматы входных
файлов — контракты соответствующих скиллов. Справочник: скилл `ui-standards`
(прочитать SKILL.md + references только задействованных элементов).

## Вход

- `block-map.<page>.md` (+ `shared.block-map.md`).
- `style-map.<page>.md`.

## Merge (механический)

Left-join листьев карты × строк style-map по слагу:

- leaf есть, значений нет → в ТЗ пометка `values: MISSING` (не выдумывать).
- строка style-map без листа в карте → в `## Merge report` как orphan.
- Оба расхождения — в `## Merge report` (это сигнал перезапустить фазу 1 или 2,
  решает человек).

## Прогон через ui-standards

Для каждого интерактивного элемента (кнопка, ссылка, слайдер, поле, аккордеон,
карточка...):

1. Прочитать соответствующий `references/<element>.md`.
2. Дополнить ТЗ обязательными состояниями (hover/focus/active/disabled...) и
   a11y-требованиями. Всё, чего не было в макете — маркер `[derived]`.
3. Анти-паттерны сырого макета конвертировать в правила: фикс-высота кнопки из
   Figma → «высота = font+padding, ориентир макета N px»; padding 60px →
   «ширина от layout». Исходное значение сохранять как ориентир, не как
   предписание.

## Responsive

Секция `## Responsive` обязательна:
- один breakpoint во входах → `responsive: UNSPECIFIED (макет только
  desktop-1440)` + ЗАПРЕТ имплементатору выдумывать мобильную вёрстку без
  отдельного решения;
- несколько → правила по брейкпоинтам из колонок style-map.

## Выход, формат + пример

`<design-dir>/tz-draft.<page>.md` — по секциям карты; content-атомы помечены
`[data]` (источник определит `design-project-bind`):

```markdown
# TZ draft: factory (UI-only)
breakpoint: desktop-1440

## hero
- hero.breadcrumb — цепочка ссылок, 12/15.6 uppercase #1F1F1F, текущая
  страница — underline, не ссылка [derived: aria-current="page",
  hover/focus-visible по ui-standards/link]. Текст: [data]
- hero.lead — текст-колонка ~585px (ширина от грида, не padding), 14/18.2
  #626262. Контент: [data]
- hero.media — слайдер, 4 слайда, dots; стрелки — icon-buttons 7×18 [derived:
  aria-label, disabled на краях, states по ui-standards/slider,button]

## Merge report
- hero.kicker: values MISSING (нет в style-map)
- orphans: нет

## Responsive
UNSPECIFIED (макет только desktop-1440). Мобильную раскладку не выдумывать.
```

## Далее

Следующая фаза — `design-project-bind` (токены, данные, правила проекта).
