# Operator pipeline — 5-minute quickstart

## What this is

A cron-driven packet-wave automation built on Claude Code. You (a fresh CC session) act as the **operator** role: every minute a tick wakes up, reads state, dispatches one architect/worker/critic via the `Agent` tool, writes state back, exits. A **wave** is a sequence of packets (small PR-sized work units) executed end-to-end without human babysitting.

## Prerequisites

Check these once before your first wave. If any fail, fix before invoking init.

- Skills installed at `~/.claude/skills/`: `operator-loop`, `plan-multi-review`, `architect`, `system-constitution`, `constitution-patch`. List with `ls ~/.claude/skills/ | grep -E 'operator-loop|plan-multi-review|architect|system-constitution|constitution-patch'` — must show 5 hits.
- `CronCreate` / `CronDelete` / `CronList` tools available (built-in; no install).
- `gbrain` CLI on `$PATH` is **optional** — only required for terminal-phase memory sync. Without it, gbrain step logs `gbrain_import_failed` and continues. Check with `command -v gbrain`.
- Target repo is a clean git working tree with `docs/specs/` and `docs/tasks/` directories present (operator writes spec docs there). `mkdir -p docs/specs docs/tasks` if missing.
- A packet README exists. See packet block format in `~/.claude/skills/operator-loop/SKILL.md` § Lifecycle (markdown sections with `id:`, `risk_tier:`, `allowed_write_paths:`, `file_count_max:`, `diff_budget_loc:`). Packet IDs MUST start with `<wave_id>-` prefix (wave `MY-W1` → packets `MY-W1-A1`, `MY-W1-A2`).

> Cap rule: max 3 child subagents in parallel per parent (hard rule from `~/.claude/CLAUDE.md`). The operator already respects this; don't spawn extra agents in the same tick.

## Your first wave in 5 minutes

Worked end-to-end. Substitute `MY-W1` with your real wave id and `/path/to/repo` with the repo absolute path.

### Step 1 — Prepare the packet README (1 min)

Write `docs/tasks/MY-W1/README.md` in the target repo. Minimum viable content (one packet):

```yaml
id: MY-W1-A1
risk_tier: ordinary
allowed_write_paths: [src/utils/]
file_count_max: 2
diff_budget_loc: 50
spec: docs/specs/MY-W1.md
goal: Extract dedupe helper from src/utils/list.ts into its own module.
```

Multiple packets → repeat the block separated by `---` or `## <packet_id>` headers. See `~/.claude/skills/operator-loop/SKILL.md` lines 745-765 for richer examples (CSO, challenge-gate, investigate cases).

### Step 2 — Invoke init (30 sec)

In a fresh CC session in the target repo, run:

```
Skill operator-loop init wave_id=MY-W1 readme=docs/tasks/MY-W1/README.md repo=/path/to/repo
```

Operator does (atomic): pre-check no existing state file → parse packets → write per-packet `.packet-context.<id>.json` → `CronCreate(schedule="* * * * *", ...)` → write `.operator-state.MY-W1.json` with the returned `cron_id`. Returns within ~30 sec.

> Gotcha: cron fires on the **next minute boundary**, not immediately. If init completes at 14:23:45, first tick fires at 14:24:00. Expect a ~15-60 sec quiet period.

### Step 3 — Let it run (3 min)

Each tick = one phase advance. You don't drive it; cron does. Phases: `init` → `dispatching` → `awaiting-commit` → `verdict-spawning` → `verdict-routing` → (next packet `init` OR `challenge-gate` OR `fix-dispatching`) → eventually `done` or `escalated`.

### Step 4 — Confirm it's alive

```bash
jq '.phase, .current_packet_idx, .packets[].status' .operator-state.MY-W1.json
CronList
```

`CronList` must show one entry whose prompt mentions `wave_id=MY-W1`. If absent, init never created the cron — wipe and retry.

## Watching progress

Run any time during the wave. None mutate state.

```bash
# Current phase + per-packet status
jq '{phase, idx: .current_packet_idx, packets: [.packets[] | {id, status, round, health_score}]}' .operator-state.MY-W1.json

# Recent commits made by workers (anchored to wave id)
git log --oneline --grep="MY-W1" -20

# Per-packet context (allowed_write_paths, budgets)
jq . .packet-context.MY-W1-A1.json

# Tick history (last 20 entries)
jq '.history[-20:]' .operator-state.MY-W1.json

# Cron entry for this wave
CronList
```

Pause anytime: `Skill operator-loop pause wave_id=MY-W1` (deletes cron, state preserved). Resume: `Skill operator-loop resume wave_id=MY-W1`.

Wipe (only after terminal phase `done` or `escalated`):

```bash
rm .operator-state.MY-W1.json{,.bak,.tmp} .packet-context.MY-W1-*.json .packet-fail.MY-W1-*.r* 2>/dev/null || true
CronDelete <cron_id_from_state>
```

## Common first-time errors

| You see | Cause | Fix |
| --- | --- | --- |
| `wave already initialised; wipe first` on init | Stale `.operator-state.<id>.json` from prior run | Wipe with the rm command above, then re-init |
| `CronList` empty after init returned ok | `CronCreate` returned null `cron_id` but operator wrote state anyway (rare race) | Wipe, re-init. If reproducible, check `CronCreate` tool availability |
| Cron fires but state never advances; `phase` stuck on `init` | Packet IDs in README don't start with `<wave_id>-` prefix | Edit README, fix packet IDs to match `MY-W1-*` convention, wipe + re-init |
| `phase=escalated` reason `investigate_cap_hit` | Worker failed 3+ rounds, investigator cap (2) exhausted | Manual: read `.packet-fail.MY-W1-<pid>.r*` markers + `state.history`, fix root cause by hand, then `resume` |
| `gbrain_import_failed` in tick history | `gbrain` CLI not on PATH | Install/symlink gbrain OR ignore (optional sync only) |
| Worker commits 0 files but `phase` advances to `verdict-spawning` | Worker returned "OK <sha>" but commit was empty (subagent lied) | Check `git log --grep="MY-W1-<pid>"` — if no commit, force `escalated` by editing state, then investigate worker prompt |
| `Edit outside allowed_write_paths` blocker | Worker tried to touch files outside packet's allow-list | Constitution-enforced; next round will retry. If repeated, narrow packet scope in README |
| Tick session writes to non-`docs/**` paths | Operator role-rights violation | Bug — operator may write only `docs/**`, repo-root `*.md`, state files. File against `operator-loop` skill |
| `state.cron_id != null` after `done` but cron still active | `CronDelete` failed silently at terminal phase | Manual: `CronDelete <id>` from `jq -r .cron_id .operator-state.MY-W1.json` |
| Init aborts: "Empty wave → fail init" | Packet parser found 0 blocks in README | README missing `id:` lines or wrong markdown structure — see SKILL.md § Lifecycle |

> Honest limits: a dry-run can't catch a worker subagent that fabricates a commit SHA — only `git log --grep` after the fact confirms. Always verify worker output against real git state when a wave finishes suspiciously fast.

## What's next

Sibling docs in this dir for depth (read in order as you need them):

- `GENOME.md` — the 7-role tree (operator → architect/worker/critic/CSO/investigator/challenger/strategic), 5-loop feedback model, role-rights matrix.
- `PIPELINE.md` — full tick algorithm (phase table, verdict routing rules, commit-detection regex, health computation formula).
- `ROLES.md` — per-role catalog: trigger conditions, model assignment (Opus/Sonnet/Haiku), prompt templates, JSON verdict schema.

Source-of-truth skill files (authoritative when docs disagree):

- `~/.claude/skills/operator-loop/SKILL.md` — main spec (~870 LOC).
- `~/.claude/skills/system-constitution/SKILL.md` — invariants & role rights.
- `~/.claude/skills/plan-multi-review/SKILL.md` — plan-stage 3+1 critic gate (pre-wave; use before writing the packet README for non-trivial waves).
- `~/.claude/skills/architect/SKILL.md` — single-angle impl-stage architect spec review.
- `~/.claude/skills/operator-orchestrator/SKILL.md` — one-shot variant (no cron; runs the whole wave in one session — use when cron unavailable or wave is short).
- `~/.claude/skills/constitution-patch/SKILL.md` — disciplined procedure for mutating the constitution itself (rare; needs architect approval).
