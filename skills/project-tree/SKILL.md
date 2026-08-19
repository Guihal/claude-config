---
name: project-tree
description: Show directory tree for any path (default cwd), gitignore-aware — ignored entries marked "(ignored)" and not expanded. Use when the user asks about file structure, directory layout, or what files exist in a project. Triggers - "project tree", "/project-tree", "покажи структуру", "дерево проекта".
---

# Project Tree

Run:

```bash
node ~/.claude/hooks/project-structure.mjs [path] [-d depth]
```

- `path` — directory to render, defaults to cwd.
- `-d` / `--depth` — max depth, default 10.

Output: text tree. Directories/files matched by `.gitignore` (root + nested) or hard-ignored (`.git`, `node_modules`, `__pycache__`, `.idea`, `.vscode`) are shown with `(ignored, N items)` suffix and never expanded. Output truncates at ~20k chars ("Truncated." marker) — narrow with `path`/`-d` if hit.

Print the tree to the user as-is in a code block.
