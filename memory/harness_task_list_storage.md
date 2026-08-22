---
name: harness_task_list_storage
description: Список задач сессии лежит в ~/.claude/tasks/session-<id>/<n>.json — привязан к сессии, не к проекту
metadata:
  type: reference
---

Тулы задач (`TaskCreate`/`TaskUpdate`/`TaskList`) пишут в `~/.claude/tasks/session-<id>/<n>.json`,
где `<id>` — идентификатор сессии. Проверяется `ls -d ~/.claude/tasks/session-*`.

Следствия, ради которых это стоит помнить:
- список задач **привязан к сессии, а не к проекту**: новая сессия стартует с пустым списком,
  даже если работа продолжается та же;
- каталог `~/.claude/tasks/` закрыт `.gitignore` (`/*`) — списки задач не версионируются и
  страховки коммитом не имеют;
- там же лежат кристаллы таск-цикла (`tasks/--<sanitized-cwd>--/<дата>/`), и по той же причине
  они тоже вне гита.

Связано: [[commit_after_task_not_per_phase]].
