#!/usr/bin/env node
// PostCompact hook — после автокомпакта переинжектит стартовый свод ЦЕЛИКОМ.
// Автокомпакт не поднимает SessionStart (у компакта свои события Pre/PostCompact), поэтому без
// этого хука полный свод правил после компакта не возвращался бы — держались бы только per-turn
// напоминания, а инвариант «весь список после автокомпакта» ломался. Контент — тот же
// startupRules(), что и на старте: единый источник, одинаковое поведение старт == после компакта.
// stdin (summary) намеренно не читаем: набор правил от него не зависит, а чтение fd 0 — лишняя
// точка отказа. Лимита нет намеренно: свод должен вернуться целиком, CHAR_BUDGET режет только
// пер-тиковую доставку.
import { emitHook } from "/home/penis/.claude/hooks/_ir-helper.mjs";
import { startupRules } from "/home/penis/.claude/mcp/injection-rules/core.mjs";

emitHook(
  "PostCompact",
  startupRules()
    .map((r) => r.body)
    .join("\n\n"),
  Infinity,
);
