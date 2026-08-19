---
name: commit-context
description: >
  Trace file/line to commit via git blame. Use when: "why is this code here",
  "what was the agent doing when this changed".
argument-hint: "[file, function, or line]"
user-invocable: true
---

The user wants commit context for: $ARGUMENTS

Run `git blame` (or `git log -L`) on the target file, function, or line in $ARGUMENTS to extract the most recent commit SHA that touched it. Use `git blame -L <start>,<end> <file>` when a line range is given, `git log -L :<function>:<file>` when a function name is given, and `git log -n 1 -- <file>` when only a path is given.

> This skill is pure-git: nothing in this setup links a commit to the agent session that produced it. If a session left a trace at all, it is in tdai-memory — try `mcp__tdai-memory__recall` with the SHA or the commit subject — but treat a miss as normal, not as a failed lookup.

Present the result as:
- The commit SHA, short SHA, branch, author, message (`git show --stat <sha>` for full detail)
- The file's content at that commit if useful (`git show <sha>:<path>`)
- A short list of any obsidian-memory-mcp session entities that mention this commit SHA — to find them, call `mcp_search_nodes` with `query: "<sha-short>"` and filter results where the `commit: <sha>` observation matches

Do not fabricate intent. If the commit has no associated session entity, say so plainly and surface only what `git show` reveals.
