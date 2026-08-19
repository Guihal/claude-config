#!/usr/bin/env node
// SessionStart hook — тела правил с send_on_start: true, один раз на старте сессии.
// stdin не читаем: набор стартовых правил не зависит от payload, а чтение fd 0
// без данных — лишняя точка отказа.
import { emitHook } from "/home/penis/.claude/hooks/_ir-helper.mjs";
import { startupRules } from "/home/penis/.claude/mcp/injection-rules/core.mjs";

// Лимита нет намеренно: на старте агент должен увидеть свод правил ЦЕЛИКОМ.
// CHAR_BUDGET режет пер-тиковую доставку, к стартовому своду он не относится.
emitHook(
  "SessionStart",
  startupRules()
    .map((r) => r.body)
    .join("\n\n"),
  Infinity,
);
