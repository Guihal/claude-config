---
name: asset-pipeline
description: >
  Справочник вывода ассетов из макетов в прод: форматы (avif/webp + fallback),
  размерная сетка + retina, naming, lazy vs priority (LCP), anti-CLS через
  aspect-ratio, SVG, видео. Универсальная выжимка. Triggers: "как выгрузить
  картинки", "asset pipeline", "форматы изображений", "оптимизация ассетов",
  "lazy loading", "retina @2x", "picture srcset".
---

# Asset Pipeline — ассеты из макета в прод

Дефолт вывода изображений/видео/SVG. Проектный build-конвейер сильнее при
конфликте.

## Законы

1. **Формат: avif/webp + fallback.** Растр — через `<picture>`:
   `<source type=image/avif>` → `<source type=image/webp>` → `<img>` (jpg/png
   как последний fallback). Не отдавать голый jpg там, где webp/avif экономят
   30–70%.
2. **Размерная сетка + `srcset`/@2x.** Отдавать несколько ширин под реальные
   слоты + `2x` для retina; браузер выбирает. Не грузить 3000px в слот 400px.
   `sizes` — под фактическую раскладку.
3. **Naming-конвенция.** `<block>-<slug>[-<variant>]@<density>.<ext>`
   (`hero-media@2x.avif`). Стабильные имена по слагам блоков — не `IMG_2931.png`.
4. **lazy vs priority.** Below-the-fold → `loading="lazy"`. **LCP-изображение
   (hero) — НЕ lazy**: `fetchpriority="high"` (+ preload при нужде). Ленивый hero
   = провал LCP.
5. **Anti-CLS: `aspect-ratio`/width+height всегда.** У каждого `<img>` заданы
   размеры или `aspect-ratio`, чтобы слот резервировался до загрузки. Без этого
   — скачок layout при подгрузке.
6. **SVG: inline vs файл.** Иконки, которым нужен `currentColor`/интерактив →
   inline (или спрайт). Крупная статичная иллюстрация → файл (`<img>`). Любой
   SVG — прогнать через оптимизацию (svgo): убрать метаданные редактора,
   editor-обёртки, лишние группы.
7. **Видео: poster + политика preload.** `poster` обязателен (кадр до
   воспроизведения, держит LCP/CLS). Автоплей-фон — `muted playsinline
   preload=metadata` (не грузить весь файл вперёд). Тяжёлое видео below-fold —
   ленивый init.

## Антипаттерны

- Голый `<img src=hero.jpg>` без picture/srcset для крупной картинки.
- `loading="lazy"` на LCP-hero.
- `<img>` без width/height/aspect-ratio (CLS).
- 3000px исходник в 400px слот.
- SVG прямо из Figma-экспорта без svgo (метадата, id-мусор).
- Видео без poster и с `preload=auto` above-the-fold цепочкой.

## Когда отступать

Проектный image-CDN/loader (Next/Image, WP-плагин, Vite-плагин) берёт формат/
srcset/lazy на себя — использовать его, не дублировать вручную. Тогда задача —
кормить loader правильными исходниками и флагами (priority/aspect-ratio).
