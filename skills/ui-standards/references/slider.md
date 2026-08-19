# Slider / Carousel (контентный, не range-input)

## Anatomy
Viewport (overflow) → track (flex-строка слайдов) + controls: стрелки
prev/next + [dots/пагинация] + [counter]. Основа — CSS scroll-snap +
`overflow-x: auto`; JS-библиотека (Swiper и т.п.) — когда нужны loop,
autoplay, синхронизация.

## Layout laws
- Слайд: ширина от layout'а (`flex: 0 0 <basis>` / грид-колонки), высоты
  слайдов выравнивает flex-track, не фиксированные height картинок.
- Картинки в слайдах: `aspect-ratio` + `object-fit: cover`.
- Стрелки — кнопки (button.md, icon-only + aria-label); позиционирование
  стрелок — единственное легитимное absolute здесь.
- «Выглядывающий» следующий слайд — через ширину слайда < 100% viewport,
  не через отрицательные margin-хаки.

## Variants & sizing
- Один компонент, конфиг: slides-per-view по брейкпоинтам, gap, loop, dots.
- Dots: кликабельные кнопки; активная — контрастом и формой.

## States
Стрелки: `disabled` на краях (если не loop). Dots: `active`. Слайдер без
переполнения (слайдов ≤ viewport) — controls скрыты.

## A11y
- `region` + `aria-roledescription="carousel"`, слайд —
  `aria-roledescription="slide"` + «N of M».
- Autoplay: пауза на hover/focus, кнопка stop; уважать
  `prefers-reduced-motion`.
- Клавиатура: стрелки-кнопки фокусируемы; scroll-snap даёт свайп бесплатно.

## Antipatterns
- Самописный transform-движок при доступном scroll-snap или уже подключённой
  библиотеке в проекте.
- Слайдер ради 2–3 статичных элементов, влезающих в грид.
- Автоплей без паузы и контроля.

## Repo hint
Проверить, какая карусель уже в проекте (Swiper-обёртка, util) — параметры
нового слайдера выражать её конфигом.
