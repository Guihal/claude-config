---
name: ui-standards
description: >
  Справочник стандартов вёрстки UI-элементов: общие законы + per-element
  references (button, input, modal, tabs, ...). НЕ фаза пайплайна — подключается
  при любой вёрстке, ревью вёрстки или сборке ТЗ на UI (в т.ч. из
  design-tz-draft / design-project-bind). Progressive disclosure: этот файл =
  законы + индекс; конкретный элемент — читать references/<element>.md.
  Triggers: "по стандартам ui", "ui standards", "проверь вёрстку по стандартам",
  любая имплементация/ревью интерактивных элементов.
---

# UI Standards — законы + справочник по элементам

Квинтэссенция опыта хорошей вёрстки. Правила ниже — дефолт; проектные правила
(CLAUDE.md/AGENTS.md репо) сильнее при конфликте.

## Общие законы (применимы ко всем элементам)

1. **Интерактивный элемент = flex.** Кнопка/линк-кнопка/чип: `inline-flex` +
   `justify-content: center` + `align-items: center`. **Без фиксированной
   высоты** — высота образуется из `font-size × line-height + padding-y`.
   Размер задаётся паддингом, не `height`.
2. **Горизонтальный padding > ~50px — это не padding.** Такие отступы —
   ответственность layout'а: ширина контейнера, grid-колонка,
   `max-width + margin auto`. Элемент не должен «носить» в себе геометрию
   страницы.
3. **Состояния обязательны:** `hover`, `focus-visible`, `active`, `disabled`
   (+ `loading` для submit-действий). В статичном макете их нет → вывести по
   правилам элемента и пометить в ТЗ/коде `[derived]`, не пропускать.
4. **A11y-минимум:** семантический тег или роль; операбельность с клавиатуры;
   focus-ring не удалять без видимой замены; контраст текста ≥ 4.5:1.
5. **Компонент UI-кита/репо > самопал.** Перед написанием нового — искать
   существующий компонент/класс/миксин проекта. Новый вариант = расширение
   существующего, не параллельная реализация.
6. **Токены > магические числа.** Значение, повторённое ≥2 раз, — кандидат в
   токен/переменную. Цвета/шрифты/брейкпоинты — только через токены проекта.
7. **Размерные варианты (sm/md/lg)** — через шкалу `padding` + `font-size`.
   Один элемент — одна анатомия, варианты меняют только токены.

## Индекс references

Читать только нужные элементы (не все подряд):

| файл | покрывает |
|---|---|
| `references/button.md` | кнопки, кнопко-линки, icon-button |
| `references/link.md` | текстовые ссылки, breadcrumb, inline-ссылки |
| `references/input.md` | text input, label, ошибки, префиксы/иконки |
| `references/textarea.md` | многострочный ввод, autosize |
| `references/select.md` | select / dropdown / combobox |
| `references/checkbox-radio.md` | чекбоксы, радио, switch |
| `references/form.md` | композиция формы, валидация, submit-флоу |
| `references/modal.md` | модалки, оверлеи, drawer |
| `references/tabs.md` | табы, сегмент-контролы |
| `references/accordion.md` | аккордеоны, disclosure |
| `references/slider.md` | карусели/слайдеры контента (не range-input) |
| `references/card.md` | карточки: кликабельность, media, композиция |

Нет элемента в списке → применяй общие законы + ближайший по анатомии reference
(chip ≈ button, popover ≈ modal). Недостающий reference — добавлять по факту
нужды, тем же скелетом: Anatomy / Layout laws / Variants & sizing / States /
A11y / Antipatterns / Repo hint.

## Смежные справочники

Про элементы — здесь; про то, что вокруг них, — отдельные скиллы:

- `css-architecture` — организация стилей: слои токенов, нестинг, section-gap,
  modifier vs новый класс, специфичность.
- `animation-standards` — переходы/анимации: длительности, easing,
  transform/opacity, prefers-reduced-motion.
- `asset-pipeline` — ассеты: форматы (avif/webp), srcset/@2x, lazy vs LCP,
  anti-CLS, SVG, видео.
