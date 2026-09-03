---
name: pi-context-inject-shared-layer
description: "Общий слой инжекта контекста pi живёт в extensions/shared/context-inject/; новый инжектор подключать через него, не копируя механику"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6c0bb65a-c986-4c04-b063-dd7020bb8370
  modified: 2026-09-03T17:07:31.119Z
---

Механика эфемерного инжекта контента в контекст pi (конверт custom-сообщения `{role:"custom",customType,content,display:false,timestamp}` + инвариант «одна свежая копия» strip-prior-by-customType + сброс на session-lifecycle) вынесена в переиспользуемый слой:

- `~/.pi/agent/extensions/shared/context-inject/` — `registerContextSource(pi, {customType, position, when, build, onSessionStart?, onSessionShutdown?, onError?})`. Словарь каденций `when`: `everyCall | onStart | onCompact | everyNTurns`. README рядом.
- `~/.pi/agent/extensions/shared/ext-log.ts` — `createExtLogger(name, logPath)`, формат строки байт-в-байт со старыми копиями `appendLog/logInfo/logWarn`.

Новый инжектор — через слой, не копируя механику; каждый остаётся отдельным экстеншеном (изоляция отказа), слой — библиотека, НЕ мега-экстеншен с реестром (вариант 1 сознательно отвергнут).

**Граница (не втягивать в слой):** `injection-rules` — движок каденций (два клока, coprime-раздача по priority, доставка через input-transform и before_agent_start), не выражается словарём `when`; берёт из хоста максимум логгер. `task-gap` — конверт `role:"user"`, не custom. `rich-compaction`/`auditors` — трансформация истории / доставка вердиктов, другой контракт.

**Статус миграции (2026-09-03):** канарейка `subagent-snapshot-inject.ts` мигрирована. Follow-up (по одному): `docs-inject`, `memory-context-inject`, `project-structure` на слой; логгер прочих на ext-log. Возможный шаг 2 — сквозной бюджет контекста по всем инжектам (тогда оправдан централизованный реестр).

Связано: [[projects_root]].
