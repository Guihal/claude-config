---
name: operator-loop
description: "Cron-driven 1-minute operator tick для packet wave. Claude Code native — Я (Opus/Sonnet) = operator, dispatch architects/workers/critics/cso/investigator/challenger/strategic directly via Agent tool. No sh drivers, no nested /task. State в .operator-state.<wave>.json. Constitution-aware roles - vision lead → operator → {architect, worker, worker-critic, cso (conditional), investigator (conditional), codex-challenger (conditional), vision-keeper (conditional), strategic}. Conditional gates: CSO для high-risk; investigate для repeated worker_fail; challenge для large/security packets. Health composite per packet + rolling trend. Gbrain sync at terminal. Triggers - \"operator loop\", \"запусти оператор-цикл\", \"/operator-loop <wave>\", \"wave autopilot\", \"operator tick\"."
---

# Operator Loop

Я — оператор. Self-paced wave processing с external cron tick раз в минуту. Каждый tick = read state → decide one step → dispatch subagent ИЛИ apply doc-patch → write state → exit. Никаких sh-драйверов: cron (создан через `CronCreate` built-in tool) спавнит fresh Claude Code session с prompt `/operator-loop tick <wave_id>`; я внутри tick запускаю architect/worker/critic через `Agent` tool.

Constitution: `~/.claude/skills/system-constitution/SKILL.md` — invariants + 5-loop feedback. Operator role-rights: write только `docs/**` + repo-root `*.md`.

**Constitution exception (operator state files)**: operator пишет `.operator-state.<wave>.json`, `.operator-state.<wave>.json.tmp`, `.operator-state.<wave>.json.bak`, `.packet-context.<id>.json` в repo-root. Это не код, не spec — это operator's working memory, single-source-of-truth между ticks. Файлы в `.gitignore`. Формально вне `docs/**`, но необходимо для loop'а. Candidate для `/constitution-patch` (формально расширить Operator role-rights row → `+ repo-root .operator-state.*.json + .packet-context.*.json`).

**Constitution exception (executor FAIL marker)**: worker (executor role) ограничен записями в `allowed_write_paths`. Исключение — единственный файл `.packet-fail.<packet_id>.r<round>` в repo-root: cross-tick communication mechanism (worker stdout не persists в fresh tick session). Файл в `.gitignore`. Worker пишет ТОЛЬКО при unrecoverable fail как last action до exit. Operator awaiting-commit phase reads + `rm` маркер. Candidate для `/constitution-patch` (расширить Executor role-rights row → `+ repo-root .packet-fail.<packet_id>.r<round>`).

## Геном (role tree)

Иерархия запусков, кто кого спавнит:

```
Vision Lead (meta-goal owner)
        │   docs/specs/<wave>.md § "Final Formula" / "Коротко" — source of truth meta-goal
        │   STRATEGIC_REVIEW_EVERY=3 packets → operator делегирует strategic-review архитектору
        ▼
Operator (Я — Claude Code)
        │   flow control, state, dispatch, doc-patches только
        │   НЕ пишет код, configs, tests
        ├──► Architect (verdict role)
        │       Agent subagent_type=general-purpose, model=opus
        │       read-only, JSON verdict {ok, missing, misplaced, unfinished, spec_issues, fix_target, notes}
        │       routing: impl|spec|both|escalate
        │
        ├──► Worker (executor)
        │       Agent subagent_type=general-purpose, model per dispatch table
        │       пишет код в allowed_write_paths, commits, returns "OK <sha>" | "FAIL: <reason>"
        │       worker prologue: Skill caveman (опционально). NO nested /task —
        │       silently skipped в subagent; critic-loop делает operator parent.
        │
        ├──► Worker Critic (rules critic)
        │       Agent subagent_type=general-purpose, model=sonnet, read-only
        │       check diff vs CLAUDE.md + guardrails
        │       JSON verdict {ok, blockers, notes}
        │       НЕ архитектурные комментарии (architect's domain)
        │
        ├──► CSO Critic (conditional, parallel в verdict batch)
        │       Trigger: risk_tier ∈ {security, auth, db, migrations} OR allowed_write_paths
        │         regex `(^|/)(auth|migrations|secrets)/`
        │       Agent subagent_type=general-purpose, model=opus, read-only
        │       OWASP Top 10, STRIDE, supply chain, LLM trust boundaries, secrets archaeology
        │       JSON verdict {ok, owasp_findings, supply_chain_alerts, threat_model_gaps,
        │                     secret_leaks, severity ∈ {none,low,medium,high,critical}}
        │       severity=critical → forced escalate
        │
        ├──► Investigator (conditional, sequential перед fix-dispatching)
        │       Trigger: round ≥ 2 AND blockers содержат `^worker_fail:` AND investigate_count < 2
        │       Agent subagent_type=general-purpose, model=opus, read-only
        │       root-cause analysis: packet block + prior commit SHAs + FAIL reasons + repo tree
        │       JSON {root_cause, hypothesis, evidence, suggested_fix}
        │       investigate_count++; cap 2 на packet → escalate
        │
        ├──► Codex Challenger (conditional, sequential ПОСЛЕ ok+ok на high-risk)
        │       Trigger: architect+critic+cso все ok=true AND
        │         (CSO trigger met OR file_count_max > 5) AND
        │         packets[].challenge_done_for_sha != current_impl_sha
        │       Agent subagent_type=general-purpose, model=opus, read-only
        │       adversarial: try to break the implementation
        │       JSON {ok, break_scenarios, severity, fix_required}
        │       break_scenarios non-empty → blocker + round++ + fix-dispatching
        │
        ├──► Vision Keeper (conditional, sequential ПОСЛЕ verdict-routing на done-path)
        │       Trigger: `allowed_write_paths` non-empty (implementation packet)
        │         AND `packets[].vision_gate_done_for_sha != current_impl_sha`
        │       Agent subagent_type=general-purpose, model=opus, read-only
        │       runtime + user-facing + meta-goal coherence check
        │       JSON {ok, blockers, verdict, vision_drift, evidence}
        │       verdict=wave-blocker OR vision_drift >= 5 → escalate
        │
        └──► Strategic Architect (periodic vision check)
                Каждые STRATEGIC_REVIEW_EVERY (=1) committed packets
                meta-goal vs последние 3 commits + health_history.slice(-3) → 6 decision principles
                JSON {drift_score, evidence, principle_breakdown {scope, taste, debt, impact,
                       reversibility, blast_radius} each 0-10 with evidence per principle,
                       recommendation: continue|adjust_wave|escalate}
```

Ключ: **vision lead — концепция (документ), не agent**. Operator периодически инициирует strategic-rescan через architect subagent с meta-goal текстом + last-3-commits diff. Architect выносит verdict; operator действует.

## 5-loop feedback (для tick decisions)

| Loop | Question | Tick phase где срабатывает |
|---|---|---|
| Local | код работает? | worker запускает packet `acceptance` локально + tick step 6 health composite |
| Architectural | модель не сломана? | phase `verdict-spawning` → architect verdict (+ CSO conditional parallel) |
| Documentation | spec актуален? | architect.fix_target=spec/both → operator doc-patch commit |
| Operator | процесс не застрял? | MAX_ROUNDS=5; spec-fix-guard 2; investigate cap 2 on repeated worker_fail; timeout 30 min |
| Strategic | делаем то самое? | packets_done_since_review ≥ 3 → strategic architect (6 principles + health rolling-3 trend) |
| Adversarial | можно сломать? | challenge-gate phase для high-risk packets (post-ok+ok) |
| Vision | продукт работает и соответствует видению? | vision-gate phase после каждого implementation packet |

## State schema (`.operator-state.<wave-id>.json`)

```json
{
  "wave_id": "HR-W5",
  "readme_path": "docs/tasks/hermes-rails/W5.md",
  "repo_path": "/usr/projects/subbrain",
  "packets": [
    {
      "id": "HR-W5-A1",
      "status": "pending|in_progress|done|escalated",
      "round": 0,
      "blocked_by": [],
      "commits": [],
      "blockers": [],
      "spec_fix_count": 0,
      "worker_dispatched_at": null,
      "worker_agent_id": null,
      "investigate_count": 0,
      "challenge_done_for_sha": null,
      "vision_gate_done_for_sha": null,
      "health_score": null,
      "health_breakdown": {"tsc": null, "test": null, "loc": null, "secrets": null}
    }
  ],
  "current_packet_idx": 0,
  "phase": "init|dispatching|awaiting-commit|verdict-spawning|verdict-routing|fix-dispatching|done|escalated",
  "tick_count": 0,
  "max_rounds_per_packet": 5,
  "strategic_review_every": 3,
  "packets_done_since_review": 0,
  "last_strategic_sha": null,
  "cron_id": "<id returned by CronCreate at init; null до init>",
  "last_doc_patch_sha": null,
  "strategic_parse_fail_count": 0,
  "health_history": [],
  "gbrain_synced": false,
  "dry_run": false,
  "history": [
    {"tick": 1, "ts": "2026-05-19T15:00:00Z", "action": "init: parsed 5 packets"}
  ]
}
```

## Tick algorithm (one tick = one phase advance)

1. **Read state** `.operator-state.<wave-id>.json` (path derived from `wave_id` arg в cron prompt). Если файл отсутствует → log "init incomplete or wave wiped", exit gracefully (handles init-cron race window между CronCreate и state Write).
2. **Increment** `tick_count`.
3. **Termination check**: все packets `status=done` ИЛИ `phase∈{done,escalated}` →
   a. log "wave complete";
   b. если `state.cron_id != null` → `CronDelete(state.cron_id)`. `cron_id=null` (init never completed) → log warning, skip cron cleanup.
   c. **Gbrain sync (fail-soft, idempotent)**: если `state.gbrain_synced == false`:
      - `command -v gbrain >/dev/null 2>&1` exit 0 → run:
        ```
        timeout 60s gbrain import "<readme_path>" "docs/specs/<wave_id>.md" 2>&1 || log "gbrain_import_failed: <stderr ≤200ch>"
        timeout 60s gbrain extract all 2>&1 || log "gbrain_extract_failed: <stderr ≤200ch>"
        ```
        Set `state.gbrain_synced = true` (даже если import/extract частично failed — best-effort).
      - exit non-zero → log `gbrain_not_available`, skip.
   d. exit.
4. **Pick current packet** = `packets[current_packet_idx]`.
5. **Dispatch per `phase`**:

| Phase | Operator action | Next phase |
|---|---|---|
| `init` | Read packet block из README. `.packet-context.<packet_id>.json` уже создан в init phase (см Lifecycle). `BASE_SHA = git rev-parse HEAD`. | `dispatching` |
| `dispatching` | Spawn worker Agent (см § Worker dispatch). Record `worker_agent_id` + `worker_dispatched_at`. | `awaiting-commit` |
| `awaiting-commit` | (a) Check marker file `.packet-fail.<packet_id>.r<round>` (written by worker как last action при unrecoverable fail — см Worker prompt § "FAIL marker"). Exists → read first line (FAIL reason), blocker `worker_fail: <reason>`, `round++`, **investigate sub-step (см § Investigate dispatch)**: если `round >= 2` AND prior blockers contain `^worker_fail:` AND `packets[].investigate_count < 2` → sequential spawn Investigator Agent, append JSON output к blockers[], increment `investigate_count`. Если `investigate_count == 2` при triggered → phase=`escalated` reason "investigate_cap_hit", skip dispatch. Иначе после investigate (или без — round<2) → phase=`fix-dispatching`, `rm` marker, exit. (b) Else anchored grep commit subjects (см ниже). Found → append commits[], capture SHA. (c) Elapsed > 30 min БЕЗ commit И БЕЗ marker → blocker "worker_timeout", `round++`, same investigate sub-step as (a), phase=`fix-dispatching`. (d) Else exit (next tick polls). | `verdict-spawning` (case b) ИЛИ `fix-dispatching` (case a/c) ИЛИ `escalated` (investigate cap) |
| `verdict-spawning` | **Parallel batch spawn** (ONE message с N Agent tool calls), CAP **N ≤ 5 children** (user override — deploy up to 5 subagents). Default: architect + worker-critic = 2 children. CSO trigger met → CSO occupies 3rd slot. Если в будущем добавить 5-го critic — допустимо при наличии free slots. | `verdict-routing` |
| `verdict-routing` | Read all verdict JSON returns (architect, critic, optionally cso). Route per § Verdict routing. Если result `done`: (a) challenge trigger met AND `packets[].challenge_done_for_sha != current_impl_sha` → phase=`challenge-gate`; (b) иначе vision keeper trigger met AND `packets[].vision_gate_done_for_sha != current_impl_sha` → phase=`vision-gate`; (c) иначе → `init` (next packet). | `init` (next packet) ИЛИ `challenge-gate` ИЛИ `vision-gate` ИЛИ `fix-dispatching` |
| `challenge-gate` | Sequential spawn Codex Challenger Agent (см § Codex Challenge dispatch). Read JSON. **challenge_done_for_sha set ONLY на ok-path**: `break_scenarios=[]` AND `severity ∈ {none, low}` → `packets[].challenge_done_for_sha = current_impl_sha`, packet status=done, advance idx → `init`. `break_scenarios non-empty` AND `severity < critical` → blocker `challenge_broke: <scenarios joined>`, **challenge_done_for_sha NOT set** (next round produces new impl_sha re-challenges); если `round+1 ≤ MAX_ROUNDS(5)` → `round++`, phase=`fix-dispatching`; else escalate. `severity = critical` → forced escalate, **challenge_done_for_sha NOT set** (escalation freezes packet — human resolves before any further dispatch). | `vision-gate` (if trigger) ИЛИ `init` (next packet) ИЛИ `fix-dispatching` ИЛИ `escalated` |
| `vision-gate` | Sequential spawn Vision Keeper Agent (см § Vision Keeper dispatch). Read JSON. **vision_gate_done_for_sha set ONLY на ok-path**: `ok=true` → `packets[].vision_gate_done_for_sha = current_impl_sha`, packet status=done, advance idx → `init`. `ok=false` AND `verdict != "wave-blocker"` → blocker `vision_drift: <reason>`, **vision_gate_done_for_sha NOT set**; если `round+1 ≤ MAX_ROUNDS(5)` → `round++`, phase=`fix-dispatching`; else escalate. `verdict="wave-blocker"` OR `vision_drift >= 5` → forced escalate. | `init` (next packet) ИЛИ `fix-dispatching` ИЛИ `escalated` |
| `fix-dispatching` | Re-spawn worker с merged blockers + prior SHA reference + (если investigate was dispatched) investigator's suggested_fix. | `awaiting-commit` |
| `done` | Log. **Health computation** (см § Health computation) запускается в tick step 7 при transition в done. | terminal |
| `escalated` | Log reason. Surface user. | terminal |

6. **Health computation** (inline, при transition `packet status=done`): запустить packet's health command set (см § Health computation), compute composite 0-10 score → `packets[].health_score`, `packets[].health_breakdown = {tsc, test, loc, secrets}`, append `state.health_history.push({packet_id, score, ts})`, trim oldest если `length > 10`. **investigate_count reset**: NOT reset here. Counter persists across rounds внутри packet (cap=2 across all rounds same packet). Reset ТОЛЬКО при `current_packet_idx++` (next-packet transition) — operator initialises new packet's `investigate_count = 0` в init phase. Старый packet's count consumed во время debugging — finished.
7. **Strategic review check** (inline, ДО state write): если verdict-routing на этом tick set `packet status=done` И `packets_done_since_review >= strategic_review_every` → spawn Strategic Architect (см § Strategic review) с input включающим `state.health_history.slice(-3)` + gbrain context (если MCP available), apply route mutation (phase=`escalated` ИЛИ continue), reset counter, update `last_strategic_sha`.
7b. **Append** history `{tick, ts, action, details}` — включая health + strategic review entries если были.
8. **Write state atomic** (одиночный write per tick, после ВСЕХ state mutations): pre-tick `.bak` snapshot → write `.operator-state.<wave>.json.tmp` → `mv` → fsync parent dir. Никаких partial writes между step 5 и step 8 — state consistent даже при crash после doc-patch commit (commit в git history восстановим, last_doc_patch_sha можно re-derive grep'ом subjects).
9. **Exit**. Cron fires next tick через 60s.

### Commit detection (anchored, prevents `A1` matching `A11`)

```bash
PACKET_RE="(^|[^A-Za-z0-9_-])${PACKET_ID}($|[^A-Za-z0-9_-])"
MATCHES=$(git log --since="$worker_dispatched_at" --format='%H%x09%s' | grep -E "$PACKET_RE" || true)
# Quoted printf preserves newlines (echo $VAR unquoted collapses them — breaks multi-line counts).
COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)
WORKER_COMMIT=$(printf '%s\n' "$MATCHES" | head -1 | cut -f1)   # newest matching commit (git log = reverse-chronological by default)
```

**Multi-commit guard**: если `COUNT > 1` → worker нарушил single-commit invariant. Operator behaviour:
- Architect diff uses range `$BASE_SHA..HEAD` (covers all worker commits) — safer чем head -1.
- Add blocker `worker_multicommit_violation: <COUNT> commits matched <packet_id>` для следующего round (worker должен squash или operator escalates).
- Verdict gate still runs на полном диффе, не блокируется.

`COUNT = 0` → no commit yet (handled by awaiting-commit phase (d) — poll next tick).

## Worker dispatch (Agent tool)

```
Agent(
  description: "Execute <packet_id>",
  subagent_type: <general-purpose|code-simplifier per dispatch table>,
  model: <opus|sonnet|haiku per dispatch table>,
  prompt: <worker prompt template>
)
```

Worker prompt template:

```
ROOT: <repo_path>
PACKET: <packet_id>
ROUND: <round>
BASE_SHA: <sha>

Контракт executor (constitution): write only allowed_write_paths.
Packet block: <readme_path> § <packet_id>.
.packet-context.<id>.json: allowed_write_paths/diff_budget_loc/file_count_max.
Prior round blockers (round > 1): <merged blockers + prior commit SHA>.

WORKER PROLOGUE:
- Skill caveman (опционально per CLAUDE.md)
- Skill subbrain-guardrails (если subbrain repo)
- NO nested /task — известная limitation: subagent /task silently skipped в 8/14 measured cases (см dispatch-task-subagent skill). Worker = raw implementation. Critic-loop делает operator parent через separate architect+critic Agent gates.

ШАГИ:
1. Read packet block + .packet-context.<packet_id>.json.
2. If task involves UI/frontend (Vue/HTML/CSS), invoke `Skill design-html` before writing markup.
3. Implement только within allowed_write_paths. НЕ трогать adjacent files.
4. Run packet acceptance commands.
5. **Single commit** per round (operator architect-diff invariant). Subject MUST contain "<packet_id>". Если нужно несколько logical changes — staged together в один commit. НЕ создавать > 1 commit с packet_id в subject.

NEVER:
- /architect, /operator-loop, /operator-orchestrator
- git push, gh, docker, ssh, --no-verify
- Edit вне allowed_write_paths

Return last line:
  OK <7-sha> <subject>
ИЛИ
  FAIL: <category>: <reason ≤80 chars>

**FAIL marker (cross-tick persistence)**: worker stdout не доступна следующему tick (fresh CC session). При unrecoverable fail worker ДО exit пишет файл:
  Write(.packet-fail.<packet_id>.r<round>, "<category>: <reason>\n")
Operator awaiting-commit phase читает этот marker. На success НЕ создавать marker.
```

## Dispatch triggers (conditional roles)

Concrete trigger conditions для 3 conditional roles. Operator evaluates перед dispatch.

| Role | Trigger condition |
|---|---|
| CSO Critic | `packet.risk_tier ∈ {security, auth, db, migrations}` OR `allowed_write_paths` any path matches regex `(^|/)(auth\|migrations\|secrets)/` |
| Codex Challenger | (CSO trigger met) OR `packet.file_count_max > 5` (packet field from README block) |
| Investigator | `round >= 2` AND `blockers` contains string matching regex `^worker_fail:` AND `packets[].investigate_count < 2` |
| Vision Keeper | `allowed_write_paths` non-empty (implementation packet) AND `packets[].vision_gate_done_for_sha != current_impl_sha` (fires on every impl packet after done-path) |

## Architect dispatch (Agent tool, always Opus)

```
Agent(
  description: "Architect verdict <packet_id> r<round>",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <architect prompt>
)
```

Architect prompt:

```
You are architect. Read-only. NO writes, NO commits.

Spec docs (cat content):
<readme block + docs/specs/* referenced by packet>

Packet block JSON:
<extracted>

Diff:
<git diff $BASE_SHA..HEAD>    # range covers single OR multi-commit worker output

Compare implementation vs architectural intent:
1. Structural blocks missing (named в spec, absent в diff).
2. Blocks в wrong layer/folder (cite spec rule + actual placement).
3. Packet goal items не executed.
4. Spec ambiguity (two readings).
5. Spec contradicts reality (impossible per lib/infra).

Output strict JSON only:
{"ok": <bool>, "missing": [str], "misplaced": [str], "unfinished": [str],
 "spec_issues": {"ambiguous": [str], "contradicts_reality": [str]},
 "fix_target": "impl"|"spec"|"both"|"escalate", "notes": str}
```

## Worker Critic dispatch (Agent tool, Sonnet)

```
Agent(
  description: "Critic <packet_id> r<round>",
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: <critic prompt>
)
```

Critic prompt:

```
You are rules critic. Read-only.

Repo rules pointers:
- CLAUDE.md (project root)
- ~/.claude/CLAUDE.md (user global)
- subbrain-guardrails skill (если subbrain repo)
- file-cap 150 / forbidden patterns / deep-import ban

Diff:
<git diff $BASE_SHA..HEAD>

Task description: <packet goal>

Find blockers ONLY:
- File-cap violations (>150 LOC без whitelist).
- Forbidden patterns (`as any`, `@ts-ignore`, `console.log` в src/, raw fetch, Promise.all+fetch).
- SoC violations (SQL в routes, page direct $fetch).
- Logger contract (single-arg logger.info).
- Validation gaps.
- Secret leaks.
- Race / abort / timeout / partial-write bugs.

NO style nits. NO refactor suggestions. NO architectural commentary (architect's domain).

Output strict JSON only:
{"ok": <bool>, "blockers": [str], "notes": str}
```

## Verdict routing

| Architect | Critic | Action | Next phase | Round delta |
|---|---|---|---|---|
| `ok=true` | `ok=true` | packet `status=done`, `packets_done_since_review++`, advance `current_packet_idx` | `init` | — |
| `fix_target=escalate` | * | STOP. Surface architect.notes к user | `escalated` | — |
| `fix_target=spec` | * | Operator doc-patch (см § Doc-patch). `spec_fix_count++`. Если `spec_fix_count >= 2` → escalate. Иначе re-gate тем же worker commit + новой spec | `verdict-spawning` ИЛИ `escalated` | **0** (doc-patch не round) |
| `fix_target=both` | * | Operator doc-patch + merge `architect.{missing,misplaced,unfinished}` + `critic.blockers` → `blockers[]`. Если `round+1 > MAX_ROUNDS(5)` → escalate | `fix-dispatching` ИЛИ `escalated` | **+1** (re-dispatch worker) |
| `fix_target=impl` | * | Merge issues → `blockers[]`. Если `round+1 > MAX_ROUNDS(5)` → escalate | `fix-dispatching` ИЛИ `escalated` | **+1** |

## Doc-patch discipline (Operator writes)

1. Trigger: `architect.fix_target ∈ {spec, both}` ONLY.
2. Snapshot pre-edit state: `PRE_HEAD = git -C <repo_path> rev-parse HEAD`.
3. **Pre-Write filesystem snapshot** (per target path) — для КАЖДОГО предполагаемого пути ДО любого Edit/Write вызова: `test -e <path>` → если exists → push в `MODIFIED_PATHS[]`; иначе → push в `CREATED_PATHS[]`. **Критично**: проверка существования файла, НЕ `git ls-files` (pre-existing untracked файлы — user's local work / build artifacts — НЕ должны попасть в CREATED, иначе rollback `rm -f` уничтожит данные). Затем apply edits via `Edit`/`Write`. **On any tool error** → rollback:
   ```bash
   git -C <repo_path> checkout -- <MODIFIED_PATHS>   # revert tracked-and-existed (safe — restores from index)
   rm -f <CREATED_PATHS>                              # delete ONLY paths confirmed non-existent pre-tick
   ```
   blocker `doc_patch_edit_fail: <tool error>`, skip steps 4-6, exit.
4. Stage + commit via `Bash`:
   ```bash
   git -C <repo_path> add <MODIFIED_PATHS> <CREATED_PATHS>
   git -C <repo_path> commit -m "docs: <packet_id> reconcile spec with reality — <short reason>"
   ```
   **On commit fail** (hook reject, nothing to commit, etc.) → same rollback как в step 3 (`git checkout` MODIFIED + `rm` CREATED), blocker `doc_patch_commit_fail: <stderr first 80 char>`, skip step 5, exit.
5. **Only on success**: `DOC_SHA = git -C <repo_path> rev-parse HEAD` → mutate in-memory state: `last_doc_patch_sha = DOC_SHA`. Persisted в tick step 8 atomic write.
6. НЕ amend prior commit. Separate commit мандатный для audit trail.
7. После successful doc-patch:
   - `fix_target=spec` → phase=`verdict-spawning` (re-gate same worker commit + new spec; round не инкрементится).
   - `fix_target=both` → phase=`fix-dispatching` (re-spawn worker с merged blockers; round++).
8. 2 consecutive spec-fixes на одном packet (`spec_fix_count >= 2`) → escalate (spec unstable, human решает).
9. **Никогда не пропускать re-gate** после spec-fix: новый verdict от architect+critic обязателен, иначе spec может оказаться нестабильной без detection.

## Model dispatch table (worker)

| Condition | Model | Subagent type |
|---|---|---|
| `risk_tier ∈ {security, db}` | Opus | general-purpose |
| `dispatch = strong_gate` | Opus | general-purpose |
| `diff_budget_loc > 200` | Opus | general-purpose |
| `file_count_max > 3` | Opus | general-purpose |
| `goal` matches `refactor\|simplify\|cleanup` OR blockers contain `refactor\|simplify` | Sonnet | code-simplifier |
| `allowed_write_paths ⊂ docs/**` AND `diff_budget_loc ≤ 30` AND `file_count_max = 1` | Haiku | general-purpose |
| `allowed_write_paths ⊂ docs/**` (иначе) | Sonnet | general-purpose |
| иначе `weak_ok` | Sonnet | general-purpose |

**Frontend/UI note**: if packet involves HTML/CSS/Vue components, worker prompt MUST instruct `Skill design-html` before writing markup.

Architect = always Opus. Critic = Sonnet (lite).

## CSO Critic dispatch (Agent tool, Opus, conditional)

Spawned PARALLEL c architect+critic в `verdict-spawning` batch если trigger met (см § Dispatch triggers).

```
Agent(
  description: "CSO critic <packet_id> r<round>",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <cso prompt>
)
```

CSO prompt:

```
You are Chief Security Officer critic. Read-only.

Repo rules pointers:
- CLAUDE.md, ~/.claude/CLAUDE.md
- subbrain-guardrails skill (если subbrain repo)

Diff:
<git diff $BASE_SHA..HEAD>

Packet description: <packet goal>
Risk tier: <packet.risk_tier>
Allowed write paths: <paths>

Security audit (find issues only — medium+ severity):

1. **Secrets archaeology**: hardcoded API keys, tokens, passwords, private keys in diff OR newly committed files. Check env-file leaks, `.env*` paths, `process.env.*` direct logging.
2. **OWASP Top 10** (relevant subset given diff): A01 broken access control, A02 crypto failures, A03 injection (SQL/cmd/LDAP/XPath), A04 insecure design, A05 misconfig, A07 auth/session, A08 software/data integrity, A09 logging, A10 SSRF.
3. **STRIDE threat model** на surface affected by diff: Spoofing / Tampering / Repudiation / Info Disclosure / DoS / Elevation of Privilege.
4. **Supply chain**: new dependencies в `package.json` / `requirements.txt` / `Cargo.toml` — check provenance, license, recent CVEs (best-effort: flag suspicious unpinned ranges, typosquats).
5. **LLM trust boundaries**: user-controlled input flowing into prompts без sanitization; tool descriptions trusting agent input; secret/PII leakage to LLM.
6. **CI/CD pipeline security** (если diff touches `.github/`, `lefthook.yml`, `Dockerfile`): pinned action SHAs, secrets exposure, build provenance.

NO style nits, NO architectural commentary, NO performance issues (other critics' domain).

Severity scale:
- critical: exploitable now (hardcoded secret committed, SQL injection in user-facing route, RCE)
- high: probable exploit under attacker model (auth bypass, IDOR, unsafe deserialization)
- medium: defense-in-depth gap (missing rate limit on auth endpoint, weak crypto, missing CSRF)
- low: hardening opportunity (dropped to "notes" only — not blocking)
- none: no issues

Output strict JSON only:
{"ok": <bool>, "owasp_findings": [<str>], "supply_chain_alerts": [<str>], "threat_model_gaps": [<str>], "secret_leaks": [<str>], "severity": "none|low|medium|high|critical", "notes": <str>}

`ok` = (severity ∈ {none, low}) AND no critical/high/medium findings.
`severity=critical` → operator forced escalate.
```

## Investigate dispatch (Agent tool, Opus, conditional sequential)

Spawned SEQUENTIAL (single child) inside `awaiting-commit` phase BEFORE transitioning to `fix-dispatching`. Trigger см § Dispatch triggers.

```
Agent(
  description: "Investigate <packet_id> r<round>",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <investigate prompt>
)
```

Investigate prompt:

```
You are root-cause investigator (Iron Law: no fix without root cause). Read-only.

Packet block:
<readme packet block + .packet-context.<packet_id>.json>

Prior commits this round (если any):
<git log --oneline $BASE_SHA..HEAD>

Prior FAIL reasons (chronological, последние 3 round):
<extracted from blockers matching ^worker_fail:>

Repo file tree (relevant area):
<find <allowed_write_paths> -type f | head -30>

Recent git log (broader context, last 20):
<git log --oneline -20>

ШАГИ analyses:
1. **Reproduce mentally**: what worker tried, where it failed, что не resolve через blockers feedback.
2. **Differentiate** symptom (FAIL message) от cause (underlying constraint missed by worker).
3. **Hypothesise** 1-3 candidate root causes; pick most parsimonious.
4. **Evidence**: cite specific file:line / commit SHA / spec sentence supporting hypothesis.
5. **Suggested fix**: concrete imperative для next worker round — what to read first, what to change, what to verify.

NO speculation past evidence. NO fix application (read-only role).

Output strict JSON only:
{"root_cause": <str>, "hypothesis": <str>, "evidence": [<str>], "suggested_fix": <str>, "confidence": "low|medium|high"}
```

## Codex Challenge dispatch (Agent tool, Opus, conditional sequential)

Spawned SEQUENTIAL в `challenge-gate` phase ПОСЛЕ architect+critic(+cso) all ok=true на high-risk packet. Trigger см § Dispatch triggers.

```
Agent(
  description: "Codex challenge <packet_id>",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <challenge prompt>
)
```

Challenge prompt:

```
You are adversarial challenger. Read-only. Your job: try to break this implementation.

Packet goal: <packet description>
Diff:
<git diff $BASE_SHA..HEAD>

Strict mode: assume passing architect+critic verdicts могут be wrong. Find scenarios where impl breaks.

Try these attack vectors:
1. **Edge inputs**: empty, null, max-int, unicode-edge, very-long, negative time, NaN.
2. **Concurrency**: simultaneous requests, abort mid-flight, partial-write, race on shared state, lock ordering.
3. **Resource exhaustion**: memory, file handles, sockets, disk full, DB connection pool, rate limits.
4. **Failure injection**: dependency down (network, DB, file), permission denied, disk readonly, clock skew.
5. **Malformed input** (если parsing): truncated, corrupted, deliberately invalid encoding.
6. **Adversarial actor**: SQL injection variants, path traversal, prototype pollution, dependency confusion (if new deps).
7. **Boundary conditions**: off-by-one на arrays/strings, overflow, underflow, BOM handling.

Each break scenario → describe input, expected good behaviour, actual broken behaviour (per code reading).

Severity scale:
- critical: data loss / RCE / auth bypass demonstrable
- high: data corruption / DoS easy to trigger
- medium: edge crash / incorrect result under specific input
- low: minor non-fatal (dropped — not blocking)
- none: cannot find break

Output strict JSON only:
{"ok": <bool>, "break_scenarios": [<str>], "severity": "none|low|medium|high|critical", "fix_required": <str>, "notes": <str>}

`ok` = (severity ∈ {none, low}).
`severity=critical` → operator forced escalate.
```

## Vision Keeper dispatch (Agent tool, Opus, conditional sequential)

Spawned SEQUENTIAL в `vision-gate` phase ПОСЛЕ challenge-gate (или verdict-routing если challenge не triggered) на done-path implementation packet. Trigger: `allowed_write_paths` non-empty AND `packets[].vision_gate_done_for_sha != current_impl_sha`.

```
Agent(
  description: "Vision keeper <packet_id>",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <vision prompt>
)
```

Vision prompt:

```
You are product verifier (vision keeper). Read-only. NO writes, NO commits.

Your job: verify the product behaves correctly, matches the project vision, and users won't get stuck.

Spec docs:
<readme block + docs/specs/* referenced by packet>

Packet block JSON:
<extracted>

Diff:
<git diff $BASE_SHA..HEAD>

## 1. UI/UX logic check

For every screen/page/modal added or changed, verify:
- How user enters the screen
- How user exits the screen
- What happens on "back"
- Is there close/cancel button for modal/form/onboarding/setting
- Does screen block user without reason
- Can user exit without data loss or with clear warning
- What happens with empty data
- What happens during loading
- What happens on error
- What happens on re-entry

## 2. Forbidden UI states

Flag as critical if:
- User cannot exit screen
- User cannot close modal
- Form has no cancel/return
- No retry/back/close after error
- Success leaves user in unclear state
- Loading can hang forever without fallback
- Empty list looks broken
- Button visible but action unclear
- Destructive action without confirmation
- Double-click creates duplicates
- UI shows one state but data is in another
- Backend error but UI shows success

## 3. User scenario check

For each main feature, trace:
Scenario: [name]
Start state: [where user is]
Action: [what user does]
Expected result: [what should happen]
Actual result: [what code does]
Can cancel/return: yes/no
Error handling: yes/no
Verdict: pass/fail

## 4. Navigation check

Verify: forward, back, direct URL open, refresh, after save, after error, with unsaved data, exit from nested screens, bottom menu/header/back button behavior, empty data behavior.

## 5. Form check

For each form: required/optional fields, validation location (frontend/backend/both), error display, empty submit, double submit, network loss, backend error, success redirect, cancel, unsaved changes warning.

## 6. Backend check

For each endpoint: input, output, possible errors, error codes, invalid data, empty body, missing id, non-existent record, duplicate request, conflict, no permission, connection loss. Does frontend contract match backend response?

## 7. Frontend/backend integration check

Trace full path: UI action → store/use case → repository → backend → response → UI update.
Check: entity actually created, UI updates after creation, no store/backend desync, no optimistic update without rollback, error handling, no duplicates, data survives reload, no stale state, loading cleared, errors cleared after success.

## 8. Data states check

Verify: empty → loading → loaded → error → retry → success. Also create → read → update → delete.

## 9. Design logic check

Is it clear: where user is, what is clickable, primary action, dangerous action, what is saved, what is unsaved, why button disabled, what to do on error, that empty list is not a bug, how to go back.

## 10. Severity

- critical — user stuck, data lost, main scenario broken, data corrupted
- major — scenario works with errors, unclear state, bad error handling
- minor — cosmetic, text, spacing
- suggestion — improvement, non-blocking

NEVER downgrade stuck-user to minor.

## 11. Output format

Output strict JSON only:
{
  "ok": <bool>,
  "verdict": "accept|fix|wave-blocker",
  "vision_drift": <int 0-10>,
  "blockers": [<str>],
  "evidence": [<str>],
  "critical_issues": [{"screen": "", "problem": "", "fix": ""}],
  "major_issues": [{"screen": "", "problem": "", "fix": ""}],
  "notes": <str>
}

`ok` = (verdict == "accept" AND vision_drift < 5 AND no critical issues).
`verdict=wave-blocker` OR `vision_drift >= 5` → operator forced escalate.
```

## Health computation (operator-internal, not subagent)

Runs synchronously в tick step 6 при `packet status=done` transition. Не subagent — bash invocations from operator.

Default health command set (override per-packet via README `health_commands:` field):

```bash
# 1. Type check (TS projects)
HEALTH_TSC=0
if [ -f tsconfig.json ]; then
  timeout 30s bunx tsc --noEmit 2>&1 | tee /tmp/tsc.log
  test "${PIPESTATUS[0]}" -eq 0 && HEALTH_TSC=10 || HEALTH_TSC=$((10 - $(grep -c "error" /tmp/tsc.log)))
fi

# 2. Tests
HEALTH_TEST=0
if [ -f package.json ] && grep -q '"test"' package.json; then
  timeout 60s bun test 2>&1 | tee /tmp/test.log
  test "${PIPESTATUS[0]}" -eq 0 && HEALTH_TEST=10 || HEALTH_TEST=0
fi

# 3. LOC vs budget
HEALTH_LOC=10
LOC_TOTAL=$(git diff --stat $BASE_SHA..HEAD | tail -1 | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
if [ -n "$LOC_TOTAL" ] && [ "$LOC_TOTAL" -gt "$DIFF_BUDGET_LOC" ]; then
  OVER=$((LOC_TOTAL - DIFF_BUDGET_LOC))
  HEALTH_LOC=$((10 - OVER * 10 / DIFF_BUDGET_LOC))
  [ "$HEALTH_LOC" -lt 0 ] && HEALTH_LOC=0
fi

# 4. Secrets scan (best-effort grep)
HEALTH_SECRETS=10
if git diff $BASE_SHA..HEAD | grep -E '(api[_-]?key|secret|password|token|bearer)[\s]*[:=][\s]*[\"\047][^\"\047]{8,}' -i; then
  HEALTH_SECRETS=0
fi

# Composite weighted (tsc 0.35, test 0.35, loc 0.15, secrets 0.15)
HEALTH_SCORE=$(awk "BEGIN { printf \"%.1f\", $HEALTH_TSC*0.35 + $HEALTH_TEST*0.35 + $HEALTH_LOC*0.15 + $HEALTH_SECRETS*0.15 }")
```

Operator stores: `packets[].health_score = HEALTH_SCORE`, `packets[].health_breakdown = {tsc: HEALTH_TSC, test: HEALTH_TEST, loc: HEALTH_LOC, secrets: HEALTH_SECRETS}`.

**Bail-out**: суммарный timeout 90s (sum of per-command). Превышение → `health_score = null`, log `health_compute_timeout` blocker. Не block packet status=done — health diagnostic, не gate.

**Rolling trend**:
`state.health_history.push({packet_id, score: HEALTH_SCORE, ts: <ISO>})`. Trim oldest если length > 10.

Strategic-review reads `state.health_history`. **Null-handling**: filter out entries с `score == null` (health bail-out cases) ДО slice. Take last 3 non-null. Если non-null count < 3 → trend = `"stable"` default (insufficient data для signal). Иначе trend = `"falling"` if `slice[-1].score < slice[-3].score - 1`; else `"stable"`/`"rising"`. Strategic prompt input passes filtered slice + trend label explicitly (не raw history).

## Strategic review (vision check)

**Placement**: inline check в tick step 7 ПОСЛЕ verdict-routing решает `packet status=done` (НЕ separate phase). Если check срабатывает — operator spawns Strategic Architect Agent synchronously, parses verdict, действует, write state, exit tick. Next tick продолжает с `init` следующего packet (если recommendation=continue).

Trigger: `packets_done_since_review >= strategic_review_every (=3)`.

```
Agent(
  description: "Strategic vision check wave <wave_id>",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <strategic prompt>
)
```

Strategic prompt:

```
You are strategic architect. Read-only.

Meta-goal (Vision Lead source):
<cat docs/specs/<wave>.md § "Final Formula" | "Коротко">

Last 3 packet commits:
<git log --oneline -3 $last_strategic_sha..HEAD>

Per packet brief:
<packet_id>: <stated goal>

Health history (rolling-3, [{packet_id, score, ts}]):
<state.health_history.slice(-3)>

Gbrain context (если MCP available, prior wave patterns):
<gbrain query "patterns from prior waves resembling <wave_id>" OR omit section>

Task: Compare last 3 commits vs meta-goal через 6 decision principles. Каждый principle scored 0-10 WITH evidence sentence(s).

6 principles:
- **scope**: reality vs original wave goal (10 = exactly on goal, 0 = unrelated work).
- **taste**: coherence с prior decisions / patterns (10 = matches style, 0 = inconsistent direction).
- **debt**: technical debt accumulation (10 = no new debt, 0 = major debt traded for speed).
- **impact**: user-visible benefit (10 = clear win, 0 = no user impact).
- **reversibility**: how easy to undo recent commits (10 = trivial revert, 0 = irreversible like migration applied).
- **blast_radius**: failure mode scope (10 = isolated, 0 = wave-wide breakage if any commit broken).

Additionally estimate drift_score 0-10 (0=on track, 10=fully off-target).

Output strict JSON only:
{
  "drift_score": <int>,
  "evidence": [<str>],
  "principle_breakdown": {
    "scope":         {"score": <int>, "evidence": [<str>]},
    "taste":         {"score": <int>, "evidence": [<str>]},
    "debt":          {"score": <int>, "evidence": [<str>]},
    "impact":        {"score": <int>, "evidence": [<str>]},
    "reversibility": {"score": <int>, "evidence": [<str>]},
    "blast_radius":  {"score": <int>, "evidence": [<str>]}
  },
  "recommendation": "continue"|"adjust_wave"|"escalate"
}
```

Route (operator derives recommendation if absent/invalid from JSON, applies в priority order):
- Any `principle_breakdown[*].score == 0` → `recommendation=escalate`, phase=`escalated`.
- `drift_score >= 5` OR explicit `recommendation=escalate` → STOP wave, surface к user. Phase=`escalated`.
- Health trend `falling` (from `state.health_history.slice(-3)`: score drop ≥ 1 between slice[-3] и slice[-1]) AND `drift_score < 5` → `recommendation=adjust_wave`.
- Any `principle_breakdown[*].score <= 3` → `recommendation=adjust_wave`.
- `recommendation=adjust_wave` → operator patches wave docs (если architect signals doc-fix через separate verdict) → continue next packet.
- `recommendation=continue` → next packet (no action).
- Update `last_strategic_sha = HEAD`. Reset `packets_done_since_review = 0`.

**Parse fallback**: если strategic architect возвращает unparseable JSON → log warning `strategic_parse_fail: <first 200 chars>` в history, `state.strategic_parse_fail_count++`, treat as `recommendation=continue` (не block wave). Reset `packets_done_since_review = 0` всё равно (избежать infinite retry на next packet). Если `state.strategic_parse_fail_count >= 2` → escalate (architect role broken). На любом successful parse → `state.strategic_parse_fail_count = 0` (reset).

## Cron setup (через CronCreate tool)

```
CronCreate(
  schedule: "* * * * *",   # every minute
  prompt: "Use the operator-loop skill to perform a tick for wave_id=<wave_id> repo_path=<repo_path>"
)
→ returns cron_id (string). Operator stores → state.cron_id.
```

**Prompt format**: natural-language trigger matches operator-loop skill description ("operator tick" / "operator loop" triggers). Cron remote agent gets fresh Claude session, no inherited cwd. Operator embeds `repo_path` в prompt explicitly. Tick step 1 reads `repo_path` from prompt args ИЛИ from state file (state file authoritative после init).

Per-wave one cron entry. `CronList` для inspect. `CronDelete(state.cron_id)` при terminal phase (`done`|`escalated`) — operator делает сам в tick step 3.

## Lifecycle

### Init (manual one-shot — user invokes операtor через Skill tool)

User: `Skill operator-loop` с args `init wave_id=<id> readme=<path> repo=<path>`.

Operator (Я) actions in init invocation (strict order — cron-race-safe):
1. Pre-check: `.operator-state.<wave_id>.json` уже exists → ABORT с message "wave already initialised; wipe first" (см anti-pattern «init на existing state»).
2. Parse packets из `<readme>` (markdown sections defining `<packet_id>` blocks). Packet_id MUST start with `<wave_id>-` prefix (e.g. wave HR-W5 → packets HR-W5-A1, HR-W5-A2) — convention для wipe-glob correctness.
3. Abort если 0 packets (`Empty wave → fail init` per constitution).
4. `Write` `.packet-context.<packet_id>.json` per packet (templates с `allowed_write_paths`/etc из packet block).
5. **`CronCreate` FIRST** — `CronCreate(schedule="* * * * *", prompt="Use operator-loop skill: perform tick for wave_id=<id> repo_path=<repo>")` → capture returned `cron_id`. (Cron не сможет execute до next minute boundary — даже если fires до step 6, state file ещё не существует и tick exits gracefully.)
6. `Write` `.operator-state.<wave_id>.json` ОДИН раз с populated `cron_id` (initial state, `phase=init`, packets[], `cron_id=<from step 5>`). Atomic single write.
7. Exit. Cron picks up next minute с consistent state.

### Tick (cron entry-point — automatic, fresh CC session per tick)

Cron invokes: `Skill operator-loop` с args `tick wave_id=<id> repo_path=<repo>`.

Operator executes Tick algorithm (см § Tick algorithm). One phase advance per tick. Exits.

### User inspection (manual, не operator action)

```bash
jq . .operator-state.<wave_id>.json
git log --oneline --grep="<wave_id>"
```

### Pause / resume (user invokes operator)

User: `Skill operator-loop` с args `pause wave_id=<id>` → operator calls `CronDelete(state.cron_id)`, state preserved, cron_id stays in state file.

User: `Skill operator-loop` с args `resume wave_id=<id>` → operator calls fresh `CronCreate(...)`, обновляет `state.cron_id`.

### Wipe (user shell, после wave done)

```bash
# Glob .packet-context.<wave_id>-*.json works because packet_ids are <wave_id>-<suffix> by convention (см init step 2).
rm .operator-state.<wave_id>.json{,.bak,.tmp} .packet-context.<wave_id>-*.json .packet-fail.<wave_id>-*.r* 2>/dev/null || true
```

## Parallelism / cap

- **Cap**: 5 active subagents (parent operator = 6-й). User override — deploy up to 5 parallel subagents per tick.
- Within packet: worker serial; architect + critic + cso + extra critics parallel после worker commit (up to 4 critics + 1 worker = 5 total children).
- Across packets: respect `blocked_by`; independent packets можно parallel up to cap (multi-tick: каждый tick advances ONE packet).
- Cron heartbeat не считается subagent.

## Anti-patterns

- **Multi-phase per tick** — одна ошибка стопит несколько шагов. One tick = one phase.
- **In-memory state между ticks** — fresh process per tick (cron спавнит новую сессию). Always write state file.
- **Sync worker wait (blocking)** — tick timeout. Worker async via Agent return, next tick polls `git log`.
- **Skip strategic review** ради скорости → wave drift. Honor STRATEGIC_REVIEW_EVERY=3.
- **Mid-wave constitution mutation** → determinism break. Complete wave с одной constitution версии.
- **Operator patches code directly** → role-guard violation. Always через worker dispatch.
- **Weak `git log --grep=<id>`** — false positive (`A1` matches `A11`). Anchored regex обязательно.
- **Empty parsed wave** → fail init. НЕ создавать `.operator-state.*.json` с `packets: []`.
- **Skip `spec_fix_count` increment** → spec-instability loop без detection.
- **Re-using same worker Agent round-over-round** — fresh subagent каждый round (clean context).
- **Raising MAX_ROUNDS без cause** — round 5 без fix = real escalation, не очередной loop.
- **Operator silent doc-fix** чтобы скрыть impl failure → требуется явный `architect.fix_target=spec`.
- **Cron tick без termination check** → infinite cron после wave done. Step 3 обязателен.
- **Nested `/task` в worker subagent** → silently skipped в 8/14 measured cases. Worker = raw impl; critic-loop делает operator parent через separate architect+critic Agent gates.
- **Spec-fix без re-gate** → operator патчит docs и сразу re-dispatch worker без verify spec stable. Должно быть: doc-patch → `verdict-spawning` → architect+critic re-verdict → потом impl.
- **Strategic parse failure блокирует wave** → treat as `recommendation=continue` + log warning; two consecutive fails → escalate (architect role broken).
- **Parallel cap violation при verdict-spawning** → architect + critic = 2 subagents параллельно; operator parent = 3rd. Окей. Но spawning worker одновременно с verdict gate (cross-packet parallel) → cap=4 violation. Verdict gate всегда serial с worker этого packet.
- **CronCreate без store cron_id** → terminal phase не может clean up; cron бесконечно дергает done wave. State.cron_id обязателен после init.
- **`init` повторно на existing state file** → overwrites mid-wave progress. Init должен fail если `.operator-state.<wave_id>.json` уже exists (require explicit wipe).
- **Doc-patch без rollback on fail** → partial edit без commit оставляет working tree dirty + state.last_doc_patch_sha desync. На любую ошибку Edit/commit — `git checkout -- <paths>` для возврата чистого состояния.
- **Init order Write-state-before-CronCreate** → race window: cron fires до того как state.cron_id записан → terminate cleanup невозможен. CronCreate FIRST, потом единый Write state с populated cron_id.
- **Strategic review после state write** → mutation между write и exit не персистится; partial-failure теряет escalate decision. Strategic check inline ДО step 8 state write.
- **CSO Critic для ordinary packets** → Opus burn + cap drain без security signal. CSO trigger conditional only (risk_tier security/auth/db/migrations OR path regex). См § Dispatch triggers.
- **Investigator без bound** → infinite root-cause retry. Cap `packets[].investigate_count < 2`; на 2 → forced escalate "investigate_cap_hit".
- **Codex Challenger для ordinary packets** → adversarial Opus burn без break-risk signal. Trigger conditional only (CSO trigger met OR file_count_max > 5).
- **Health computation blocking tick > 90s** → tick timeout (cron вновь fires до завершения). Bail-out timeout per command (`timeout 30s` tsc, `timeout 60s` test); сумма cap 90s, health_score=null on exceed.
- **Gbrain sync mid-wave** → race с tick reads (gbrain index updates concurrently с operator tick). Sync ТОЛЬКО terminal step 3, state.gbrain_synced gate prevents re-run.
- **Blind retry на repeated worker_fail без investigate** → MAX_ROUNDS=5 exhausted на same root cause. Investigate trigger обязателен on round≥2 + worker_fail.
- **Strategic principle_breakdown без evidence** → drift_score unfounded, recommendation untrustworthy. Prompt requires `evidence: [str]` per principle; operator может drop verdict если evidence array empty (treat as parse_fail).
- **Challenge-gate re-run на тот же impl_sha** → wasted Opus call (challenger already passed/failed на этот diff). State.challenge_done_for_sha gate; re-enter с same SHA → skip.
- **Dry-run без понимания worker limitation** → operator-side mutations gated, но worker subagents NOT controlled by dry-run flag (subagent makes its own commits). Document limit; dry-run для trigger validation, не full safety.

## Acceptance examples (trigger condition validation)

### Example A: CSO dispatch fires on security packet

Packet block (excerpt):
```yaml
id: HR-W5-S1
risk_tier: security
allowed_write_paths: [src/auth/, src/middleware/auth.ts]
file_count_max: 3
```

Operator behaviour:
- Verdict-spawning phase → batch 3 Agents (architect + worker-critic + cso-critic) — single message с 3 Agent calls.
- CSO trigger met (risk_tier=security).
- challenge-gate trigger ALSO met (CSO trigger met) → after ok+ok+ok → spawn challenger sequentially.

### Example B: Investigate fires only on round≥2 + consecutive worker_fail

- Round 1: worker FAIL ("test_setup_error"). awaiting-commit case (a) → blocker `worker_fail: test_setup_error`, round++ (now 2). investigate trigger check: round=2 met, prior blocker matches `^worker_fail:`, investigate_count=0 < 2 → spawn Investigator.
- Investigator returns `{root_cause: "missing fixture dir", suggested_fix: "create tests/fixtures/ before test run"}`.
- Operator appends suggested_fix к blockers → phase=fix-dispatching, investigate_count=1.
- Round 2: worker still FAIL ("missing import"). awaiting-commit case (a) → blocker `worker_fail: missing import`, round++. investigate trigger: round=3, prior worker_fail, investigate_count=1 < 2 → spawn Investigator again. count=2.
- Round 3: worker FAIL again. investigate trigger: count=2, NOT < 2 → DON'T dispatch; phase=`escalated` reason "investigate_cap_hit".

### Example C: Challenge break-scenario triggers re-dispatch

Packet `file_count_max=8` (challenge trigger by LOC). architect+critic ok=true. → challenge-gate. Challenger returns `{ok: false, break_scenarios: ["abort mid-transaction leaves orphan row"], severity: "high"}`. → blocker `challenge_broke: abort mid-transaction leaves orphan row`, round++. challenge_done_for_sha NOT set. phase=fix-dispatching. Worker round next с blocker.

Worker fixes abort handling. Next round: architect+critic ok=true again, challenge-gate fires again (different impl_sha). Challenger returns `{ok: true, break_scenarios: [], severity: "none"}`. → challenge_done_for_sha = new_impl_sha. packet status=done.

### Example D: Gbrain terminal sync conditional

- Wave done, terminal tick. state.gbrain_synced=false.
- `command -v gbrain` exit 0 → run:
  ```
  timeout 60s gbrain import docs/tasks/hermes-rails/W5.md docs/specs/HR-W5.md
  timeout 60s gbrain extract all
  ```
- state.gbrain_synced = true. Exit.

Если gbrain не installed (`command -v` exits 127): log "gbrain_not_available", state.gbrain_synced остаётся false (re-attempt при re-run terminal phase impossible — wave terminal once). Exit cleanly.

## Dry-run mode

`state.dry_run` flag — set via init `--dry-run`. Enables full Agent flow without code mutations.

Effects when true:
- Worker dispatches → Agent runs normally (subagent makes its own commits if any — operator can't control subagent's git activity; document this as limitation; recommend dry-run для testing trigger conditions, not full safety).
- Operator doc-patches → `Edit`/`Write` calls REPLACED with log entries `dry_run: would Edit <path> -- <preview>` ИЛИ `dry_run: would Write <path> <N chars>`.
- Doc-patch commits → Bash `git commit` REPLACED with log `dry_run: would commit "<message>"`.
- Health computation → runs normally (read-only).
- Gbrain sync → logged как `dry_run: would sync gbrain` BUT actual `gbrain import` NOT run. **`state.gbrain_synced` NOT mutated** (stays `false`) — subsequent real (non-dry-run) terminal phase will execute actual sync. Mutating bы привело к data loss (sync skipped permanently after dry-run).
- Verdict gates / strategic / investigate / challenge — все Agents run normally (verdicts collected for inspection).

Recommended use: validate trigger conditions on small wave before production run. NOT a replacement для acceptance test framework.

## File-length note

Этот skill ~750 LOC. Skill files в `~/.claude/skills/` exempt от subbrain 300-LOC hygiene cap (он таргетит repo source code, не CC skill metadata files). Operator-loop contract must live в одном файле — CC skill loader не supports `#include`. Critic/architect dispatch templates require single-source-of-truth для cron-spawned fresh sessions reading skill at tick boundary.

## Reference points

- Constitution: `~/.claude/skills/system-constitution/SKILL.md`
- Architect skill (single-angle impl-stage): `~/.claude/skills/architect/SKILL.md`
- Plan multi-review skill (multi-angle plan-stage): `~/.claude/skills/plan-multi-review/SKILL.md`
- Operator orchestrator (one-shot variant): `~/.claude/skills/operator-orchestrator/SKILL.md`
- Constitution patch: `~/.claude/skills/constitution-patch/SKILL.md`
- Cron tooling: `CronCreate`, `CronList`, `CronDelete` (built-in Claude Code).
- Subagent dispatch: `Agent` tool с `subagent_type=general-purpose` + `model` override.
- Gbrain CLI (optional terminal sync): `/usr/projects/gbrain/`, binary `~/.bun/bin/gbrain`.
- Gstack origin для CSO/Investigate/Challenge patterns: `/usr/projects/gstack/cso/`, `/usr/projects/gstack/investigate/`, `/usr/projects/gstack/codex/`.
