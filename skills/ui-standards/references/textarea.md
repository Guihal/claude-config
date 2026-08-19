# Textarea

## Anatomy
Как input: field-обёртка → `<label>` + `<textarea>` + [hint | error | counter].

## Layout laws
- Наследует все законы input.md (padding, width: 100%, label, ошибки).
- Начальная высота — через `rows` (3–5), не через `height` в px.
- `resize: vertical` — дефолт; `resize: none` только при autosize.
- `min-height`, чтобы resize не схлопывал поле в одну строку.

## Variants & sizing
- Autosize (рост под контент) — `field-sizing: content` где поддерживается,
  JS-фоллбек только при реальной необходимости; всегда с `max-height` + scroll.
- Counter символов — при наличии `maxlength`, живёт в строке hint.

## States
Те же, что input: `hover`, `focus`, `disabled`, `readonly`, `invalid`.

## A11y
- `<label for>`; ошибки через `aria-describedby` + `aria-invalid`.
- Counter — `aria-live="polite"`, не спамить на каждый символ.

## Antipatterns
- `height: 120px` вместо `rows`.
- Autosize без max-height — форма на 3 экрана.

## Repo hint
Общие form-стили проекта; не дублировать стили input — общий класс/миксин поля.
