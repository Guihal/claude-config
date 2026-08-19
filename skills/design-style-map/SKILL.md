---
name: design-style-map
description: >
  Фаза 2 пайплайна «дизайн-выгрузка → ТЗ»: код-выгрузка дизайна (Figma
  copy-as-code и подобное) + block-map → таблица raw-значений по слагам
  (style-map.md). ТОЛЬКО сырые значения, БЕЗ сверки с токенами репо (это фаза
  design-project-bind). Универсальный, project-agnostic. Triggers: "карта
  стилей", "style map", "вытащи стили из выгрузки", продолжение после
  design-block-map.
argument-hint: "<путь к код-выгрузке> <путь к block-map.md>"
---

# design-style-map — код-выгрузка → raw-значения по слагам

Фаза 2 цепочки (после `design-block-map`). Скрины = структура, **код =
значения** — эта фаза читает код-выгрузку и раскладывает значения по слагам
карты. Формат слагов и карты — контракт `design-block-map`.

Типичный вход — Figma copy-as-code: плоский список absolute-positioned div'ов
с inline-стилями (`left/top/width/height`, цвета, шрифты) и `data-layer`
именами. Структуры в нём НЕТ — не пытаться её оттуда вывести.

## Вход

- Код-выгрузка (`code.txt` / `*.html` рядом со скринами).
- `block-map.<page>.md` + `shared.block-map.md` (слаги — оттуда).

## Процесс

1. Распарсить выгрузку в список нод: координаты (top/left/width/height),
   стили, текст, data-layer имя.
2. Сгруппировать ноды к блокам карты. **Primary-якорь — координаты**: регион
   блока = bounding box его нод, порядок секций по top. Secondary — тексты и
   data-layer имена (текст из скрина однозначно матчит ноду к слагу).
3. Генерик-ноды (`Rectangle N`, `Vector N`, безымянные) — классифицировать по
   геометрии: full-width плита = фон секции, тонкая длинная = разделитель,
   мелкая = иконка/стрелка. Приписать вмещающему блоку — НЕ сбрасывать в
   Orphans из-за имени.
4. Для каждого leaf-слага собрать raw-строку: шрифт/вес/размер/line-height,
   цвет, ширина (если несёт смысл — колонка текста), фон, поведенческие детали
   (кол-во слайдов и т.п. — подтверждение к карте).
5. Тексты — в секцию `## Content` точной строкой (это будущие content-атомы
   для data-binding).
6. Нода не легла ни в один блок → `## Orphans` с координатами + флаг
   `review`. Слаг без значений в коде → просто отсутствует в таблице (НЕ
   выдумывать; фаза 3 пометит missing).
7. Несколько breakpoint'ов → дополнительная колонка `raw @<bp>` на тот же слаг.

## Правила

- ТОЛЬКО raw. Никаких «это наверное токен cream» — сверка с репо запрещена
  (испортит переносимость; этим занимается `design-project-bind`).
- Значения не округлять и не «чинить» (18.2 = 18.2, не 18).

## Выход, формат + пример

`<design-dir>/style-map.<page>.md`:

```markdown
# style-map: factory
source: code.txt (Figma copy-as-code, 1440px)

| slug | raw |
|---|---|
| page | bg #F4EEE7 |
| hero.breadcrumb | 12px HelveticaNeueCyr 400 / #1F1F1F / lh 15.6 / uppercase; текущая — underline |
| hero.lead | 14px HelveticaNeueCyr 400 / #626262 / lh 18.2 / col-width 585 |
| bestsellers | bg white (плита 1440×879 @top 780) |
| hero.media | 4 slides / dots / arrows: vector 7×18 #1F1F1F @1406,2980 и @35,2998 |

## Content
- hero.breadcrumb: "Главная / Фабрики / ELIE SAAB MAISON"
- hero.lead: "Коллекцию можно смело считать всеинтерьерной, …"

## Orphans
- (пусто | нода + координаты + review-флаг)
```

## Далее

Следующая фаза — `design-tz-draft` (merge block-map × style-map).
