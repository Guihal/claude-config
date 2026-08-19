# Harness improvements — сводка 5 аудитов + решения сессии

> ## ⚠️ СТАТУС: ДРАФТ. АПРИОРИ НЕВЕРЕН.
>
> Этот файл написан **главной сессией по ходу диалога**, то есть ровно тем агентом, чья
> склонность к раннему якорению и является одной из проблем, описанных ниже (D-06).
> Он **не прошёл** ни планировщика со свежим контекстом, ни критика, ни верификатора.
>
> **Как его читать любому агенту, которому его дали:**
> - это **вход для перепроверки**, а не источник истины;
> - каждое утверждение здесь либо помечено `CONFIRMED` с командой-доказательством, либо
>   является **гипотезой**, которую надо доказать или опровергнуть;
> - раздел «Решения сессии» — это **черновик намерения пользователя**, а не согласованный
>   контракт: формулировки могли исказить интент, состав фаз может быть неполным;
> - **противоречие между этим файлом и живым `~/.claude` разрешается в пользу живого `~/.claude`**;
> - **противоречие между этим файлом и репликами пользователя в кристалле разрешается в пользу кристалла.**
>
> Дата: 2026-08-17. Автор: главная сессия Claude Code (Opus 5).

---

## 1. Источники

Пять независимых аудит-отчётов по snapshot'у harness'а (`05c282dd`, 10 августа):

| # | Файл | Основные темы |
|---|---|---|
| 1 | `~/Загрузки/Харнесс/1.txt` | SWE-RPG (потеря неявных требований), majiayu000/harness, двойные role specs, write-capable гейты, requirement provenance |
| 2 | `~/Загрузки/Харнесс/2.txt` | Agentic Harness Engineering, Scaffold Effect, OpenAgentHarness, отсутствующий night guard, telemetry contract |
| 3 | `~/Загрузки/Харнесс/3.txt` | Living-Harness, Delivery-not-Storage, UniHarness, дефекты `dispatch-task-subagent`, scope-конфликт |
| 4 | `~/Загрузки/Харнесс/4.txt` | LongHorizon-Harness, Google Agent Executor, HarnessFix, отключённый verifier, revision-bound verdicts, fail-open парсер |
| 5 | `~/Загрузки/Харнесс/5.txt` | Harness Handbook, DataFlow-Harness, EMAS, SkillJack, безбюджетные петли, permission boundary, behavior map |

Аудиты писались по snapshot'у; живой `~/.claude` **не является git-репозиторием**
(`cd ~/.claude && git log` → `fatal: не найден git репозиторий`), поэтому расхождения
snapshot ↔ живое состояние реальны и проверялись отдельно.

## 2. Легенда статусов

| Статус | Значение |
|---|---|
| `CONFIRMED` | проверено командой по живому `~/.claude`, доказательство приведено |
| `PARTIAL` | подтверждено частично; часть утверждения не проверялась |
| `HYPOTHESIS` | из отчёта, механически не проверялось |
| `COURSE` | не дефект, а подтверждение выбранного направления |

`consensus` = сколько из 5 отчётов подняли эту тему независимо. 3+ — сильный сигнал,
1 — одиночное наблюдение.

---

## 3. Находки

### Сводная таблица

| ID | Тема | Sev | Consensus | Статус |
|---|---|---|---|---|
| F-01 | Двойные role specs (roles/* vs agents/*) | HIGH | 1 | CONFIRMED |
| F-02 | «Read-only» гейты механически write-capable | HIGH | 1 | CONFIRMED |
| F-03 | Requirement provenance отсутствует; неявные требования теряются | HIGH | 1 (+ юзер) | CONFIRMED |
| F-04 | Night backstops обещаны, файлов нет | HIGH | 1 | CONFIRMED |
| F-05 | AGENTS.md заявлен cross-tool, семантика CC-specific | MEDIUM | 2 | CONFIRMED |
| F-06 | Нет telemetry/run-event contract | HIGH | 3 | CONFIRMED |
| F-07 | Нет harness change manifest | MEDIUM | 2 | HYPOTHESIS |
| F-08 | `dispatch-task-subagent` зовёт несуществующий `Skill task` | HIGH | 1 | CONFIRMED |
| F-09 | Взаимоисключающие verdict-контракты (JSON vs MD) | HIGH | 1 | CONFIRMED |
| F-10 | Scope-конфликт: «чинить любой баг» × «scope lock» | HIGH | 2 | CONFIRMED |
| F-11 | `verifier` не подключён к task-флоу | HIGH | 1 | CONFIRMED |
| F-12 | Вердикт не привязан к ревизии артефакта | HIGH | 1 | CONFIRMED |
| F-13 | `parse_error` — fail-open | HIGH | 1 | CONFIRMED |
| F-14 | Нет failure attribution schema | MEDIUM | 2 | HYPOTHESIS |
| F-15 | `task-complex`: петли ревью без бюджета | HIGH | 1 | CONFIRMED |
| F-16 | Permission boundary держится на строковом deny | HIGH | 2 | CONFIRMED |
| F-17 | Нет behavior map | MEDIUM | 1 | HYPOTHESIS |
| F-18 | Хардкод `/home/penis`, нет version pinning | MEDIUM | 1 | CONFIRMED |
| F-19 | Memory: delivery > storage, cue-injection | — | 1 | COURSE |
| F-20 | Generic: control plane, runtime ≠ computer | — | 4 | СЛОЙ B |
| F-21 | Task-тулов в Claude Code не существует | HIGH | 0 (найдено сегодня) | CONFIRMED |
| F-22 | План пишет тот же агент, что задал направление | HIGH | 0 (юзер, сегодня) | ПРИНЯТО |

### Детали

#### F-01 — Двойные role specs · HIGH · CONFIRMED
Operator считает каноном `skills/system-constitution/roles/{reviewer,teamlead}.md`, но рантайм
стартует `agents/{constitution-reviewer,teamlead}.md`, которые сами объявляют себя ролями той же
конституции. Копии уже разъехались (у `agents/teamlead.md` есть обязательный nested task-cycle и
negative-probe, у декларативного — другая процедура решения).
**Доказательство:** `ls ~/.claude/skills/system-constitution/roles/` → `reviewer.md teamlead.md`;
`ls ~/.claude/agents/` → `constitution-reviewer.md teamlead.md`.
**Фикс:** один source of truth на роль; runtime-файл содержит только frontmatter-адаптер.
**Чек:** после фикса тело роли встречается в дереве ровно один раз.

#### F-02 — «Read-only» гейты write-capable · HIGH · CONFIRMED
**Доказательство:** `critic/architect/verifier: tools: Read, Bash, Grep, Glob, Write`;
`teamlead/constitution-reviewer/auditor: ... Edit, Write`. Текст ролей при этом многократно
запрещает любые записи. Граница capability = граница прозы.
**Фикс:** `Edit` снять у всех гейтов; `Write` оставить только там, где роль физически обязана
писать вердикт, а иммутабельность обеспечить стором (см. D-04), а не доверием к роли.

#### F-03 — Requirement provenance · HIGH · CONFIRMED
SWE-RPG (отчёт 1): implicit requirement recovery — причина 24.5–46% провальных траекторий, средний
solve rate 31.5% на 163 задачах. В harness нет ни одного объекта «требование» со stable ID:
**доказательство:** `grep -rn "REQ-[0-9]\|requirement id\|requirements catalog" skills/task-simple/SKILL.md
skills/task-complex/SKILL.md skills/operator/SKILL.md agents/critic.md` → пусто.
Хуже: критик **не обязан** искать неявные требования — `grep -n "implicit\|неявн" agents/critic.md
agents/architect.md` → пусто.
**Фикс:** см. D-07 (requirement provenance: явные требования — механикой, неявные — критиком).

#### F-04 — Night backstops обещаны, файлов нет · HIGH · CONFIRMED
`AGENTS.md:158` называет backstops `hooks/night-autopilot-context.sh` и `hooks/night-autopilot-guard.sh`.
В `hooks/` их нет (`ls ~/.claude/hooks | grep -i night` → пусто), в settings.json night-guard не
зарегистрирован. При `defaultMode: bypassPermissions` единственный барьер ночью — instruction following.
**Решение пользователя:** ссылки удалить (Ф0). Guard как таковой — отдельная тема, см. F-16.

#### F-05 — AGENTS.md: cross-tool на словах · MEDIUM · CONFIRMED
Файл объявлен baseline для CC / Codex / Cursor / Aider, но требует `TodoWrite`, `Agent`,
`TaskCreate`, `SendMessage`, `/codex:rescue`, `mcp__subbrain__*`.
**Фикс (постепенный):** policy/* — инвариант, adapters/claude-code/* — способ исполнения.
Не переписывать сейчас; просто перестать добавлять CC-детали в cross-tool слой.

#### F-06 — Нет telemetry contract · HIGH · CONFIRMED (3 отчёта)
`~/.claude/telemetry/` содержит только `1p_failed_events.*.json` самого Claude Code — никакой схемы
harness-событий. Значит нельзя связать правку critic/hook/memory с tokens/task, tool errors, critic
iterations, verification failures, wall time. Scaffold Effect: разброс до 40× по tokens per solved
task между harness'ами при той же модели.
**Фикс:** run/stage/tool/error/verify/token/time схема в репо, данные — вне.

#### F-08 — `Skill task` не существует · HIGH · CONFIRMED
**Доказательство:** `skills/dispatch-task-subagent/SKILL.md:113` → ``3. Invoke `Skill task` with arg:``.
В `skills/` есть только `task-simple` и `task-complex`.
**Фикс:** заменить на `task-simple`, depth оставить аргументом. Тривиально.

#### F-09 — Два взаимоисключающих verdict-контракта · HIGH · CONFIRMED
`dispatch-task-subagent:259,263` требует «ONE JSON object, no markdown fences»;
`agents/critic.md:72` требует «exactly one MD verdict block, любое отклонение = parse error».
Критик, корректно исполняющий свою роль, гарантированно валит dispatch-гейт.
**Фикс:** один verdict-контракт на весь harness (D-04 снимает вопрос: контракт задаёт тул).

#### F-10 — Scope-конфликт · HIGH · CONFIRMED (2 отчёта)
`CLAUDE.md`: «любой баг, который ВОСПРОИЗВОДИТСЯ — чинить сразу, в том же диффе… Out-of-scope как
причина не чинить не существует». `dispatch-task-subagent:129`: «Scope lock: only modify files listed
in plan §Файлы», и parent-critic обязан флагать всё вне §Файлы как scope creep.
Воркер физически не может исполнить оба правила.
**Фикс (единая семантика):** баг блокирует acceptance текущей задачи **или** вызван текущим диффом →
чинить в этом же диффе с явной записью; иначе → defect-артефакт с reproduction evidence.

#### F-11 — `verifier` не подключён · HIGH · CONFIRMED
`agents/verifier.md` объявляет себя финальным acceptance-гейтом. **Доказательство:**
`grep -n "verifier" skills/task-simple/SKILL.md skills/task-complex/SKILL.md` → **ноль совпадений**.
Компонент написан и не вызывается ни одним основным флоу.
**Фикс:** в full-mode после impl-critic — ровно один обязательный verifier: FAIL → назад в
имплементацию, BLOCKED → эскалация, PASS → done.

#### F-12 — Вердикт не привязан к ревизии · HIGH · CONFIRMED
Каждый драфт плана перезаписывает один и тот же путь; вердикты лежат свободными файлами в
`~/.claude/verdicts/<stem>/<role>.json`. Доказать, что PASS относился именно к текущему тексту,
нечем. То же и в pi-сторе: `repo/paths.ts` знает `crystal.md`, `plan.md`, `reviews.md` — **без версий**.
**Фикс:** D-04 (content-sha + иммутабельные снимки ревизий + stale-инвалидация).

#### F-13 — `parse_error` fail-open · HIGH · CONFIRMED
`skills/task-simple/SKILL.md:180` и `skills/task-complex/SKILL.md:158`: «If the retry also fails, mark
`parse_error`, keep the current artifact, and finish with a warning». Отсутствие машиночитаемого
вердикта превращается не в BLOCKED, а в пропуск обязательного гейта.
**Фикс:** parse_error после ретрая → `REVIEW_BLOCKED`, никогда не PASS.

#### F-15 — Петли ревью без бюджета · HIGH · CONFIRMED
`task-complex/SKILL.md` — «No plan-budget cap» (:170), «No budget cap; keep iterating» (:183, :208, :310),
явный раздел «No per-complexity budget» (:116). У `task-simple` бюджеты есть (:104–110), но их
исчерпание = продолжаем с `maxDepth_plan`/`maxDepth_impl` warning (:193, :211) — тоже fail-open.
**Фикс:** max rounds + no-progress детектор + терминальный ESCALATE (fail-closed).

#### F-16 — Permission boundary · HIGH · CONFIRMED (2 отчёта)
`defaultMode: bypassPermissions`, `skipDangerousModePermissionPrompt: true`,
`skipAutoPermissionPrompt: true`; `allow: [Bash, Edit, Read, ...]`; `deny` — 29 записей, из них
Bash-деструктив это 8 **точных строковых форм**: `docker compose down -v|--volumes`,
`docker-compose down -v`, `git reset --hard`, `git clean -fd|-fdx`, `git push --force|-f`.
**`rm -rf` в deny отсутствует**, хотя AGENTS.md относит его к tier «destructive → STOP».
Любая вариация формы (`rm -fr`, `--force` через алиас, скрипт-обёртка) проходит.
**Фикс:** PreToolUse-guard, классифицирующий фактическую команду и аргументы по классам эффектов
(разрушение ФС, мутация истории git, секреты, prod/сеть), а не список строк.

#### F-18 — Непереносимость окружения · MEDIUM · CONFIRMED
`grep -c "/home/penis" settings.json` → **10**. Плюс плагины/marketplaces без pinning версий.
**Фикс:** generated manifest `компонент → источник → точная версия/commit` + `$HOME`-относительные пути.

#### F-21 — Task-тулов в Claude Code нет · HIGH · CONFIRMED (найдено сегодня)
Хук `UserPromptSubmit` каждое сообщение требует: «Первое действие после сообщения юзера — обнови
список задач… Тулы задач deferred → ToolSearch».
**Доказательство:** `ToolSearch select:TodoWrite,TaskCreate,TaskUpdate,TaskList,TaskGet` →
`No matching deferred tools found`. Требование невыполнимо механически: инструмента не существует.
В pi он есть — `@tintinweb/pi-tasks` v0.7.2 (MIT), ядро `src/task-store.ts` (364 строки).
**Фикс:** Ф3 — порт в MCP.

#### F-19 — Memory: delivery, а не storage · COURSE
Отчёт 3: добровольное обращение агента к памяти — 0 операций за 114 turns; harness-owned cue
injection доставил контекст во всех прогонах; инъецируемое пережило 138 циклов compact/resume,
оставленное в диалоге исчезло после первого summary.
**Вывод:** не возвращать ответственность за recall в скиллы/воркер; развивать детерминированные
триггеры path/symbol/event. Текущие `injection-rules` и `tdai-memory` — верное направление.

#### F-20 — Generic-слой · СЛОЙ B, заморожен
Сходятся 4 отчёта: control plane ≠ coding runtime (majiayu000), workflow lifecycle ≠ execution
lifecycle (LongHorizon, Google Agent Executor), AgentRuntime ≠ Computer (UniHarness).
Оценки переносимости из отчётов: 4–5/10 (отчёт 2), 3/10 по orchestration portability при 7/10
качества локального harness (отчёт 5).
**Решение:** в работу не берём. Инвариант зафиксирован, чтобы новые изменения его не ломали:
*состояние workflow живёт вне контекста агента и меняется только после верификации конкретной ревизии.*

---

## 4. Границы

Четыре разреза. Всё, что не попадает в слой A, в работу этой сессии не идёт.

**Г-1. Слой A vs слой B.** A — живой `~/.claude` под Claude Code, чинится сейчас. B — generic
runtime, control plane, RuntimeAdapter/ComputerAdapter, мульти-рантайм. Слой B — только записанный
инвариант, ни строчки кода.

**Г-2. Enforcement.** Правило, которое обязано соблюдаться, должно быть механическим: frontmatter
`tools`, схема тула, hook, deny-класс. Проза — это подсказка, а не граница. Все пять отчётов
приходят к этому независимо.

**Г-3. Ownership контрактов.** Один source of truth на роль и на формат. Дубликат — дефект (F-01, F-09).

**Г-4. Scope процесса.** Единая related-bug семантика (F-10); «out of scope» перестаёт быть и
универсальной отмазкой, и универсальным мандатом.

**Г-5. Контекст.** Тело артефакта (план, кристалл, вердикт) **не проходит через параметры тулов** и не
попадает в контекст главного агента внутри петли. Тулы обмениваются путями, ревизиями и sha.
Это требование пользователя от 2026-08-17 и одновременно причина отказа от pi-контракта
`task_record_plan(planContent: string)`.

---

## 5. Решения сессии

### D-01 (Ф0) — Убрать мёртвые ссылки на night-backstops
Вырезать строку `AGENTS.md:158`. Скилл `night` и `commands/night.md` существуют и остаются.
**Самостоятельный чек:** `grep -rn "night-autopilot-" ~/.claude --include=*.md` → пустой вывод, код 1.

### D-02 (Ф2) — Ядро в нейтральный `~/harness-lib/`
`task-cycle` (domain/ports/repo/service + тесты, 3113 строк) переезжает в `~/harness-lib/task-cycle`.
pi-extension и CC-MCP становятся двумя тонкими транспортами поверх одного ядра. Копировать код в
`~/.claude/mcp/` запрещено: два клона одного контракта — это F-01 на уровне кода.
**Самостоятельный чек:** `cd ~/harness-lib/task-cycle && bun test` → все тесты зелёные;
`pi doctor` не сообщает о сломанном расширении.

### D-03 (Ф3) — Task-тулы pi → Claude Code
MCP-сервер `~/.claude/mcp/tasks/` (bun, stdio — как `injection-rules`, `tdai-memory`, `searxng`,
регистрация в `~/.claude.json` → `mcpServers`). Тулы: `TaskCreate`, `TaskUpdate`, `TaskList`,
`TaskGet`, зависимости `addBlockedBy` + auto-cascade. Ядро — портированный `task-store.ts`.
**Не портируется:** `TaskExecute` (в CC есть `Agent`), pi-TUI, settings-menu.
**Самостоятельный чек:** stdio-клиент → `tools/list` содержит четыре тула; `TaskCreate` + `TaskList`
возвращают созданную задачу.

### D-04 (Ф4) — Вердикты и артефакты: файлы + Write/Edit, тул фиксирует метаданные
- Агент пишет артефакт сам (`Write`/`Edit`) по известному пути. **Тело через параметры тула не ходит.**
- Тул (`task_record_crystal` / `task_record_plan` / `task_record_review`) читает файл сам, считает
  content-sha256, кладёт **иммутабельный снимок** в `versions/<kind>-r<N>-<sha8>.md`, пишет запись
  в существующий framed NDJSON journal.
- В контекст возвращается компакт: `rev N, sha8, ok/fail, K пунктов`. Не тело.
- **Версионирование с первой ревизии — и плана, и кристалла** (требование пользователя).
  История: `task_history` → таблица (ревизия, sha8, время, ревьюер, вердикт, число пунктов).
  Дифф ревизий — `git diff --no-index versions/plan-r1-*.md versions/plan-r2-*.md`, вне контекста.
- Вердикт хранит sha артефакта, который ревьюер читал → артефакт изменился, вердикт **stale**
  механически (закрывает F-12).
- Невалидный вердикт = ошибка тула, а не warning (закрывает F-13). Уходит `sh -c 'while … grep
  VERDICT-END'` и JSON-диалект (закрывает F-09).
- В `domain/digest.ts` есть только `computeImplementationDigest` (mode+mtime+size) — добавляется
  `computeContentDigest(bytes)`; смешивать их нельзя, копия файла меняет mtime.
**Самостоятельный чек:** прогон `task_init → record_crystal → record_plan(r1) → record_review(fail) →
record_plan(r2) → record_review(ok)`; в `versions/` лежат две ревизии плана с разными sha;
правка `plan.md` после ok → `task_status` показывает вердикт как stale.

### D-05 (Ф1) — Сводный документ
Финальная версия этого файла: находки, границы, волны внедрения, «не внедряем». Ф0–Ф5 в нём
помечаются как сделанные, остальные находки — как волны W1..W3.

### D-06 (Ф5) — Планирование выносится из главного агента
**Проблема (наблюдение пользователя, F-22):** главная сессия задаёт направление в первые же реплики
и затем сама пишет план — критика правит формулировки внутри уже выбранного (возможно, неверного)
направления. Отсюда «трипл-гейт критики практически бесполезен».

**Топология:**
1. main пишет кристалл — только у него есть контекст сессии;
2. `planner mode=draft` — **свежий контекст**, вход: кристалл + контракт плана; пишет `plan.md`, фиксирует rev 1;
3. main вызывает критика (в complex — три параллельных ревьюера);
4. fail → `planner mode=revise` — **снова свежий субагент**, вход: кристалл + текущий план + вердикты;
   правит `Edit`'ом, фиксирует rev N+1;
5. цикл до ok либо исчерпания бюджета → терминальный `ESCALATE` (закрывает F-15);
6. реализация остаётся за main.

**Новый тип агента:** `~/.claude/agents/planner.md`, два режима в промпте. Один тип, а не два:
контракт плана и выходной артефакт одни и те же, различаются только входы.

**Побочный выигрыш:** тело плана вообще не попадает в контекст main внутри петли — он видит только
`rev N, ok/fail, K пунктов`, а сам план читает один раз, после PASS, когда идёт реализовывать.

**Известный риск:** свежий редактор склонен переписать план целиком вместо ответа на замечания.
Контракт правки: минимальный дифф + секция `## Verdict responses` по строке на каждый пункт
(`applied` / `rejected` + причина). Тул при фиксации ревизии сверяет число пунктов вердикта с числом
ответов и отказывает в регистрации при расхождении. `read_context` предыдущей ревизии передаётся
следующему планировщику, чтобы свежий агент не переоткрывал репозиторий с нуля.

**Самостоятельный чек:** спавн `planner` на реальной задаче; в `versions/` две ревизии плана,
в rev 2 присутствует `## Verdict responses` с числом строк, равным числу пунктов вердикта;
попытка зарегистрировать ревизию без ответов отбивается тулом.

### D-07 — Критик знает про пайплайн; provenance требований
**Требование пользователя (2026-08-17):** каждый критик должен в промпте понимать, что существует весь
пайплайн — вердикты, история ревизий — чтобы **не терялись явные и неявные требования**.
Прямо закрывает F-03 и совпадает с выводом SWE-RPG.

**Явные требования — механикой:** кристалл содержит секцию требований со stable ID (`REQ-N`, с
пометкой `implicit: true|false` и цитатой-источником из реплик пользователя). План обязан проставить
покрытие `REQ-N → шаг → критерий приёмки`. Тул при фиксации ревизии плана сверяет множества ID:
непокрытый `REQ-N` → отказ в регистрации ревизии.

**Неявные требования — критиком:** промпт каждого ревьюера получает пути к кристаллу, к истории
ревизий и к предыдущим вердиктам, и три обязанности:
1. проверить, что каждое требование кристалла покрыто планом (а не только что план внутренне хорош);
2. искать **неявные** требования, которые есть в кристалле, но не стали `REQ-N`;
3. проверить **регрессию между ревизиями** — пункт, помеченный `applied` в прошлой ревизии, не должен
   молча исчезнуть в следующей.

Сейчас ни одна из трёх обязанностей не сформулирована: `grep -n "implicit\|неявн" agents/critic.md
agents/architect.md` → пусто.

**Самостоятельный чек:** план без покрытия одного `REQ-N` отбивается тулом с указанием ID;
в промпте ревьюера присутствуют пути кристалла/истории (grep по скиллу).

### D-08 — Порядок работ
`Ф0 → Ф2 → Ф4 → Ф5 → Ф3 → Ф1`. Документ последним: он фиксирует уже сделанное, а не намерения.

---

## 6. Не внедряем (и почему)

| Что | Почему нет |
|---|---|
| PostgreSQL + Redis + controller + worker fleet (OpenAgentHarness) | инфраструктурный налог для локального harness; нужен разрез интерфейсов, не deployment topology |
| Автономный self-editor harness'а (AHE, Living-Harness) | сначала harness должен уметь доказать, что правка помогла; без телеметрии это способ бесконтрольно растить CLAUDE.md |
| Manager + executor + auditor поверх существующих ролей (LongHorizon) | ещё три роли и ещё больше LLM-вызовов; берём инвариант, не топологию |
| Отдельные requirements-reviewer / critic / verifier (ответ на SWE-RPG) | дешевле provenance + coverage invariant (D-07), чем новая роль |
| Обязательный внутренний RLM/task-cycle внутри Teamlead / Constitution Reviewer | гейт, запускающий ради одного вердикта собственный plan→critic→verify, превращает ревью в рекурсивный налог; нужен один сильный bounded вызов |
| Полноценный DAG/pipeline engine (DataFlow-Harness) | ближайший выигрыш проще: бюджеты, версии, adapter boundary |
| Полный Google-style distributed Agent Executor | локальный инвариант (вердикт ↔ ревизия) ещё не соблюдается; порядок по YAGNI обратный |

---

## 7. Волны для оставшихся находок

- **W1** (после текущих фаз): F-01 единый source of truth ролей, F-02 снять `Edit` у гейтов,
  F-08 `Skill task` → `task-simple`, F-10 единая related-bug семантика, F-11 подключить verifier.
- **W2:** F-16 механический destructive-guard, F-06 telemetry schema, F-14 failure attribution.
- **W3:** F-05 policy/adapter разделение, F-17 behavior map, F-18 manifest + портируемые пути,
  F-07 change manifest.
- **Заморожено:** F-20.

---

## 8. Открытые вопросы

1. `Write` у ролей-гейтов: снять нельзя (нечем писать вердикт), path-scoped Write в frontmatter CC не
   поддерживает. Вариант — PreToolUse-hook, разрешающий гейтам запись только в каталог вердиктов.
   В текущий объём не входит; помечено как кандидат W2.
2. Нужен ли отдельный тип агента под правку кристалла, или кристалл всегда правит main (он владелец
   контекста сессии). Сейчас принято второе.
3. Порог, после которого `planner` перестаёт быть свежим: если бюджет ревизий большой, стоимость
   переоткрытия репозитория растёт линейно. Смягчается передачей `read_context`, но числа нет.
