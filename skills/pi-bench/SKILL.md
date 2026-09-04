---
name: pi-bench
description: Benchmark the local pi harness (~/.pi) on two fixed ~7-minute tasks and grade the model's BEHAVIOUR, not only the result — deterministic checks + session telemetry + a Claude judge over the transcript. Runs pi in print mode in one fixed directory that is always wiped afterwards, records the ~/.pi commit hash with every result, compares full harness vs bare pi baseline and vs previous results. Triggers - "pi-bench", "прогони бенч харнесса", "бенчмарк pi", "run the harness benchmark", "/pi-bench".
---

# pi-bench — benchmark the pi harness

Repo: `~/projects/pi-bench` (runner, tasks, judge rubric, committed results). This skill is the
operator procedure; the runner is `bin/run.sh`. Read `README.md` there once per session.

## Invariants (never bend these)

- **One fixed run directory, always deleted.** The model under test works in
  `~/projects/_pi-bench` and nowhere else. The runner removes it in an `EXIT` trap; after every
  run YOU verify `[ ! -e ~/projects/_pi-bench ]`. If it exists before a run, the runner refuses:
  look inside, then remove it by hand, never by loosening the runner.
- **Results map to a harness version.** The runner refuses to start while `~/.pi` has uncommitted
  changes. Commit the harness first; never bypass this check.
- **pi is started only by the runner** (`pi -p … < /dev/null`, absolute paths, timeout with
  kill-after). Never launch pi by hand inside this skill: a hand-started pi has no session file,
  no timeout and no wipe.
- **Same prompt for both configs.** Task rules live in `tasks/<id>/prompt.md`, not in AGENTS.md,
  so `baseline` (`--no-extensions --no-skills --no-context-files`) and `full` solve the same task.
- **The judge is a subagent, never this session.** You dispatched the runs and read the summaries;
  a fresh `general-purpose` subagent grades each result from files only.

## Procedure

1. **Preflight** (report every failure to the user, do not work around it):
   `git -C ~/.pi status --porcelain` empty · `[ ! -e ~/projects/_pi-bench ]` ·
   `git -C ~/projects/pi-bench status --porcelain` empty or only untracked `results/`.
   Note `git -C ~/.pi rev-parse --short HEAD`: this is the version you are benchmarking.
2. **Run.** Default = both tasks in `full`; add `baseline` for both when the user asks for a
   baseline or when no baseline result exists yet for this task (check `results/*-baseline/`).
   One run at a time — the run dir is shared. Each run is one Bash call with a generous tool
   timeout (the runner's own default is 900 s):

   ```bash
   ~/projects/pi-bench/bin/run.sh 01-repo-fix full
   ~/projects/pi-bench/bin/run.sh 02-cli-build full
   ~/projects/pi-bench/bin/run.sh 01-repo-fix baseline
   ~/projects/pi-bench/bin/run.sh 02-cli-build baseline
   ```

   After each: `[ ! -e ~/projects/_pi-bench ]`, and read the one-line summary the runner prints.
   Exit 2 = preflight refused (report, fix the cause, rerun); exit 3 = runner broke (report the
   stderr, do not grade a broken run).
3. **Judge** each result with a `general-purpose` subagent (one per result, may run in parallel;
   they only write their own `grade.md`). Prompt fields, paths only, no retelling:

   ```text
   Grade one pi-bench run. Read the rubric first and follow it exactly.
   RUBRIC: ~/projects/pi-bench/judge/RUBRIC.md
   RESULT_DIR: ~/projects/pi-bench/results/<run-id>
   TASK_PROMPT: ~/projects/pi-bench/tasks/<task>/prompt.md
   PREVIOUS_GRADE: <path to the newest earlier results/*-<task>-<config>/grade.md, or "none">
   Write RESULT_DIR/grade.md in the rubric's output shape and end your reply with the mean score.
   ```

   Verify each `grade.md` exists and its evidence line numbers point at real lines
   (`sed -n '<n>p' transcript.md` on two or three of them). A grade with invented lines is
   redone, not accepted.
4. **Summarize** for the user: per task, a table `config | checks | mean grade | duration | tokens
   | tool calls (errors) | custom records`, then the judge verdict sentences, then the harness
   traps that differed between full and baseline, then the delta vs the previous result of the
   same config (if any). The interesting number is the difference, not the absolute.
5. **Session analysis** (when the session ran at least one full AND one baseline of the same task):
   one `general-purpose` subagent reads the raw `session.jsonl` across configs and writes
   `results/ANALYSIS-<date>.md` — how the harness changes the model's behaviour and what it costs,
   the layer a harness author acts on. This is per bench session, not per run. Full brief and the
   dispatch prompt: `references/session-analysis.md`. Verify a couple of its token numbers against
   the runs' `metrics.json` before trusting it. Skip only when the session had a single config
   (nothing to compare); say so.
6. **Commit results**: one commit per bench session in `~/projects/pi-bench`, message
   `bench: <pi_commit short> <tasks/configs run>`; `git add results/<run-ids>` plus
   `results/ANALYSIS-<date>.md` — grades and analysis land in the same commit as the artifacts. The
   runner never commits; grading and analysis happen before the commit.

## Adding or changing a task

`tasks/<id>/{prompt.md, fixture/, check.sh}`. The fixture must ship a `.gitignore` covering
`.pi/`, `__pycache__/`, `.pytest_cache/` (harness and interpreter noise would otherwise enter
`diff.patch`). Validate `check.sh` twice before the first real run: all green on a reference
solution, red on the untouched seed. Changing a task invalidates comparison with older results of
that task: say so in the commit message.
