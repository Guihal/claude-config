---
name: plan-multi-review
description: "Parallel multi-perspective plan critique — CEO (scope/ambition), ENG (architecture/edge-cases), DX (devex friction, conditional), ARCHITECT (spec consistency). 3 always-parallel + 1 conditional sequential. Merged JSON routing {ok, unanimous_blockers, conflicts, per_critic, routing: ok|fix|escalate}. Replaces single-architect spec gate at PLAN stage (не impl). Triggers - \"multi review\", \"plan multi review\", \"/plan-multi-review <plan-path>\", \"критика плана с 3 углов\", \"4-role plan critique\"."
---

# Plan Multi-Review

Plan-stage critique через 3 параллельных role-perspectives + 1 conditional. Использует `Agent` tool, model=opus для всех (rigour > cost на plan-stage). Predecessor `/architect` skill — single-angle; plan-multi-review — multi-angle parallel.

Constitution: `~/.claude/skills/system-constitution/SKILL.md`. Каждый critic — read-only role (subagent_type=general-purpose); единственная запись — свой VERDICT_FILE.

## Когда

- Перед wave init / перед dispatch первого worker'а.
- При существенной правке spec'а до re-init wave.
- Standalone проверка plan документа (`/plan-multi-review docs/specs/<wave>.md`).
- НЕ замена operator-loop verdict-spawning (impl-stage architect+critic) — это для plan-stage.

## Cap=3 contract (parallel/sequential split)

Hard cap: 3 active subagents (parent operator = 4-й). Source `~/.claude/CLAUDE.md`.

**4 critics + parent = 5 → violation если все параллельно.** Решение:
- Always batch (3 parallel): CEO + ENG + ARCHITECT.
- DX critic — conditional + **sequential ПОСЛЕ** первой тройки merge (1 child, OK с cap).
- Merge финальная — после DX (если spawned) ИЛИ после first triplet (если DX не triggered).

## DX trigger (concrete)

DX spawned если **любое** из:

| Source | Regex | Flags |
|---|---|---|
| Structured packet fields (`allowed_write_paths`, `read_context`) — array of paths | `^(api\|cli\|sdk\|docs\|examples\|openapi)/` | case-insensitive (`i`) |
| Plan prose tokens — path-shaped substrings | `(?:^\|[\s"`(])(api\|cli\|sdk\|docs\|examples\|openapi)/` | case-insensitive (`i`); matches paths embedded in markdown даже без leading `/` |
| Plan prose keywords (semantic) | `\b(developer experience\|onboarding\|API surface\|CLI flag\|SDK\|public interface\|hello[- ]world\|TTHW\|integration[- ]point)\b` | case-insensitive (`i`) |

**Scope**: any of 3 sources matching → DX triggered. Structured fields take priority (no false positive risk); prose regex secondary.

Override flags:
- `--dx` force spawn DX даже без trigger
- `--no-dx` skip DX даже при trigger (e.g. internal infra changes)

No trigger AND no override → DX skipped, 3-critic merge final.

## Dispatch — first triplet (parallel batch)

ONE Agent-batch message = 3 concurrent invocations:

```
[Single message with 3 Agent tool calls]
Agent(name: "critic-ceo", description: "Plan critique — CEO", subagent_type: "general-purpose", model: "opus", prompt: <CEO_PROMPT>)
Agent(name: "critic-eng", description: "Plan critique — ENG", subagent_type: "general-purpose", model: "opus", prompt: <ENG_PROMPT>)
Agent(name: "critic-arch", description: "Plan critique — ARCHITECT", subagent_type: "general-purpose", model: "opus", prompt: <ARCHITECT_PROMPT>)
```

Parent waits for the 3 **verdict files**, not for the returns — see "Verdict transport". Parse JSON from the files. Check DX trigger. Если DX trigger → sequential DX dispatch (1 child).

## Verdict transport — read the file, not the reply

Claude Code bug #75043: a subagent's final message often never reaches the parent. **The verdict file is the gate.**

1. Each critic gets its own `VERDICT_FILE = ~/.claude/verdicts/<plan-stem>/<role>.json`. `mkdir -p` before dispatch. Never share a path between critics — parallel writers would clobber each other.
2. Always pass `name:` (shape above) — without it you cannot nudge the critic later.
3. Wait for each file to end with `<<<VERDICT-END>>>`, then read it. Portable wait (fish and bash), cap ~5 min:

   ```
   sh -c 'i=0; while [ $i -lt 150 ]; do tail -n1 "$1" 2>/dev/null | grep -q "VERDICT-END" && break; sleep 2; i=$((i+1)); done; cat "$1"' _ <VERDICT_FILE>
   ```

4. Parse the file contents (strip the sentinel line, then JSON.parse). The file is authoritative even when a reply also arrived.
5. No sentinel after the wait → `SendMessage` that critic by `name`: `write your verdict JSON to <VERDICT_FILE> now, ending with <<<VERDICT-END>>>`. Wait once more. Only then count that critic as missing — and a missing critic is not `ok=true`, so the merge cannot route to `"ok"`.

## Dispatch — DX conditional sequential

```
Agent(name: "critic-dx", description: "Plan critique — DX", subagent_type: "general-purpose", model: "opus", prompt: <DX_PROMPT>)
```

Single child, cap-safe.

## Prompts (4 distinct, self-contained)

### CEO prompt

```
You are CEO/founder critic, Y Combinator style. Read-only apart from writing your VERDICT_FILE.

VERDICT_FILE: <abs path, unique per critic — e.g. ~/.claude/verdicts/<plan-stem>/<role>.json>

Plan:
<full plan text>

Context (если provided):
- Wave goal: <meta-goal>
- Risk tier: <risk_tier>

Critique по 6 angles:
1. Scope reality — what does это solve actually vs. claims?
2. Ambition gap — what would 10× version look like? Что dropping?
3. Status quo — who suffers from current state? Acute pain?
4. Narrowest wedge — single best entry point?
5. Desperate specificity — concrete user / use-case / metric vs vague?
6. Future-fit — does compound со временем? Or one-off?

Find blockers (medium+ severity ONLY). NO style nits.

Output strict JSON only (no markdown):
{"ok": <bool>, "scope_gap": <str>, "ambition_score": <int 0-10>, "ten_star_idea": <str>, "narrowest_wedge": <str>, "blockers": [<str>], "notes": <str>}
Write that JSON to VERDICT_FILE (absolute path given above), then one final line `<<<VERDICT-END>>>`. That file is the delivery — the parent reads it, not your reply (Claude Code bug #75043: subagent final messages often never arrive). Write it once, only when your critique is done, then reply with the same JSON.
```

### ENG prompt

```
You are engineering manager critic. Read-only apart from writing your VERDICT_FILE.

VERDICT_FILE: <abs path, unique per critic — e.g. ~/.claude/verdicts/<plan-stem>/<role>.json>

Plan:
<full plan text>

Context: <risk_tier, file_count_max если provided>

Critique по 6 angles:
1. Architecture coherence — layering, SoC, data flow.
2. Edge cases missing — race, abort, timeout, partial-write, empty-state.
3. Test coverage gaps — what's not testable as written?
4. Perf hotspots — N+1, blocking ops, large allocations.
5. Failure modes — what breaks? Recovery path?
6. Migration / rollback safety.

Find blockers (medium+ ONLY). NO style nits.

Output strict JSON only:
{"ok": <bool>, "arch_concerns": [<str>], "edge_cases_missing": [<str>], "test_gaps": [<str>], "perf_hotspots": [<str>], "failure_modes": [<str>], "blockers": [<str>], "notes": <str>}
Write that JSON to VERDICT_FILE (absolute path given above), then one final line `<<<VERDICT-END>>>`. That file is the delivery — the parent reads it, not your reply (Claude Code bug #75043: subagent final messages often never arrive). Write it once, only when your critique is done, then reply with the same JSON.
```

### ARCHITECT prompt

```
You are architect. Read-only apart from writing your VERDICT_FILE.

VERDICT_FILE: <abs path, unique per critic — e.g. ~/.claude/verdicts/<plan-stem>/<role>.json>

Plan:
<full plan text>

Spec docs (cat content):
<cat readme + cat docs/specs/* referenced by plan>

Compare plan vs architectural intent:
1. Structural blocks missing (named в spec but absent in plan).
2. Blocks proposed в wrong layer/folder (cite spec rule + plan placement).
3. Plan goal items contradict spec.
4. Spec ambiguity (plan reveals two readings).
5. Spec contradicts reality (impossible per lib/infra).

Output strict JSON only:
{"ok": <bool>, "missing": [<str>], "misplaced": [<str>], "contradictions": [<str>], "spec_issues": {"ambiguous": [<str>], "contradicts_reality": [<str>]}, "fix_target": "plan"|"spec"|"both"|"escalate", "notes": <str>}
Write that JSON to VERDICT_FILE (absolute path given above), then one final line `<<<VERDICT-END>>>`. That file is the delivery — the parent reads it, not your reply (Claude Code bug #75043: subagent final messages often never arrive). Write it once, only when your critique is done, then reply with the same JSON.
```

### DX prompt (conditional)

```
You are developer experience critic. Read-only apart from writing your VERDICT_FILE.

VERDICT_FILE: <abs path, unique per critic — e.g. ~/.claude/verdicts/<plan-stem>/<role>.json>

Plan:
<full plan text>

Context: paths touched, public surfaces affected.

Critique по 5 angles:
1. API/CLI surface ergonomics — predictable naming, consistent params?
2. Error message clarity — actionable? Context preserved?
3. Onboarding friction — time-to-hello-world > 5 min?
4. Documentation gaps — examples for new surface?
5. Migration friction для existing users.

Find blockers (medium+ ONLY).

Output strict JSON only:
{"ok": <bool>, "friction_points": [<str>], "onboarding_score": <int 0-10>, "error_clarity_issues": [<str>], "doc_gaps": [<str>], "blockers": [<str>], "notes": <str>}
Write that JSON to VERDICT_FILE (absolute path given above), then one final line `<<<VERDICT-END>>>`. That file is the delivery — the parent reads it, not your reply (Claude Code bug #75043: subagent final messages often never arrive). Write it once, only when your critique is done, then reply with the same JSON.
```

## Merge logic

Inputs: 3 (or 4) JSON verdicts parsed from their `VERDICT_FILE`s.

Steps:
1. Compute `ok = all critics.ok == true`.
2. `unanimous_blockers` — blockers raised by **≥2** critics (string contains-match с normalization: lowercase + drop punctuation). Reduces noise vs single-critic false positives.
3. `conflicts` — pairs где critic_a says X must be done AND critic_b says X must NOT (direction disagree). **Deterministic detection** via opposite-verb table (case-insensitive token match в blockers / notes):

| Verb A | Opposite verb B |
|---|---|
| `expand` | `reduce`, `shrink`, `narrow` |
| `add` | `drop`, `remove`, `delete` |
| `decouple` | `merge`, `combine`, `unify` |
| `parallelize` | `serialize`, `sequence` |
| `generalize` | `specialize`, `restrict` |
| `abstract` | `inline`, `concretize` |
| `defer` | `prioritize`, `now`, `block on` |
| `inline` | `extract`, `factor out` |

Conflict detection: for each pair `(critic_a, critic_b)`, tokenize their blockers + notes (lower-cased), check if critic_a contains a verb in column A AND critic_b contains corresponding column B referencing **same topic** (shared 1+ noun token, e.g. "API surface", "cache layer", "auth middleware"). Match → emit `{critic_a, critic_b, topic, a_says, b_says}`. **Fallback**: если deterministic match не fires но `routing` semantics уж заранее ясно противоречат (`fix_target=plan` vs `fix_target=spec` от разных critics) → optional LLM-judge sub-call (1 Agent, Sonnet, prompt "Are these two critic verdicts in direction-conflict? JSON {conflict: bool, reason: str}"). Cost: 1 extra subagent call ≤ 1s; default ON, override `--no-llm-judge`.
4. `routing`:
   - all `ok=true` AND `conflicts=[]` → `"ok"` (plan ready).
   - any blocker AND `conflicts=[]` → `"fix"` (merged blockers actionable).
   - `conflicts != []` → `"escalate"` (taste decision, human resolves).

## Output JSON shape

```json
{
  "ok": false,
  "unanimous_blockers": ["edge case: empty wave packet list undefined", "missing rollback path for migration"],
  "conflicts": [
    {"critic_a": "ceo", "critic_b": "eng", "topic": "scope expansion vs file_count_max cap", "ceo_says": "...", "eng_says": "..."}
  ],
  "per_critic": {
    "ceo": {<CEO verdict JSON>},
    "eng": {<ENG verdict JSON>},
    "architect": {<ARCHITECT verdict JSON>},
    "dx": null | {<DX verdict JSON>}
  },
  "routing": "ok" | "fix" | "escalate"
}
```

## Usage

### From caller (e.g. before operator-loop init)

```
Skill plan-multi-review
args: --plan=<path> [--dx | --no-dx] [--risk-tier=<tier>] [--file-count-max=<n>]
```

### Standalone

```
/plan-multi-review docs/specs/<wave>.md
```

### Programmatic (inside another skill)

Spawn 3 parallel critics via Agent batch → wait → check DX trigger → spawn DX seq если нужно → merge → return JSON.

## Constitution alignment

- All critics read-only (subagent_type=general-purpose, нет write rights через operator's constitution but enforced by prompt "Read-only"); единственное исключение — запись своего VERDICT_FILE.
- Plan-multi-review caller — usually operator OR user — does not commit. Outputs JSON, downstream consumer decides act.
- Не делает Agent dispatches вне 3+1 critics. Cap=3 always honored.

## Anti-patterns

- **Spawn 4 параллельных** → cap=3 violation. DX must be sequential ПОСЛЕ first triplet.
- **Drop ARCHITECT для скорости** → loses spec-consistency check; architect — hardest-to-replace critic.
- **Skip merge ("just take CEO")** → loses multi-angle benefit; CEO alone biases scope-expansion.
- **Run на каждый packet** → plan-stage tool, не impl-stage. Use only at wave init / spec revisions.
- **DX trigger via vibes** → use concrete regex above. Vibes-based trigger gives inconsistent spawn behaviour.
- **Merge prematurely** (before all critics return) → partial verdicts → wrong routing.
- **Apply conflict-resolution автоматически** → conflicts surface как-is для human. Если auto-resolve — bias hidden.
- **Reuse operator-loop's impl-stage architect prompt verbatim** → impl-stage cares about diff-vs-spec; plan-stage cares about plan-vs-spec (different inputs). Use plan-stage prompt above.

## Reference points

- Operator-loop architect prompt: `~/.claude/skills/operator-loop/SKILL.md` § Architect dispatch (impl-stage variant).
- Constitution: `~/.claude/skills/system-constitution/SKILL.md`.
- Gstack origin: `/usr/projects/gstack/plan-ceo-review/`, `/usr/projects/gstack/plan-eng-review/`, `/usr/projects/gstack/plan-devex-review/`, `/usr/projects/gstack/plan-design-review/`.
- Cap rule: `~/.claude/CLAUDE.md` § Parallel agent cap (HARD).
