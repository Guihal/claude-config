---
name: executor-commit-nudge
description: Soft behavioral skill для executor agents. Prevents "refine forever" hang без hard time limit. Injected into executor prompt pre-dispatch; operator can trigger runtime nudge via file signal. Complements constitution MAX_EXECUTOR_WALL_TIME hard rail. Triggers - executor hang, refine during acceptance, no commit signal.
---

# Executor Commit Nudge

Soft behavioral nudge для executor-агентов. Предотвращает паттерн "refining during acceptance" — когда executor достигает рабочего состояния (тесты проходят, файлы записаны) но продолжает полировать вместо коммита.

## Problem (evidence)

| Wave | Round | Max Elapsed | Outcome |
|------|-------|-------------|---------|
| HR-W11 r1 | 5 polls | 26:14 | Never committed, operator respawned r2 (1-line fix, 3-4 min) |
| HR-W12 r0 | 12 polls | 55:42 | Files refreshed at 23:15 but no commit until operator intervention |

Root cause: нет внешнего сигнала "stop now". Executor думает "ещё чуть-чуть".

## When to trigger

### Pre-dispatch (recommended)
Всегда — skill text appended to executor prompt as behavioral preamble. Zero runtime overhead.

### Runtime nudge (operator-side)
Operator tick script detects `elapsed > 15min && no commit && process alive`:
1. Write `.nudge-commit` file в repo root
2. Executor checks file every 5 min (или при следующем poll)
3. После прочтения — удалить файл, чтобы nudge не повторялся

### Post-hang recovery
Если executor marked lost:
- Do NOT respawn blindly
- Check `git status` first
- If changes exist → commit as-is, spawn critic on that commit
- If no changes → respawn с reinforced skill text в prompt

## Skill text (executor prompt injection)

```
---
COMMIT CHECKPOINT — read before every tool call after 10 minutes of work
---

You have been working on this task for a while. Before the next edit, ask:

1. Does `git status` show changes that satisfy the task spec?
2. Do tests pass (run them now if unsure)?
3. Are there any TODO/FIXME comments left that block commit?

If YES to #1 and #2 → COMMIT NOW with a descriptive message.
  Commit LOCALLY ONLY. Do NOT push to remote.
  Do not "polish one more thing." Do not "just check one more edge case."
  The critic round will catch what you missed. Your job is to land the
  implementation, not to perfect it in isolation.

If NO → fix the blocker, then commit immediately after.

If stuck on a blocker > 5 min → commit what you have with "WIP: <blocker>"
  and let the operator decide next step.

---
```

## Operator-side integration

Add to tick script `awaiting-commit` phase (after commit detection, before timeout check):

```bash
# Commit nudge: detect hang and signal executor
if [ -z "$commit_sha" ] && [ "$elapsed_min" -gt 15 ]; then
  if kill -0 "$executor_pid" 2>/dev/null; then
    echo "$(date -Iseconds) NUDGE: executor alive, no commit for ${elapsed_min}m" >> "$TICK_LOG"
    touch "$REPO/.nudge-commit"
  fi
fi
```

Executor side (в prompt или в packet contract):
```
If file `.nudge-commit` exists in repo root:
  1. Read its contents (empty = generic nudge)
  2. Run commit checkpoint questions above
  3. If YES → commit now, delete `.nudge-commit`
  4. If NO → delete `.nudge-commit` anyway (signal consumed)
```

## Anti-patterns this prevents

| Pattern | Evidence | Why it happens |
|---------|----------|----------------|
| Refining during acceptance | Files refreshed, tests written, no commit | Executor thinks "almost done" |
| Tool loop hang | Tooling output alive 20+ min | Analysis instead of committing |
| Silent death | Process alive but no output | Stuck in internal reasoning |

## Why soft nudge, not hard timeout

Hard timeout kills work in progress — lost commits, partial fixes, wasted tokens. Soft nudge:
- Respects variable task complexity (some legitimately need 30+ min)
- Leverages executor's own judgment
- Allows operator to see *what* executor was doing when nudged
- Reduces to "commit checkpoint" habit

Constitution complement: `MAX_EXECUTOR_WALL_TIME` (hard rail, kills process). Skill = prevention; constitution = enforcement.

## Verification

After deploying, operator log should show:
- Fewer `elapsed > 15min, no commit` entries
- More commits with elapsed 5-10 min
- `refining during acceptance` pattern eliminated
