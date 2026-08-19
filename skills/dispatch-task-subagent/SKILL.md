---
name: dispatch-task-subagent
description: >
  Dispatch work subagent with GUARANTEED /task + caveman + critic-review discipline.
  Use when delegating PR-sized coding task to subagent via Agent tool, especially
  when spawning waves of parallel subagents for refactor/feature work with
  pre-written plan files (e.g. docs/tasks/**/*.md). Skill enforces parent-side
  critic review after work-subagent returns — compensates for nested-Agent-spawn
  limitation that causes subagents to silently skip RLM cycle inside /task
  (measured: 8/14 skipped /task entirely, 6/14 invoked but 0/14 ever spawned
  critic subagent).
  Triggers: "spawn subagent", "dispatch subagent", "delegate PR",
  "запусти субагента", "запусти волну", "parallel agents for PRs", "run wave",
  "executing plan via subagent".
  Skip for: research/exploration (use general-purpose directly), single-file
  tweaks, quick bash ops, tasks without pre-written plan file.
---

# Dispatching a task-disciplined subagent

## Why this skill exists

Observed chapter 16 refactor subbrain (2026-04-24): 14 subagent dispatches,
each prompted to invoke `caveman` + `subbrain-guardrails` +
`/task --depth=standard <desc>`. JSONL transcript audit:

- `caveman` + `guardrails` invoked **14/14** — work.
- `/task` invoked **6/14** — 8 silently skipped 3rd step.
- Of 6 that ran `/task`, **0** ever spawned critic subagent (`Agent` tool
  called zero times inside any subagent, despite /task requiring it on every
  RLM iteration).

Root cause: the model self-censors. The harness does not block it — 2.1.226 caps
nesting at `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3, main = 0), so a
critic spawned from a subagent sits at depth 2 and is allowed. What actually
stops it is the `Agent` tool's own prompt ("do not spawn agents unless the user
asks"), which subagents obey over the skill. Either way — **critic-review
discipline baked into `/task` doesn't materialize when `/task` runs
inside subagent.**

Skill moves critic review to **parent** side, where `Agent` spawning
works reliably. Work still done by subagent; review by parent.

## Protocol overview

```
Parent
  │
  ├─ 1. Pre-flight: plan file ready, scope locked
  │
  ├─ 2. Dispatch work-subagent via Agent tool
  │    (prompt includes caveman + guardrails + /task invocation)
  │    └─ subagent reads plan, implements, tests, commits → returns OK <sha>
  │
  ├─ 3. Verification gate (parent runs `git log -1`, `git show --stat`)
  │    └─ catches forgot-to-commit, wrong-branch, empty-diff cases
  │
  ├─ 4. Parent-side critic review (GUARANTEE step)
  │    └─ spawn Agent(subagent_type="critic", prompt=diff+acceptance)
  │       │
  │       ├─ ok:true → proceed to merge
  │       └─ ok:false (medium+) → dispatch fix-subagent, loop max 2 rounds
  │
  └─ 5. Merge to main (`git merge --no-ff -X theirs` for doc conflicts,
       abort + manual reconcile for code conflicts)
```

## Step 1 — Pre-flight

Verify before dispatch:

- **Plan file exists** at e.g. `docs/tasks/refactor/NN-foo.md` (or equivalent repo
  convention). Required sections: **Цель** (goal), **Файлы** (scope), **Изменение**
  (what changes), **Тесты** (test scenarios), **Приёмка** (acceptance checklist).
- **Acceptance criteria machine-checkable** — commands like `bunx tsc --noEmit`,
  `bun test <file>`, `grep -n 'pattern'`. Vague acceptance ("code looks good") kills
  critic step.
- **Scope list concrete** — file paths, not module names. Critic uses to
  detect scope creep.

Anything missing → don't dispatch. Fix plan first.

## Step 2 — Dispatch

Use `Agent` tool with:

- `subagent_type: "general-purpose"` (skill-specialized types usually lack
  broad tool access needed for implement+test+commit).
- `isolation: "worktree"` unless doc-only change (worktree isolation
  prevents concurrent edits on shared workdir paths, gives clean diff on
  dedicated branch).
- `run_in_background: true` for wave parallelism (2-3 agents parallel = sweet
  spot; more overloads machine without speedup).
- `description`: short, 3-5 words ("PR 20 abort propagation").

### Prompt template

Fill placeholders. Keep terse — subagent reads once.

```
You are a subagent executing **<PR label>** in <repo name>.

REPO: git worktree, main head ≈ `<short sha>`.
PLAN FILE: `<path to plan file>` — READ THIS FIRST, full spec.
Conventions: `CLAUDE.md` at repo root.

PREREQS ON MAIN: <list merged PRs this depends on, with commits>

MANDATORY WORKFLOW (do not skip any step)
1. Invoke `Skill caveman` — terse output for the rest of the session.
2. Invoke `Skill <repo-guardrails skill>` if the repo has one (e.g.
   `subbrain-guardrails`). Otherwise skip.
3. Invoke `Skill task` with arg:
     `--depth=<trivial|standard|complex> <one-sentence task summary>`
   If `task` is not recognized as a file — it is a registered harness skill name.
   Invoke it anyway and trust the directive.
4. After the task skill's implementation phase returns, run verification commands
   listed in plan §Приёмка. All MUST pass. Baseline `bun test` count must not
   regress.
5. Commit: `git add -A && git commit -m "<conventional commit subject ≤50 chars>"`
   with body + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
   trailer. Verify with `git log -1 --name-only` before returning.
6. Return EXACTLY two lines, nothing after:
     Line 1: `OK <7-char-sha> <subject>` on success, `FAIL: <short reason>` on any
             verification failure.
     Line 2: `FILES: <comma-separated basenames of changed files>`

HARD CONSTRAINTS
- Scope lock: only modify files listed in plan §Файлы.
- No `git push`, no `gh`, no CI-triggered paths (assume GitHub automation is unavailable).
- Respect repo guardrails (file-size caps, Promise.allSettled, logger contract, etc).
- If `/task` silently doesn't produce output — proceed with plan-only discipline
  (read plan, implement, verify, commit). Do NOT mark FAIL just because /task
  behavior was incomplete. Only FAIL if verification commands fail.
```

## Step 3 — Verification gate (catches subagent mistakes before critic)

After subagent returns, BEFORE invoking critic:

```bash
cd <worktree path>
git log -1 --name-only          # confirm commit exists
git log main..<branch> --oneline # confirm branch is ahead of main
git show --stat <sha>            # diff size sanity check
```

Catches (observed failure modes):

- **Forgot to commit**: `git log -1` shows old HEAD. Happened PR 26a (chapter 16).
  Fix: `git add -A && git commit -m "..."` manually as parent, with note-to-self.
- **Committed to unexpected branch**: subagent created own branch name instead
  of using worktree default. Happened PR 22b (chapter 16, branch
  `pr-22b-memory-approval`). Fix: `git branch --contains <sha>` to find, merge
  that instead.
- **Empty diff / wrong files**: subagent touched unexpected paths. Abort, don't
  merge.

## Step 4 — Parent-side critic review (the GUARANTEE)

Step that makes `/task` discipline materialize. **Single Opus pass, heavy input, thin output.** Asymmetric cost exploit: Opus input ≈ $15/M, output ≈ $75/M (5× input). Pack context densely — critic sees all (diff + full touched files + tsc + tests + guardrails + full plan + scope-check); compress output via structured schema. Fix-rounds after this usually 0-1 thanks to fix-hint precision.

### 4.1 Pre-critic inputs (parent collects before Agent call)

```bash
cd <worktree path>
BASE_SHA=$(git merge-base main HEAD)

DIFF=$(git show --unified=5 "$BASE_SHA..HEAD")        # full diff, no truncation

POST_FILES=$(
  git diff --name-only "$BASE_SHA..HEAD" | \
  grep -E '\.(ts|tsx|vue|py|sh|md|sql|json)$' | \
  while read f; do
    [ -f "$f" ] || continue                            # file deleted → skip
    [ "$(wc -c <"$f")" -gt 50000 ] && continue         # >50k chars → skip, diff покрывает
    printf '\n===== %s =====\n' "$f"
    cat "$f"
  done
)
# Soft cap: total POST_FILES ≤ 200k chars; если больше — truncate по порядку.

TSC_OUT=$(bunx tsc --noEmit 2>&1 | head -80)           # empty/short если clean
TEST_OUT=$(bun test 2>&1 | tail -40)                   # pass/fail summary

# Scope-creep pre-check (детерминированный — критику подаётся как факт)
PLAN_SCOPE=$(awk '/^##+ *Файлы/,/^##+ /' <plan_file> | \
             grep -oE '`[^`]+\.(ts|tsx|vue|py|sh|md|sql|json)`' | tr -d '`' | sort -u)
CHANGED=$(git diff --name-only "$BASE_SHA..HEAD" | sort -u)
SCOPE_CREEP=$(comm -23 <(printf '%s\n' "$CHANGED") <(printf '%s\n' "$PLAN_SCOPE"))

GUARDRAILS=$(cat <repo-guardrails skill path OR skip if none>)
```

Caps:
- Each POST_FILE ≤ 50k chars (diff suffices for big files).
- Total POST_FILES ≤ 200k chars (truncate at end, log truncation).
- TSC_OUT ≤ 80 lines, TEST_OUT ≤ 40 lines (`tail`).
- SCOPE_CREEP list — no cap (usually 0-5 lines).

### 4.2 Critic call

```
Agent(
  subagent_type: "critic",
  name: "critic-<PR label>-r<round>",
  description: "Post-impl review: <PR label>",
  prompt: `
TASK: <one-sentence original task summary>
PHASE: implementation
PR_LABEL: <label>
VERDICT_FILE: <abs path, unique per round — e.g. ~/.claude/verdicts/<PR label>/impl-critic-r<round>.json>

PLAN_FILE (full):
<paste plan file verbatim — не только §Приёмка>

DIFF:
<paste $DIFF>

POST_FILES (full content of touched files, post-change):
<paste $POST_FILES OR "none under cap">

TSC_OUT:
<paste $TSC_OUT OR "clean">

TEST_OUT:
<paste $TEST_OUT>

SCOPE_CHECK (files changed but NOT listed in plan §Файлы — parent pre-computed):
<paste $SCOPE_CREEP OR "none">

GUARDRAILS (verbatim, if repo has them):
<paste $GUARDRAILS OR omit section>

AUDIT (что искать):
- Guardrails violations: file-cap 250, Promise.allSettled, logger.info arity,
  FTS sanitize, db.transaction, http-client wrapper, validation boundaries,
  single-source registries (model-map, MCP tools), sandbox guards.
- Plan §Приёмка: каждый checkbox → evidence в diff/post-files/test-out OR mark
  missing. Acceptance item без evidence = medium minimum.
- Scope: $SCOPE_CREEP non-empty → flag каждый файл; severity по классу
  (core code → high, doc/plan → medium, generated/lock → low=drop).
- Edge cases: error paths, concurrent access, null/empty inputs, missing
  tests for named scenarios из §Тесты.
- TSC/tests: TSC_OUT non-clean → critical (compile break). TEST_OUT regression
  vs baseline → high.
- Logic: incomplete rename (старые ссылки), dead code after refactor, missed
  imports, N+1 queries.

<CRITIC_OUTPUT_CONTRACT>
  `
)
```

Where `<CRITIC_OUTPUT_CONTRACT>` (local to this skill — the `critic` agent's own contract is an MD verdict, so this JSON shape must be passed explicitly in the prompt and overrides it for this call):

```
OUTPUT_CONTRACT:
- Write ONE JSON object to VERDICT_FILE, then one final line `<<<VERDICT-END>>>`.
  This file is the delivery — the parent reads it, not your reply (Claude Code
  bug #75043: subagent final messages often never arrive). Reply with the same
  JSON afterwards as a courtesy copy. Write the file once, only when done.
- Return ONE JSON object. No prose before/after. No markdown fences.
- Shape: {"ok": bool, "feedback": string, "phase": "implementation"}.
- feedback = compressed issue list. Одна строка на issue. Формат:
    [sev]rule @loc → fix
  sev ∈ {medium,high,critical}; rule ≤ 40 char tag (kebab-case, e.g.
  `file-cap-250`, `logger-arity`, `promise-allsettled`, `scope-creep`,
  `accept-miss`, `tsc-break`, `test-regress`); loc = file:line | acceptance-item
  | "—"; fix — imperative ≤ 120 char.
- Drop low/nit issues полностью (не эмитить).
- Max 8 строк в feedback. Больше — top-8 by severity (critical > high > medium).
- Max 1000 output tokens total. Над бюджетом — truncate gracefully, сохранив
  валидный JSON.
- Нет medium+ → feedback = "" (empty), ok = true.
- Be maximally terse: конкретный imperative, без hedging, без «почему»
  (причина кодируется rule-тегом).
```

### 4.3 Parse + retry

**Read the verdict from `VERDICT_FILE`, never from the critic's reply** — the reply frequently never arrives (#75043). `mkdir -p` the directory before dispatch, then wait for the sentinel (portable, works from fish and bash, cap ~5 min):

```
sh -c 'i=0; while [ $i -lt 150 ]; do tail -n1 "$1" 2>/dev/null | grep -q "VERDICT-END" && break; sleep 2; i=$((i+1)); done; cat "$1"' _ <VERDICT_FILE>
```

No sentinel after the wait → `SendMessage` the critic by its `name`: `write your verdict JSON to <VERDICT_FILE> now, ending with <<<VERDICT-END>>>`, wait once more, and only then treat it as a parse failure. A critic that "finished" without a file is not a passed gate.

Parse the file contents: find first `{`, last `}`, JSON.parse substring. On parse fail, retry once (via `SendMessage` to the same `name`) with:

```
RETRY: Previous verdict not parseable JSON. Overwrite VERDICT_FILE with exactly one JSON object, last line <<<VERDICT-END>>>.
Shape: {"ok":bool, "feedback":string, "phase":"implementation"}
feedback формат: compressed [sev]rule @loc → fix, one per line, max 8, max 1000 output tokens. Нет medium+ → feedback="", ok=true.
```

Retry fail → treat as `ok:false, feedback:"[critical]parse-bug @— → re-check manually"`.

### Decision

- `ok:true` → proceed to step 5 (merge).
- `ok:false` + round ≤ 2 → dispatch **fix-subagent** with mechanically-built prompt
  from structured feedback (parent parses `[sev]rule @loc → fix` items,
  no re-asking critic):
  ```
  Previous implementation was reviewed. Critic flagged these medium+ issues:

  <for each line in feedback:>
  - [<sev>] <rule> at <loc>: <fix>

  Job: address every item above. Preserve passing tests. Scope-creep items —
  revert or move to a follow-up PR, don't expand scope here. Commit as
  follow-up on same worktree branch. Return OK <sha> on success.
  ```
  Then loop back to step 3 (verify) → step 4 (re-critic).
- Round > 2 and still `ok:false` → **escalate to human**, don't merge. Leave
  worktree intact, surface open feedback items.

## Step 5 — Merge to main

After critic `ok:true`:

```bash
cd <parent repo root>
git merge --no-ff -X theirs -m "merge(<PR label>): <chapter/wave>" <branch>
```

`-X theirs` safe for **doc** conflicts (plan files, audit entries — subagent's
version wins because they marked Status DONE). **Not safe for code** conflicts.

If merge touches .ts/.vue files after conflict resolution → immediately run
`bunx tsc --noEmit`. On fail → `git reset --hard HEAD~1`, diagnose manually.

After merge:

1. `git worktree remove -f -f .claude/worktrees/<agent-dir>` (may need `-f -f` if
   subagent didn't release cleanly).
2. `git branch -D <branch>` (and any side-branches subagent created).
3. Mark `Status: DONE (PR N)` in plan file.
4. Strike audit entry in `docs/02-audit.md` (or equivalent).

## Wave discipline

When running multiple subagents in parallel:

- **Max 3 parallel.** More overloads machine without speedup, raises merge
  conflict surface.
- **Wave barrier.** Before starting wave N+1, complete all wave N (including
  critic review and merge). Don't interleave.
- **Dep graph respect.** PR B depends on PR A → don't dispatch B until A
  lands on main.
- **Stash parent's untracked plan files BEFORE dispatching wave** that might
  touch those plan files. Observed chapter 16: parent had untracked
  plan docs; subagent workdirs shared main's filesystem; subagents edited
  untracked files as side effect, which `-X theirs` merges later corrupted.
  Prevent: `git add -A && git commit -m "plan skeleton"` before wave 1.

## Red flags (stop + diagnose)

| Signal | Likely cause | Action |
|---|---|---|
| Subagent returns `OK <sha>` but `git log -1` shows old HEAD in worktree | Forgot to commit | Commit manually, proceed |
| Same commit sha returned by multiple subagents | Subagents wrote to main workdir, not worktree | Abort wave, fix isolation config |
| Critic returns `ok:false` round 1, round 2, round 3 | Subagent fundamentally misread plan | Escalate, don't loop indefinitely |
| 10+ new test failures after merge | Merge strategy ate someone's changes | `git reset --hard HEAD~1`, redo merge manually |
| `git merge` says "Уже актуально" / "Already up to date" but expected diff | Subagent branch at old commit; actual work on another ref | `git for-each-ref --contains <sha>`, merge correct branch |

## Cost model (heavy-input / thin-output critic — F variant)

Per PR dispatched:

- 1× work-subagent (Opus, typically 80-180k tokens via `/task` + caveman + impl).
- 1× parent-side critic (Opus, asymmetric package):
  - **Input**: full diff + post-files (≤200k) + plan + guardrails + tsc/tests + scope-check ≈ **40-150k input tokens**. Cost ≈ $15/M → $0.6-2.25 raw.
  - **Output**: compressed JSON, cap 1000 tokens (usually 50-400 on clean-to-mid PR). Cost ≈ $75/M → $0.004-0.03. Pennies.
  - **Total per call**: ~$0.6-2.3 без кэша.
- 0-2× fix-subagent rounds — usually **0-1** thanks to `[sev]rule @loc → fix` hint precision (parent builds fix-prompt mechanically, no return to critic).

Rough budget:
- **Single isolated PR**: ~220-280k tokens / ≈ $3.5-4.5/PR (critic fat-input dominates output savings — but fix-rounds shrink, net vs legacy close or lower).
- **Wave=3 with prompt-caching** (if harness passes `cache_control` через `Agent` tool — verify `usage.cache_read_input_tokens` in response): common prefix (guardrails + CLAUDE.md + chapter brief) ≈ 15-20k read from cache ~90% discount → **~$1.5-2.5/PR** amortized.

Prompt cache prereqs — pre-build identical prefix `[CLAUDE.md + guardrails + chapter_brief]`, insert `cache_control: {"type":"ephemeral"}` breakpoint AFTER it, BEFORE per-PR part. TTL 5 min — wave runs tight, fix-round inside window.

If quota tight: drop fix rounds (structured feedback still surfaces в daily-note via critic's merged_feedback, fixes land follow-up PR), keep work-subagent + one critic pass.

## Prior art

- `superpowers:subagent-driven-development` covers similar territory but assumes
  subagent's `/task` cycle fires correctly. This skill layers on top,
  compensating for that assumption's failure.
- `task` skill (RLM cycle) designed for direct invocation, not nested.
- Chapter 16 of subbrain refactor (2026-04-24) is evidence base — see
  `~/.claude/projects/-usr-projects-subbrain/memory/chapter16_continuation.md`.
