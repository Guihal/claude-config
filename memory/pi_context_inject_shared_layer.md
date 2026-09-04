---
name: pi-context-inject-shared-layer
description: "Общий слой инжекта контекста pi живёт в extensions/shared/context-inject/; новый инжектор подключать через него, не копируя механику"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6c0bb65a-c986-4c04-b063-dd7020bb8370
  modified: 2026-09-04T19:25:46.936Z
---

Механика эфемерного инжекта контента в контекст pi (конверт custom-сообщения `{role:"custom",customType,content,display:false,timestamp}` + инвариант «одна свежая копия» strip-prior-by-customType + сброс на session-lifecycle) вынесена в переиспользуемый слой:

- `~/.pi/agent/extensions/shared/context-inject/` — `registerContextSource(pi, {customType, position, channel?, when, build, onSessionStart?, onSessionShutdown?, onError?})`. Словарь каденций `when`: `everyCall | onStart | onCompact | everyNTurns | everyCallWhile(ctx)`. Позиции: `prepend | append | beforeTail` (перед триггером вызова: последний user либо вся группа `assistant(toolCalls)→toolResult…`; `append` делает блок ПОСЛЕДНИМ user-сообщением — после tool result модель отвечает на сам блок). Канал: `message` (custom→user на проводе) | `system` — instruction-ход (`system`/`developer`) через `before_provider_request`, только для `openai-completions`/`openai-responses` по `ctx.model.api`; Anthropic/Google → fallback message (per-call смена system-поля сбросила бы кэш всех сообщений). README рядом.
- `~/.pi/agent/extensions/shared/ext-log.ts` — `createExtLogger(name, logPath)`, формат строки байт-в-байт со старыми копиями `appendLog/logInfo/logWarn`.

Новый инжектор — через слой, не копируя механику; каждый остаётся отдельным экстеншеном (изоляция отказа), слой — библиотека, НЕ мега-экстеншен с реестром (вариант 1 сознательно отвергнут).

**Граница (не втягивать в слой):** движок каденций `injection-rules` (два клока, coprime-раздача, input-transform, before_agent_start) — в слое только его доставка reminder'а; `rich-compaction` — трансформация истории, другой контракт.

**Статус (2026-09-04):** на слое ВСЕ инжекторы контекста — docs-inject, memory-context-inject, project-structure, subagent-snapshot, task-gap (алярм), auditors (вердикт), injection-rules (reminder), control-state (оба уровня); все на `channel: "system"`. Свой `pi.on("context")` ни у кого не остался. injection-rules отдаёт слою только drained reminder, движок каденций остаётся у него. Возможный шаг 2 — сквозной бюджет контекста по всем инжектам.

Связано: [[projects_root]].
