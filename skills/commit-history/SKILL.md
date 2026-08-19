---
name: commit-history
description: >
  Show recent git history. Filter by path/author. Use when: "recent commits",
  "what changed", "last week's diff".
argument-hint: "[N | path | --author=name | --since=date]"
user-invocable: true
---

The user wants recent commit history. Args: $ARGUMENTS

Run `git log` with the user's filters (default: last 20 commits, current branch). Parse the args:
- bare numeric N → `-n <N>`
- path → append `-- <path>` to limit to that path
- `--author=...` → pass through
- `--since=...` / `--until=...` → pass through
- `--grep=...` → pass through

Use a separator-friendly format:
```bash
git log --pretty=format:'%h%x09%an%x09%ad%x09%s' --date=short -n 20
```

For each commit show: short SHA, author, date, subject. If the user asks for more detail on a commit (e.g. "show me <sha>"), run `git show --stat <sha>`.

> Nothing in this setup links a commit to the agent session that produced it — no commit-linking concept exists in tdai-memory either.

If the user asks to cross-reference with agent sessions:
1. Call `mcp__tdai-memory__recall` with the commit SHA, or with a query built from its subject or author.
2. Surface only what actually comes back, with a one-line summary each.

Do not fabricate associations — only surface memories that genuinely mention the commit SHA or a keyword from its message. An empty result is the expected case; say so rather than reaching for a plausible session.
