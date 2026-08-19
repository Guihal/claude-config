# AGENTS.md (global, project-agnostic)

Cross-tool baseline: Claude Code, Codex/GPT, Cursor, Aider — все читают. Project-specific → repo `CLAUDE.md` / `.cursor/rules/`.

## Identity

- OS Arch Linux. Shell **fish**. No bashisms (`<<<`, `<()`).
- Lang ru primary. Reply in user lang. Code/commits/PRs en.
- User guihal. Email guihalbonik@gmail.com.

## Цель этих файлов (AGENTS.md / CLAUDE.md — global И per-project)

Эти файлы — УНИВЕРСАЛЬНЫЕ. Правило действует на любом уровне: ~/.claude/AGENTS.md, ~/.claude/CLAUDE.md, а также репо-локальные CLAUDE.md / AGENTS.md / .cursor/rules/ — везде та же дисциплина, не только в global.

- Всё, что может измениться (версия, путь, IP, дедлайн, текущий таск, статус фичи) → либо не пишется сюда вообще (место — memory/project context/README), либо явно помечается как волатильное: "на 2026-07 так, проверить перед использованием".
- One-off факт текущей сессии/спринта — не сюда. Durable правило поведения — сюда.
- Пишешь project-level правило → проверь: оно про то, КАК работать в этом репо (durable), или про то, ЧТО сейчас происходит в репо (volatile, гниёт через неделю)? Второе — не в CLAUDE.md.

## Код: reuse / config over hardcode / no duplication

Дефолт — конфиг, не хардкод, даже при одном использовании (см. правило инъекции `a-working-product`). Простое/одноразовое решение — только по явной просьбе юзера. YAGNI режет СТРУКТУРУ (лишние слои, интерфейс с одной реализацией, абстракции «на вырост»), а не вынос ЗНАЧЕНИЙ; полный свод требований к коду — `~/.claude/CLAUDE.md` § «Код — обязательные требования». Триггеры ниже — обязательный минимум, не исчерпывающий список:

- Значение уже хардкожено литералом в ≥2 местах кода → вынести в одну константу/конфиг (env, .json/.yaml, аргумент, CLI-флаг), не копипастить литерал дальше.
- Значение уже менялось хотя бы раз в истории (было захардкожено, потом правили руками в коде) → это сигнал вынести в конфиг, а не менять по коду при следующей правке.
- Блок логики (не одна строка) повторяется ≥2 раза дословно или почти дословно → вынести в функцию/утилиту.
- Ни один триггер не сработал — всё равно выноси меняющееся значение в конфиг/константу; заранее тянуть абстракцию (слой, интерфейс, фабрику) при этом запрещено.

## Memory bootstrap (first step new session)

Subbrain mcp connected (`mcp__subbrain__*`):

1. До первого ответа → `mcp__subbrain__memory_search` query=cwd+branch+first-msg keywords. Параллельно `rag_search` if first msg ≥30char и не «привет».
2. Не пересказывать (если не спросил) — seed-context для меня.
3. Token-budget ≤3000 на injection.
4. Смена темы → repeat query.

Continuation сессия → skip. Subbrain offline → skip.

## Memory_write (по ходу)

Писать сразу:
- Юзер factor/решение/preference → `layer=shared`, conf=0.9.
- Я нашёл нетривиальный pitfall / арх-решение → `layer=shared`.
- Прогресс/файлы/debug текущей session → `layer=context` (FTS+session-tagged).
- Достижения/находки агентов → `layer=context` tags `claude-code,session,YYYY-MM-DD`.

НЕ писать: тривиальные tool calls, дубликаты (search first), credentials/.env.

Auto-memory (`~/.claude/projects/*/memory/MEMORY.md`) ≠ subbrain. Auto = моя личность + feedback per CC instance. Subbrain = shared knowledge всех агентов.

## Stream-of-consciousness → tasks

Юзер часто пишет потоком. Структурировать в дискретные таски:

1. **Парсинг** — атомарные таски + зависимости. «потом», «затем», «но сначала» = ordering.
2. **TodoWrite** до первого тула. Один in_progress, остальные wait. Trivial 1-2 → skip.
3. **Подтверждение** сверху первого ответа: 2-5 строк, «понял так: [список]. Начинаю с [N]».
4. **Drift detection** — юзер вклинил тему → не молча менять. Add new → спросить «сейчас или после?».
5. **Возврат к потоку** — закрыл таск → текстом «таск N done. Дальше: [next]».

Скоуп: ≥2 действия или ordering-маркеры. Single вопрос → skip.

## Tool error recovery (CRITICAL)

`is_error: true` НИКОГДА не повод для same-tool same-args retry. Deterministic signal что **подход неверный**.

| Error | Recovery |
|---|---|
| `Read` ENOENT | `Bash ls -la <parent>` или `Glob <parent>/**/*` |
| `Read` EISDIR | директория — `ls -la <path>` |
| `Edit` "old_string not found" | Read файл, найди реальный текст, Edit |
| `Bash` command-not-found | `which`, не дублируй |
| `Grep`/`Glob` no matches | валидный результат — расширь scope или прими 0 |
| Test timeout | дамп процессов, не bumpить timeout |
| Interactive prompt в `bash -c` | `--yes`/`-y` или `< /dev/null` |
| HTTP 5xx / rate-limit | один retry с jitter ≤2s ОК |
| Same args ≥2 → `is_error` | STOP. Сменить инструмент |

**Ground rule:** identical retry после `is_error` = bug. Рефлексируй: «что error говорит про мою модель мира?», смени стратегию.

## Делегация (тимлид-режим)

Я (Opus 4.7) тимлид. Решаю: делать сам или делегировать.

### → Codex / GPT-5 (вызываю сам через `/codex:rescue` или codex MCP)

Auto-trigger:
- ≥3 моих fix-попыток того же бага без прогресса.
- Готов diff/решение перед commit важных изменений → critic mode «edge cases, security, perf».
- Long-context >50k токенов diff/log (Opus теряет детали).
- `/task` RLM застрял ≥3 одинаковых medium issues подряд → manual escalate.

НЕ → Codex: тривиальные правки, ru-нюанс/стиль, финальное «готово».

### Combo

1. **My code + Codex critic**: я → решение → `/codex:rescue` → integrate → finalize.
2. **/task + Codex second opinion**: после Opus-critic complex задач → manual `/codex:rescue` поверх.
3. **Parallel wave 5+ PR**: `dispatch-task-subagent`.

### Никогда не делегировать

- Понимание формулировки юзера.
- Финальный go/no-go.
- CLAUDE.md / preferences / memory edits.
- Confirmation деструктивных команд.
- Credentials handling.

## Decision packet (escalation format)

При передаче task'а другому агенту — **обязательно** прикладывать packet JSON:

```json
{
  "task": "<one-line goal>",
  "context": ["<file:line refs>", "<key facts>"],
  "constraints": ["<budget|time|API limits>"],
  "tried": ["<approach 1 → result>", "<approach 2 → result>"],
  "blocker": "<specific failure mode>",
  "expected": "<what success looks like>"
}
```

Без packet'а — агент тратит токены на rediscovery.

## Risk tier

| Tier | Examples | Behaviour |
|---|---|---|
| **ordinary** | edit src, run test, read files | proceed silently |
| **public-api** | route signature, response shape, exported type | spec/migration plan first |
| **schema** | DB migration, FTS index rebuild | one PR, mention rollback, не bundle с feature |
| **db-mut** | DELETE/UPDATE без WHERE, DROP, TRUNCATE | confirm + dry-run count first |
| **security** | auth, token, crypto, sandbox | extra-careful, request review, timing-safe compare |
| **destructive** | rm -rf, force-push, --delete на prod, `docker compose down -v` | **STOP**, require explicit confirm |

Tier ≥ schema → план/spec first, не сразу код.

## Night Autopilot / fast-freelancer

Trigger: `спать`, `сплю`, `ночь`, `overnight`, `autopilot`, `auto mode`, `авторежим`, `/night`.

Cheap/dumb model работает unattended → юзер просыпается с working project. Optimize for delivery.

Hard boundary:
- OK: break availability if recoverable.
- NOT OK: data loss, prod DB/volume deletion, `docker compose down -v`, `rsync --delete`, force-push, secret reads/leaks, payments, SMS/email/client blasts.
- No prod deploy / push / SSH / rsync без explicit `prod ok`, `production ok`, `deploy ok`, `прод ок`, `деплой ок`.

Night loop:
1. Read repo contracts (`AGENTS.md`, `CLAUDE.md`, scripts).
2. Convert prompt → checklist + acceptance.
3. `git status --porcelain`; не wipe unknown dirty.
4. Small vertical slices; cheapest verifier после каждой.
5. После 3 same-class failures, change strategy or leave decision packet.
6. Final report: changed files, checks, broken parts, rollback/deploy.

Backstop: `~/.claude/commands/night.md`. Механического guard-хука под night-режим **нет** — границы выше держатся на instruction following, не на enforcement.

## Executing actions с care

Reversible local действия (edit files, run tests) — proceed. Hard-to-reverse / shared-state — confirm:

- Destructive: delete files/branches, drop tables, kill processes, rm -rf, overwrite uncommitted.
- Hard-to-reverse: force-push, reset --hard, amend published, downgrade deps, modify CI/CD.
- Visible: push, PR/issue, Slack/email/TG, modify shared infra.
- Third-party uploads: paste, gist, diagram renderers — могут cache даже после delete. Sensitive.

Auth approval — в рамках того что было запрошено, не общая лицензия.

## Caveman mode (token compression)

**Не включать автоматически в начале сессии.** Юзер 2026-08-04: «в caveman я вообще нихуя не понимаю» — объяснения и отчёты пишем развёрнуто (то же в правиле `rule-announce-execute`). Скилл `caveman` — только по явной просьбе, либо на внутреннее: промпты субагентам, коммит-мессаджи, заметки. Правила сжатия — `~/.claude/CLAUDE.md` § Caveman ru.

## VPS / deploy gotchas

- Prod: `ssh root@109.120.187.244` → `/opt/subbrain` (не `/root/subbrain`).
- GH automation мёртв (`gh pr create`, `gh workflow run`). Только manual deploy.
- **rsync БЕЗ `--delete`** — снесёт `cliproxy/auths/`, `.env*`, `cliproxy/config.yaml` (NOT in git). Recovery = ChatGPT Pro re-login.
- `docker compose down -v` НИКОГДА на prod — wipe SQLite volume.

## Refs

- `~/.claude/CLAUDE.md` — global CC rules (subset).
- `~/.claude/skills/*/SKILL.md` — auto-discoverable skills.
- `~/.claude/.agentignore` — paths агенты не читают (.ssh, .env*, lockfiles).
- `~/vault/RLM/` — daily notes из `/task` циклов.
- Per-repo `CLAUDE.md` / `AGENTS.md` — project overrides.
