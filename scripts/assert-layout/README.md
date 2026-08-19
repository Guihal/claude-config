# assert-layout — декларативные layout-ассерты через CDP

Быстрый автоматический гейт для вёрстки: открывает страницу в headless chromium
на каждом брейкпоинте, ждёт стабилизации DOM и проверяет декларативные ассерты
(видимость, размеры, отсутствие горизонтального overflow).

Ноль зависимостей: chromium берётся из `~/.cache/ms-playwright` (или `CHROME_BIN`),
CDP — через глобальный WebSocket (Bun / Node 22+). Раннер — CLI, вызывается
вручную или как `CHECK:`-команда coverage-gate.

## Запуск

```bash
bun ~/.claude/scripts/assert-layout/assert-layout.ts [--config <path>]
```

Дефолтный конфиг: `./assert-layout.json` (относительно cwd).

## Конфиг

```json
{
  "url": "http://localhost:5173",
  "breakpoints": [375, 768, 1440],
  "settleMs": 400,
  "timeoutMs": 10000,
  "asserts": [
    { "name": "nav-visible", "selector": "nav", "checks": { "visible": true, "maxHeight": 100 } },
    { "name": "hero-no-overflow", "selector": ".hero", "checks": { "noHorizontalOverflow": true } }
  ]
}
```

Вместо `url` можно поднять dev-сервер самому:

```json
{
  "devServer": { "command": "npm run dev", "port": 5173, "waitMs": 30000 },
  "breakpoints": [375],
  "asserts": []
}
```

### checks

| check | смысл | тип |
|---|---|---|
| `visible` | элемент видим (bounding rect > 0×0) | bool |
| `maxHeight` | высота rect ≤ значения | число (px) |
| `maxWidth` | ширина rect ≤ значения | число (px) |
| `noHorizontalOverflow` | нет горизонтального overflow у document | bool |

## Exit-коды

- `0` — все ассерты на всех брейкпоинтах прошли
- `1` — есть FAIL (отчёт в stdout)
- `2` — ошибка конфига / окружения (chromium не найден, devServer не поднялся)

## Интеграция с coverage-gate

`coverage-gate.sh` выполняет `CHECK:`-команды из INVARIANT-блоков как
`timeout "$TIMEOUT" bash -c "$cmd"`. assert-layout встаёт как обычная CHECK-команда
(скрипт гейта править не нужно):

```md
INVARIANT: layout-desk — вёрстка без overflow и невидимых блоков

CHECK: bun ~/.claude/scripts/assert-layout/assert-layout.ts --config assert-layout.json
```

Внимание: дефолтный `COVERAGE_GATE_TIMEOUT=30` может не хватить на 3 брейкпоинта
с холодным стартом chromium — поднимите его:

```bash
COVERAGE_GATE_TIMEOUT=120 ./coverage-gate.sh
```

## Ограничения

- Проверяет статический/клиентский layout — не заменяет ui-audit (axe + sniffer)
  и lost-pixel (скриншот-дифф); это автоматический декларативный слой поверх них.
- Один `document`-уровень overflow; для per-element overflow — расширять checks.
- Сломавшийся chromium / ws — exit 2 с причиной в stderr.
