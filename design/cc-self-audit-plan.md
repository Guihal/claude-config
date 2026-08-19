# Design: ежедневный self-audit Claude Code → Telegram

Аналог `pipeline-analyst` (pi-рантайм), портированный на телеметрию Claude Code.
Существующий pi-контур (`analyst-cron.sh`, `pipeline-analyst`, `report.py`) не
трогается — это параллельный, независимый контур с собственным cron-слотом,
скриптами и стейтом.

## 0. Разведанная схема ~/.claude/projects/*/*.jsonl (факт, не гипотеза)

Прочитаны реальные файлы (`~/.claude/projects/-home-penis/*.jsonl`, суммарно 288M,
крупнейший файл 8M). Подтверждено:

- Один файл = одна сессия (`sessionId` в имени файла и в каждой строке), может
  растягиваться на несколько календарных дней — фильтровать НАДО по `timestamp`
  внутри строк, не по mtime файла.
- `type` верхнего уровня встречается как: `user`, `assistant`, `system`,
  `last-prompt`, `mode`, `permission-mode`, `attachment`, `ai-title`,
  `file-history-snapshot`, `file-history-delta`, `queue-operation`. Для аудита
  релевантны только `assistant` и `user`.
- `assistant`-строка: `message.content[]` — элементы `{"type":"tool_use","id":...,
  "name":"Bash"|"Edit"|"Write"|"Agent"|"Read"|"Skill"|..., "input":{...}}`. Это
  единственный источник «какой тул вызван».
- `user`-строка: `message.content[]` — элементы `{"type":"tool_result",
  "tool_use_id":"toolu_...", "is_error": true|false, "content": "..."}`.
  Join по `tool_use_id` ↔ `tool_use.id` даёт (имя тула, ошибка/нет). Это
  ЕДИНСТВЕННЫЙ источник ошибки — `is_error` (snake_case) внутри `tool_result`.
  **Уточнено критиком и перепроверено:** поля `isError` (camelCase) НЕТ нигде в
  `~/.claude/projects/**/*.jsonl` (`grep -rho '"isError"' ~/.claude/projects/`
  → 0 совпадений в jsonl; 24 совпадения находятся только в
  `*/tool-results/*.txt` — служебных side-car файлах, не в транскриптах).
  Верхнеуровневое поле `toolUseResult` СУЩЕСТВУЕТ, но это не структура с
  `isError`, а **либо dict с полезной нагрузкой тула (без флага ошибки), либо
  голая строка** (`"toolUseResult": "User rejected tool use"`,
  `"toolUseResult": "Error: Exit code 1\n..."`) — `digest.py` обязан делать
  `isinstance(tur, str)` перед `.get(...)`, иначе упадёт на первой же
  ошибочной строке. Ошибочность по `toolUseResult` эвристически определяется
  ТОЛЬКО через сам `is_error` в `tool_result` — `toolUseResult` полезен лишь
  как источник текста-evidence для цитаты в отчёте, не как флаг.
- Конкретные строки ошибок, реально встреченные в логах:
  - `"content":"Exit code 1\n..."` — упавшая bash-команда;
  - `"content":"The user doesn't want to proceed with this tool use. ...STOP..."`,
    `is_error:true` — юзер вручную отклонил permission-prompt. **Это и есть
    CC-аналог pi `user_abort`** — прямой сигнал фрустрации, порог см. §2.
  - `"content":"Exit code 144"` — убитый процесс (таймаут/интерапт).
- `interruptedMessageId` (верхнеуровневое поле) — юзер прервал генерацию
  ассистента на лету. Второй сигнал фрустрации, отдельный от reject.
- `hookErrors` / `hookInfos` (верхнеуровневые поля) — сбои хуков
  (SessionStart/Stop/PostToolBatch), если непусты.
- Субагенты: источник истины — файлы `<session-dir>/subagents/agent-<hash>.jsonl`
  (сам транскрипт субагента, парсится теми же правилами `is_error`, что и
  главный файл) **плюс** рядом лежащий `<session-dir>/subagents/agent-<hash>.meta.json`
  — прямая корреляция, найдена и подтверждена чтением реального файла:
  ```json
  {"agentType": "critic", "description": "...", "toolUseId": "toolu_01M7...", "spawnDepth": 1}
  ```
  `toolUseId` — это ровно `id` из `Agent`-tool_use в assistant-строке
  родительского файла: join `parent.assistant.tool_use.id == meta.json.toolUseId`
  однозначно связывает субагента с породившим его вызовом, а `agentType` даёт
  имя роли (`worker`/`critic`/`architect`/...) без парсинга `description`.
  `isSidechain` в главном файле — не понадобился, `meta.json` закрывает вопрос
  прямой корреляции; в разведанных файлах `isSidechain:true` не встречен ни
  разу заполненным, поэтому план его больше не использует.
- Объём: 288M суммарно по проекту `-home-penis`, отдельные файлы до 8M. **Сырой
  jsonl НИКОГДА не идёт в промпт целиком** — только агрегаты (см. §1).

## 1. Архитектура контура

```
crontab (04:30 daily, отдельно от pi-аналитика в 04:00)
   │
   ▼
~/.local/bin/cc-self-audit-cron.sh      (bash, flock + marker + @reboot catchup —
                                          копия паттерна analyst-cron.sh, свой лок-файл
                                          и своя marker-директория, НЕ переиспользует
                                          файлы pi-аналитика)
   │  cd ~/.claude/skills/cc-self-audit/scripts
   │  claude -p "$(cat ../cron-prompt.md)"
   ▼
claude -p (headless CC-сессия, дефолтная модель, без --model)
   │
   │  шаг 1: python3 digest.py --day $YESTERDAY
   │         (детерминированный препроцессор, БЕЗ LLM — сканирует jsonl,
   │          агрегирует, пишет компактный JSON; сырые события в промпт не идут)
   │
   │  шаг 2: модель читает digest JSON (единицы КБ, не МБ) + вчерашний digest
   │         (для дельт) + SKILL.md с порогами → интерпретирует, пишет
   │          полный отчёт .md на диск
   │
   │  шаг 3: модель формирует короткую сводку (шаблон §5) и шлёт её
   │          командой `tg-notify` (готовый транспорт, не переизобретать)
   ▼
~/.claude/stats/cc-self-audit/$YESTERDAY.json   (сырой агрегат — вход для завтрашней дельты)
~/.claude/stats/cc-self-audit/$YESTERDAY.md     (полный человекочитаемый отчёт)
Telegram (короткая сводка, полный отчёт остаётся файлом)
```

Новые файлы (план, ничего из этого пока не создано):

| путь | роль |
|---|---|
| `~/.local/bin/cc-self-audit-cron.sh` | лончер, копия паттерна `analyst-cron.sh` |
| `~/.claude/skills/cc-self-audit/SKILL.md` | процедура + контракт порогов, аналог `pipeline-analyst/SKILL.md` |
| `~/.claude/skills/cc-self-audit/cron-prompt.md` | промпт headless-сессии, аналог `cron-prompt.md` (полный текст — §4) |
| `~/.claude/skills/cc-self-audit/scripts/digest.py` | препроцессор-агрегатор (детерминированный, без LLM) |
| `~/.claude/stats/cc-self-audit/<date>.json` | сырой агрегат дня (для дельт) |
| `~/.claude/stats/cc-self-audit/<date>.md` | полный отчёт дня |
| crontab: `30 4 * * * ~/.local/bin/cc-self-audit-cron.sh` + `@reboot ... --catchup` | своя строка, не трогает существующую pi-строку |

Почему один скрипт, а не N (`tools.py`/`subagents.py`/... как у pi): у pi
скрипты разделены потому что телеметрия уже лежит по типам событий
(`telemetry/*.jsonl` плоский поток, `run-history.jsonl` отдельно,
`rules-debug.jsonl` отдельно) — разделение отражает разделение источников. У CC
источник один и тот же (jsonl-транскрипты), метрик меньше (нет injection/
discipline-эквивалентов вне зоны видимости — CC не пишет отдельный
rules-debug-лог), поэтому один проход одним скриптом с несколькими секциями
вывода — не хуже, но проще (ponytail: N скриптов оправданы у pi разделением
источников, здесь источник один → не копировать структуру бездумно).

## 2. Метрики, пороги, источник (в промпт передаются готовые агрегаты — сам
подсчёт делает digest.py)

| # | метрика | источник (jsonl-поле) | порог | severity |
|---|---|---|---|---|
| 1 | Sessions/day, turns/day | кол-во файлов `*.jsonl` (+ `subagents/*.jsonl`) с ≥1 строкой `timestamp` в окне; кол-во строк `type=="assistant"` в окне | — (базовые числа) | info |
| 2 | Tool err_rate (общий) | join `assistant.message.content[].type=="tool_use"` (по `id`) ↔ `user.message.content[].type=="tool_result"` (`is_error`, snake_case — единственный флаг ошибки, `isError`/camelCase не существует в jsonl) | > 20% | anomaly |
| 3 | Edit-tool err_rate | тот же join, `name in {"Edit","Write"}` | > 2% (edit-ошибки почти всегда bad `old_string`/промах пути — сигнал даже на низком проценте, по аналогии с pi-контрактом) | anomaly |
| 4 | User reject/interrupt count | `content` строки == `"User rejected tool use"` (`is_error:true`) ИЛИ непустой `interruptedMessageId` | >0 = note; спайк >2× к прошлому дню = anomaly | anomaly/note |
| 5 | Same-tool-same-args retry после ошибки (loop/зацикливание) | последовательные `tool_use` одного `name` с идентичным `input` (hash), где предыдущий `tool_result` для того же `id` был `is_error:true` — прямое нарушение правила из `~/.claude/AGENTS.md` § Tool error recovery ("identical retry после is_error = bug") | >0 в сессии = anomaly (правило юзера явно это запрещает) | anomaly |
| 6 | Subagent run failures | `subagents/agent-<hash>.jsonl`: та же логика (2)-(3) применённая ВНУТРИ каждого файла; агент-роль и корреляция с родителем — из соседнего `agent-<hash>.meta.json` (`agentType`, `toolUseId`); per-agentType err_rate | >20% per agentType = anomaly; любая ошибка `agentType in {worker, critic}` = всегда флаг (по аналогии с pi-контрактом «worker error = всегда флаг») | anomaly |
| 7 | Hook failures | верхнеуровневые `hookErrors`/`hookInfos` непустые | >0 = note | note |
| 8 | Дельта vs прошлый день (sessions, turns, tool err_rate, subagent err_rate) | сравнение `<date>.json` с `<date-1>.json` | изменение >50% = флаг `delta vs <дата>: <старое> → <новое>` | anomaly |
| 9 | Долгие/зацикленные сессии | сессия с turns намного выше типичного (> p95 за окно, эвристика: > 3× медианы дня) | note | note |

Всё это — детерминированный подсчёт в `digest.py`, не LLM-эвристика; модель в
headless-сессии интерпретирует уже готовые числа против порогов (роль как у
`cron-prompt.md`: раздел «что сравнивать» — не пересчитывать, а применять
контракт).

## 3. digest.py — контракт (описание, не код — это план)

```
usage: python3 digest.py --day YYYY-MM-DD [--prev-json PATH] [--json]
```

- Сканирует `~/.claude/projects/*/*.jsonl` (топ-уровень, только файлы вида
  `<uuid>.jsonl`, не заходя в `memory/`) + `~/.claude/projects/*/*/subagents/agent-*.jsonl`
  + соответствующие `~/.claude/projects/*/*/subagents/agent-*.meta.json`
  (не jsonl — обычный JSON, читается `json.load` целиком, файлы килобайтные).
- Для каждой строки jsonl: `json.loads`, `except json.JSONDecodeError: continue`
  (не падать на битой строке — счётчик `parse_errors`, в отчёт как note при >0).
- Ошибочность тула — ИСКЛЮЧИТЕЛЬНО через `tool_result.is_error` (snake_case)
  внутри `message.content[]`. Верхнеуровневое `toolUseResult` при чтении
  оборачивать в `isinstance(tur, dict)`/`isinstance(tur, str)` перед любым
  `.get(...)` — часто это голая строка (`"User rejected tool use"`,
  `"Error: Exit code 1\n..."`), не dict; используется только как текст-evidence
  для цитаты в отчёте, никогда как флаг ошибки.
- Субагент↔родитель: читать `meta.json` рядом с каждым `agent-<hash>.jsonl`,
  брать `agentType` (роль) и `toolUseId` (= `id` родительского `Agent`
  tool_use, для join при необходимости точной атрибуции таска). Ошибки внутри
  субагент-транскрипта считаются тем же `is_error`-правилом, что и в главном
  файле.
- Фильтр окна: `timestamp` внутри `[day 00:00, day+1 00:00)` локального времени
  (парсить ISO8601, `datetime.fromisoformat` + `.astimezone()`).
- Агрегирует метрики §2 в один `dict`, пишет:
  - `~/.claude/stats/cc-self-audit/<day>.json` (машиночитаемый, для завтрашней
    дельты — только числа, без сырых цитат);
  - при `--json` — тот же JSON в stdout (для читаемости из промпта/CI).
- Не читает/не меняет ничего из `~/.pi/agent/**` — отдельный контур.
- Единственная сторонняя зависимость — python3 stdlib (`json`, `datetime`,
  `pathlib`, `argparse`, `hashlib` для (5)) — без пакетов, ladder rung 3.
- exit code ≠0 при неустранимой ошибке (например, `~/.claude/projects` не
  существует) — cron-prompt должен на это реагировать остановкой без выдумывания
  цифр (тот же принцип, что и в `pipeline-analyst`).

## 4. Полный текст `~/.claude/skills/cc-self-audit/cron-prompt.md`

```markdown
Ты — аудитор пайплайна Claude Code. Прочитай скилл
/home/penis/.claude/skills/cc-self-audit/SKILL.md и выполни его процедуру для
вчерашнего дня (локальная дата).

## 1. Окно — вчера (локальная дата)

\`\`\`bash
YESTERDAY=$(date -d yesterday +%F)
[ -z "$YESTERDAY" ] && YESTERDAY=$(python3 -c "from datetime import date,timedelta; print((date.today()-timedelta(days=1)).isoformat())")
echo "$YESTERDAY" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || { echo "FAIL: cannot compute yesterday date"; exit 1; }
echo "window: $YESTERDAY"
\`\`\`

Если дата не вычислилась — остановись, отчёт о сбое без выдуманных цифр,
telegram НЕ слать.

## 2. Препроцессинг (детерминированный, без интерпретации)

\`\`\`bash
PREV=$(date -d "$YESTERDAY - 1 day" +%F)
PREV_JSON=/home/penis/.claude/stats/cc-self-audit/$PREV.json
cd /home/penis/.claude/skills/cc-self-audit/scripts
if [ -f "$PREV_JSON" ]; then
  python3 digest.py --day "$YESTERDAY" --prev-json "$PREV_JSON" --json
else
  python3 digest.py --day "$YESTERDAY" --json
fi
\`\`\`

- Скрипт пишет `/home/penis/.claude/stats/cc-self-audit/$YESTERDAY.json`
  (агрегат) и печатает тот же JSON в stdout.
- Если exit код ≠ 0 — остановись, отчёт о сбое, без выдуманных цифр,
  telegram НЕ слать.
- `parse_errors` > 0 в выводе — не сбой, но отметь как note в отчёте
  (сколько строк не распарсилось).
- **Сырой jsonl НЕ читай целиком.** Раздел 3 SKILL.md разрешает точечный
  `grep`/`tail` по конкретному session-файлу ТОЛЬКО для deep-dive одной
  конкретной аномалии (одна цитата-evidence), не для пересчёта агрегатов.

## 3. Интерпретация — контракт порогов

Применяй пороги §2 из SKILL.md (edit-tool >2%, tool >20%, subagent >20% per
agent, дельта >50%, любая ошибка агента worker/critic = всегда флаг, retry
после is_error = всегда anomaly, user reject/interrupt >0 = note, спайк >2× =
anomaly). Не занижай и не придумывай новые пороги.

## 4. Формат полного отчёта (запись, overwrite)

Путь: `/home/penis/.claude/stats/cc-self-audit/$YESTERDAY.md`.

\`\`\`
# CC self-audit — $YESTERDAY
Window: $YESTERDAY (local date)

<резюме-абзац: 2-4 предложения — общая картина, топ-риски, что делать>

## Sessions & Turns
## Tool Telemetry
## Subagents
## User Friction (rejects/interrupts)
## Anomalies
  - <метрика>: значение=<v> порог=<t>; evidence: "<цитата из digest.json или точечного grep>"
## Recommendations
  - конкретное действие (что чинить, где, как проверить)
\`\`\`

Если по метрике нет данных (0 сессий за день, скрипт не нашёл файлов) — пиши
это явно, не пропускай секцию молча.

## 5. Telegram-сводка (обязательный последний шаг)

Собери короткую сводку СТРОГО по шаблону (не длиннее ~500 символов, без
таблиц, без markdown-заголовков — читается с телефона):

\`\`\`
🩺 CC self-audit — $YESTERDAY
Сессий: <N> (Δ<±X%>) · Turns: <N>
Tool err: <X%> (edit: <Y%>) <OK/⚠️>
Subagents: <N> прогонов, <M> ошибок <OK/⚠️>
User friction: <N> reject/interrupt <OK/⚠️>
Топ: <одна строка главной аномалии или "аномалий нет">
Полный отчёт: ~/.claude/stats/cc-self-audit/$YESTERDAY.md
\`\`\`

Отправь: `tg-notify "<текст сводки>"`. Если `tg-notify` вернул ненулевой код —
это НЕ повод переписывать уже сохранённый .md отчёт; просто зафиксируй сбой
отправки в конце ответа сессии.

## 6. Self-check

1. `grep -E '^## ' /home/penis/.claude/stats/cc-self-audit/$YESTERDAY.md` — должно
   быть 5 секций (Sessions & Turns / Tool Telemetry / Subagents / User Friction /
   Anomalies) + Recommendations, плюс заголовок и резюме-абзац.
2. Digest повторно НЕ запускай (один прогон `digest.py` за сессию; максимум ещё
   один — если `--prev-json` отсутствовал и понадобился пересчёт прошлого дня).
3. `~/.pi/agent/**` НЕ трогай — read-only зона, чужой контур.

## 7. Ответ

В конце — один абзац-саммари (2-4 предложения): общая картина дня, топ-риск,
статус отправки в Telegram (успех/сбой).
```

## 5. Шаблон телеграм-сводки (дублирует §4 промпта, для быстрой сверки)

```
🩺 CC self-audit — 2026-08-10
Сессий: 7 (Δ+12%) · Turns: 340
Tool err: 4% (edit: 1%) OK
Subagents: 12 прогонов, 1 ошибка ⚠️
User friction: 2 reject/interrupt OK
Топ: subagent worker err_rate 33% (4 прогона, 1 fail) — таск-hash abc123
Полный отчёт: ~/.claude/stats/cc-self-audit/2026-08-10.md
```

~280 символов при заполненных полях — далеко от 4096-лимита `tg-notify`,
читается за 5 секунд с телефона.

## 6. cron-строка (для этапа реализации, НЕ выполняется в рамках этого плана)

```
30 4 * * * /home/penis/.local/bin/cc-self-audit-cron.sh
@reboot /home/penis/.local/bin/cc-self-audit-cron.sh --catchup
```

Добавляется отдельными строками в тот же `crontab -e`, существующие 2 строки
pi-аналитика не трогаются. Сдвиг на 04:30 (не 04:00) — чтобы не конкурировать
за диск/CPU с уже запланированным pi-прогоном, лок-файлы разные
(`~/.local/share/cc-self-audit/.audit.lock` vs
`~/.local/share/analyst-cron/.analyst.lock`), маркеры разные директории.

## 7. Что сознательно не строим (ponytail)

- Никакого демона/watcher — cron достаточен, прогон раз в сутки.
- Никакой БД — два файла в день (`.json` агрегат + `.md` отчёт) на диске,
  ротация не проектируется отдельно (то же решение, что и у pi — файлы
  копятся, юзер сам чистит при необходимости; если станет проблемой —
  добавить `find ... -mtime +90 -delete` одной строкой, не сейчас).
- Никакого отдельного модуля для subagent-корреляции id↔файл — если на этапе
  реализации выяснится, что корреляция нужна для точности, это один `grep`/
  join внутри `digest.py`, не отдельный сервис.
- Telegram-сводка не пытается быть исчерпывающей — она триггер «иди читай
  .md», не замена отчёту.

## Acceptance (независимые чеки; каждый — команда + ожидаемый вывод)

1. **Схема jsonl не выдумана.**
   Чек: `python3 -c "import json; [json.loads(l) for l in open('/home/penis/.claude/projects/-home-penis/158be5f7-2379-4929-aad5-f4c66fc1e460.jsonl') if l.strip()]" && echo PARSE_OK`
   Ожидаемо: `PARSE_OK` (подтверждает, что файл — валидный jsonl, схема бралась
   из реального файла, не из головы).

2. **tool_use ↔ tool_result join реально возможен по `id`/`tool_use_id`.**
   Чек:
   ```bash
   python3 - <<'EOF'
   import json
   ids_use=set(); ids_res=set()
   for line in open('/home/penis/.claude/projects/-home-penis/158be5f7-2379-4929-aad5-f4c66fc1e460.jsonl'):
       line=line.strip()
       if not line: continue
       d=json.loads(line)
       msg=d.get('message',{})
       for item in (msg.get('content') or []) if isinstance(msg,dict) else []:
           if isinstance(item,dict):
               if item.get('type')=='tool_use': ids_use.add(item['id'])
               if item.get('type')=='tool_result': ids_res.add(item['tool_use_id'])
   print(len(ids_use), len(ids_res), len(ids_use & ids_res))
   EOF
   ```
   Ожидаемо: третье число (пересечение) > 0 и близко к min(первых двух) —
   join реально работает на реальных данных.

3. **tg-notify пригоден для headless-отправки.**
   Чек: `tg-notify "cc-self-audit plan acceptance check $(date -Iseconds)"` (юзер
   запускает вручную один раз перед включением в крон).
   Ожидаемо: сообщение приходит в Telegram, `echo $?` = `0`.

4. **Объём данных не взрывает промпт.**
   Чек: `du -sh /home/penis/.claude/projects/ | cut -f1` (уже выполнено:
   `288M`).
   Ожидаемо: агрегат `digest.py` (JSON с ~15-20 числовыми полями) на 3-4
   порядка меньше исходных 288M — реализация обязана НЕ читать это целиком в
   промпт headless-сессии, только output digest.py (единицы КБ).

5. **pi-контур не задет.**
   Чек: `crontab -l | grep -c analyst-cron` до и после внедрения плана.
   Ожидаемо: одинаково (2 строки — 04:00 daily + @reboot), новый контур
   добавляет ДВЕ ДРУГИЕ строки, не модифицирует существующие.

6. **user_abort-аналог существует и извлекаем.**
   Чек: `grep -c '"User rejected tool use"' /home/penis/.claude/projects/-home-penis/bc7f509d-acdf-44ee-92bb-64317d347bcd.jsonl`
   Ожидаемо: число >0 (подтверждено разведкой — сигнал реально встречается в
   логах, не гипотетический).

7. **Retry-после-ошибки правило (AGENTS.md) имеет источник данных для метрики
   #5.** Чек: перечитать `~/.claude/AGENTS.md` секцию «Tool error recovery» —
   `grep -A2 "identical retry" ~/.claude/AGENTS.md`.
   Ожидаемо: непустой вывод — правило существует и текстуально совпадает с
   формулировкой метрики #5 в этом плане.
