---
name: operator-orchestrator
description: Top-level coordinator for packet wave / single packet. Dispatches implementer subagents (Opus for strong_gate/security/db/large-diff; Sonnet for ordinary/doc-only weak_ok). Runs /architect skill for spec gate, lite critic subagent for rules gate. Self-feeding spec loop via fix_target=spec doc-patches. Iterates until both gates ok or MAX_ROUNDS hit. Triggers - запусти оператора, operator loop, operator dispatch, /operator <packet>, execute wave through operator.
---

# Operator Orchestrator

Top-level coordinator. Routes implementation across implementer/architect/critic; respects packet dependencies; iterates до double-gate pass или MAX_ROUNDS. Single entry для packet wave или одиночного packet.

## Контракт

- **Operator direct-write ONLY**: `docs/**`, repo-root `*.md` (CLAUDE.md, README.md). Прочее (code, configs, tests) — строго через implementer subagent. Violation = audit break.
- **Implementer dispatch** всегда via worker prologue: `Skill caveman` → `Skill subbrain-guardrails` → `/task --depth=standard|complex 'execute <packet_id>'`.
- **Architect gate** через `/architect` skill (always Opus critic).
- **Critic gate** через lite read-only critic subagent (general-purpose, Sonnet default) — НЕ `/task` (heavyweight RLM duplicate).
- **`MAX_ROUNDS = 5`** per packet. Round 6 → escalate user.
- **Constitution reference**: invariants + role rights + 5-loop model в `~/.claude/skills/system-constitution/SKILL.md`. Operator operates within Operator role-rights row (write only `docs/**` + repo-root `*.md`).
- **Parallel cap**: 3 active subagents (parent = 4-й). Source: `~/.claude/CLAUDE.md` + project `CLAUDE.md`.

## Usage

```
/operator packet <packet-id>           # один packet
/operator wave <readme-path>           # все packets по dependency order
```

## Model dispatch (implementer)

| Condition | Model |
|---|---|
| `risk_tier ∈ {security, db}` | Opus |
| `dispatch = strong_gate` | Opus |
| `diff_budget_loc > 200` | Opus |
| `file_count_max > 3` | Opus |
| `allowed_write_paths` все под `docs/**` AND `diff_budget_loc ≤ 30` AND `file_count_max = 1` | Haiku |
| `allowed_write_paths` все под `docs/**` (иначе) | Sonnet |
| иначе `weak_ok` | Sonnet |

Architect = **Always Opus** (через `/architect`).
Critic = default (Sonnet, lite spawn).

## Algorithm per packet

1. **Read packet block** из README: `allowed_write_paths`, `acceptance`, `diff_budget_loc`, `file_count_max`, `escalation_triggers`, `non_goals`.
2. **`BASE_SHA = $(git rev-parse HEAD)`**.
3. **Pick implementer model** per dispatch table.
4. **Round `N = 1`**.
5. **Spawn implementer subagent** с full packet + worker prologue:
   - `Skill caveman`.
   - `Skill subbrain-guardrails` (если subbrain repo).
   - `/task --depth=<standard|complex per risk> 'execute <packet_id>'`.
   - Edit only `allowed_write_paths`.
   - Run packet `acceptance`.
   - Commit. Return `OK <7-sha> <subject>` + `FILES: <basenames>` OR `FAIL: <reason>`.
6. **Operator parent verify**:
   - `git show --stat <sha>`.
   - `git diff --name-only $BASE_SHA..<sha>` — confirm все файлы внутри `allowed_write_paths`.
   - Re-run packet `acceptance`.
   - Если scope escape ИЛИ acceptance broken → mark round failed, feedback `"scope broke"` / `"acceptance broke"`, GOTO step 11.
7. **Architect gate**:
   - Spec paths = packet `read_context` fields указывающие на `docs/specs/*` + task README.
   - `Skill architect --depth=standard --spec=<paths> --diff=$BASE_SHA..<sha> '<packet goal>'`.
   - Receive JSON verdict.
8. **Critic gate (parallel с architect)**:
   - Spawn lite critic subagent (general-purpose, Sonnet, read-only):
     - prompt: diff + `CRITIC_PROMPT_TEMPLATE` (rules pointers: `CLAUDE.md`, `~/.claude/CLAUDE.md`, `subbrain-guardrails` skill).
     - Returns JSON `{ok, blockers[], notes}`.
9. **Verdict routing**:
   - `architect.ok=true AND critic.ok=true` → packet DONE. GOTO step 12.
   - `architect.fix_target = escalate` → STOP, surface verdict + notes to user.
   - `architect.fix_target ∈ {spec, both}`:
     a. Operator self-patches `docs/**` based on `architect.spec_issues`.
     b. Operator commits docs: `docs: <packet_id> reconcile spec with reality — <short reason>`.
     c. Если `fix_target = spec` only → re-dispatch implementer Round `N+1` (impl reads new spec).
     d. Если `fix_target = both` → также merge `architect.{missing,misplaced,unfinished}` + `critic.blockers` в feedback, Round `N+1`.
   - `architect.fix_target = impl` OR `critic.blockers` non-empty:
     - Merge `architect.{missing,misplaced,unfinished}` + `critic.blockers` в feedback packet.
     - GOTO step 11 (re-dispatch).
10. **Spec-fix loop guard**: если architect-spec-fix triggered 2 раза подряд на этом packet → spec unstable, escalate to user.
11. **Round `N += 1`**. Если `N > MAX_ROUNDS` (5) → STOP, escalate.
    - Re-spawn fresh implementer с prior commit + merged feedback. Same model tier.
    - GOTO step 6.
12. **Done**. Output single line: `HR-XX round=<N> impl=<sha> arch=ok(<count>) critic=ok(<count>) doc_patches=<count>`.
13. **Strategic review** (periodic): если `committed_count_in_wave % STRATEGIC_REVIEW_EVERY (=3) == 0` → run strategic review per constitution procedure (architect-rescan последних 3 packet commits vs meta-goal). `drift_score ≥ 5` OR `recommendation=escalate` → STOP wave, surface to user. `recommendation=adjust_wave` → patch wave docs + continue. `recommendation=continue` → next packet.

## Stop / escalate conditions

- Packet `escalation_triggers` fired.
- `MAX_ROUNDS = 5` exceeded.
- `architect.fix_target = escalate`.
- Architect requested spec-fix 2 раза подряд (spec unstable).
- Critic flags secret leak / destructive action.
- Acceptance broken 2 round в row.
- User interrupt.
- Strategic review: `drift_score ≥ 5` OR `recommendation = escalate`.

## Doc-patch discipline

1. **Patch ТОЛЬКО** при `architect.fix_target ∈ {spec, both}`. Никаких proactive spec-fix'ов.
2. **Commit отдельно** ДО re-dispatch implementer. Не amend prior commit.
3. **Commit msg format**: `docs: <packet_id> reconcile spec with reality — <short reason>`.
4. **Audit trail** в final wave report: impl commits + doc commits separately listed.
5. **2 spec-fix подряд** → escalate (spec unstable, человек должен решать).

## CRITIC_PROMPT_TEMPLATE

```text
You are the rules critic. Read-only.

Repo rules pointers:
- CLAUDE.md (project root)
- ~/.claude/CLAUDE.md (user global)
- subbrain-guardrails skill (если subbrain repo)

Diff:
<git diff base..head>

Task description:
<task desc>

Find blockers only:
- Rule violations from CLAUDE.md guardrails (file size, SoC, http-client, logger contract, validation, single-source-of-truth, tests-discipline, security).
- Edge-case bugs (race, abort, timeout, partial-write).
- Secret leaks / destructive actions.
- NO style nits, NO refactor suggestions, NO architectural commentary (architect's domain).

Output strict JSON only:
{"ok": <bool>, "blockers": [<string>], "notes": <string>}
```

## Parallelism rules

- **Within packet**: implementer serial; architect + critic parallel after implementer commits.
- **Across packets**: respect `blocked_by`; independent packets parallel up to cap.
- **Hard cap**: max 3 active subagents (parent = 4-й). Source: `~/.claude/CLAUDE.md` + project `CLAUDE.md`.
- Heartbeat / cron не считаются subagent.

## Output

- **Per packet** single line: `HR-XX round=N impl=<sha> arch=ok(<arch_rounds>) critic=ok(<critic_rounds>) doc_patches=<count>`.
- **Wave summary**:
  - Done list (packet IDs).
  - Blocked list (with reason).
  - Commits list (impl + doc commits separately).
  - Escalations.

## Anti-patterns

- **Operator direct-write outside `docs/**` или repo-root `*.md`** → contract violation.
- **Operator amending doc-patch commit** → audit trail breaks (separate commit мандатный).
- **Operator silent doc-fix** чтобы скрыть impl failure → требуется явный `architect.fix_target=spec`.
- **Operator skipping architect** для "obvious" packets → packet author judged what needs verification; honor that.
- **Re-using same implementer subagent round-over-round** → spawn fresh каждый раунд (clean context).
- **Raising `MAX_ROUNDS` без cause** → round 5 real fix = escalation, не очередной loop.
- **Using `/task` для critic gate** → heavyweight RLM duplicate; lite spawn вместо.
