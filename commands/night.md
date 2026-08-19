---
description: "Night Autopilot: cheap-model autonomous build loop while user sleeps."
argument-hint: "[prod ok|deploy ok] <goal / spec / project request>"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, Skill, WebSearch, WebFetch
---

Running **Night Autopilot**.

User goal: `$ARGUMENTS`

User wants cheap/dumb model work autonomously while sleeping → wake to finished project. Optimize working deliverable + momentum. Availability outages ok. NOT ok: data loss, secrets leak, irreversible prod damage, payments, mass outbound msgs.

## Risk Contract

Allowed no questions:
- Edit repo files.
- Run project-local checks/tests/builds/dev servers/migrations vs local/test DBs.
- Install deps only when needed; record what changed + why.
- Break local/dev/staging while iterating.
- If blocked → leave project partially working + well-reported.

Allowed only if `$ARGUMENTS` contains `prod ok`, `production ok`, `deploy ok`, `деплой ок`, or `прод ок`:
- Push to remote.
- SSH/rsync/deploy to production.
- Restart prod services.

Never allowed:
- `docker compose down -v`, volume deletion, prod DB destructive migration.
- `rsync --delete` to prod.
- `git reset --hard`, `git clean -fdx`, force-push.
- Reading `.env`, SSH keys, OAuth/browser auth state, cloud creds, prod DB dumps.
- Payments, SMS/email blasts, surprise 3rd-party actions.

## Work Loop

1. Read `AGENTS.md`, `CLAUDE.md`, package scripts, current task/spec.
2. Create short checklist + acceptance checks. Keep visible in conversation.
3. Quick env check: `git status --porcelain`, identify package manager, list scripts.
4. Dirty worktree → don't overwrite unknown changes. Integrate or work around.
5. Implement small vertical slices. Prefer boring existing patterns.
6. After each slice → run cheapest relevant verifier.
7. Same failure ×3 → stop, try different approach. Still blocked → write decision packet.
8. Before final → run best available full check fitting project.

## Done Output

Finish with:
- What changed.
- Files touched.
- Commands/checks run + pass/fail result.
- Known broken/untested parts.
- Rollback notes.
- If deploy allowed: deploy result, health check, rollback command.