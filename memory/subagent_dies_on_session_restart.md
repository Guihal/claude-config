---
name: subagent-dies-on-session-restart
description: Субагенты Agent-тула умирают вместе с рестартом сессии CC; длинные ревью/гейты запускать отдельным процессом ОС
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0e14652e-19e8-4078-96c9-2934e1352f58
  modified: 2026-08-17T18:27:33.782Z
---

Субагент живёт внутри процесса Claude Code. Рестарт сессии убивает его молча:
`ListAgents` пуст, вердикт не написан, раунд потерян. 2026-08-17 так погибли три
раунда plan-гейта подряд (юзер: «опять умер критик из-за перезапуска сессии»).

**Why:** делегирование через `Agent` — in-process; переживает компакт, но не рестарт.
Чем длиннее работа субагента, тем выше шанс попасть под рестарт.

**How to apply:** ревьюер/воркер с работой на минуты — запускать отвязанным процессом:
`~/harness-lib/bin/harness-review <role> <verdict-file> <prompt-file>` (внутри
`setsid nohup claude -p --agent <role> --model opus`, PPID становится 1, свои SID/PGID).
Результат забирать файлом, а не сообщением агента — файл переживает смерть обеих сторон.
Проверка живости: `pgrep -af 'claude -p --agent'`. Связано с
[[acceptance-needs-independent-checks]] и [[verify-intent-not-execution]].
