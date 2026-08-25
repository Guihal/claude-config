#!/usr/bin/env node
// SessionStart hook — тела правил с send_on_start: true, один раз на старте сессии.
// stdin не читаем: набор стартовых правил не зависит от payload, а чтение fd 0
// без данных — лишняя точка отказа.
import { emitHook } from "/home/penis/.claude/hooks/_ir-helper.mjs";
import {
  startupRules,
  pickVariant,
} from "/home/penis/.claude/mcp/injection-rules/core.mjs";

// Лимита нет намеренно: на старте агент должен увидеть свод правил ЦЕЛИКОМ.
// CHAR_BUDGET режет пер-тиковую доставку, к стартовому своду он не относится.
// Вариант тела выбирается явным вызовом: у старта нет истории показов, поэтому lastIndex не
// передаётся — берётся любой из вариантов.
emitHook(
  "SessionStart",
  startupRules()
    .map((r) => pickVariant(r.bodies).text)
    .join("\n\n"),
  Infinity,
);
