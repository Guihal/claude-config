---
name: pgrep_self_match_hangs_waiter
description: pgrep -f по строке промпта находит саму команду ожидания — цикл висит вечно, роль давно завершилась
metadata:
  type: reference
---

`until ! pgrep -f <строка>; do sleep …; done` зависает навсегда, если `<строка>` встречается в
командной строке самого ожидающего процесса. Так и было 2026-08-22: `pgrep -f planner-5.md` ловил
не роль, а обёртку `zsh -c … until ! pgrep -f planner-5.md …`. Роль отработала за минуты, ожидание
висело полтора часа, следующий шаг цикла не стартовал.

**Как ждать роль правильно:**
- по PID, который печатает `harness-agent` при спавне: `until ! kill -0 <pid> 2>/dev/null; do
  sleep 10; done`;
- либо по появлению артефакта: `until [ -s <verdict-file> ]; do sleep 10; done`;
- признак живости роли — свежий mtime лога и артефакт, а не факт наличия процесса в `ps`
  (сравни `stat -c %y <log>` с `date`). Связано: [[listagents_lies_about_live_agents]].
