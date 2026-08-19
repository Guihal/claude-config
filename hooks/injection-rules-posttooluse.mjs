#!/usr/bin/env node
// PostToolUse hook — tick caденцию на каждый тул-колл, не только на сообщение юзера.
//
// UserPromptSubmit тикал раз за юзер-сообщение: между сообщениями агент делал по 20-40
// тул-коллов, ни разу не увидев обновлённый свод правил, и после компакта их не было
// вообще, пока не придёт следующее сообщение юзера. PostToolUse стреляет на каждый тул-колл,
// у главной сессии и у сабагента (свой session_id, свой стейт-файл, своя каденция —
// engine различает их уже сегодня через statePath).
// Роль/agent_type здесь недоступны (SubagentStart, не этот хук), поэтому набор правил тот
// же общий wildcard-apply, что и на UserPromptSubmit — сужение по роли осталось разовой
// доставкой при спавне.
import {
  readStdinJson,
  emitHook,
} from "/home/penis/.claude/hooks/_ir-helper.mjs";
import {
  CHAR_BUDGET,
  evaluate,
} from "/home/penis/.claude/mcp/injection-rules/core.mjs";

const p = readStdinJson();
const text = `${p.tool_name ?? ""} ${JSON.stringify(p.tool_input ?? {}).slice(0, 500)}`;
const r = evaluate({
  sessionId: p.session_id,
  source: "tool",
  text,
  tick: true,
});
emitHook(
  "PostToolUse",
  (r.applies || []).map((a) => a.body).join("\n\n"),
  CHAR_BUDGET,
);
