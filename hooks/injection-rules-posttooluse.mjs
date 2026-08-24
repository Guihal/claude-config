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
import { taskGapNudge } from "/home/penis/.claude/hooks/_task-gap.mjs";

const p = readStdinJson();
const text = `${p.tool_name ?? ""} ${JSON.stringify(p.tool_input ?? {}).slice(0, 500)}`;
const r = evaluate({
  sessionId: p.session_id,
  source: "tool",
  text,
  tick: true,
});
// Условный нудж по списку задач наверх блока (проминентность). Молчит при соответствии —
// не константа, а тревога на реальный разрыв; логика в _task-gap.mjs.
// Сам тул из семейства Task* пропускаем: агент в этот момент ведёт список, читать ему нотацию
// про список — ложное срабатывание (напр. миг без in_progress между complete и следующим start).
const bodies = (r.applies || []).map((a) => a.body);
const isTaskTool = /^Task/.test(p.tool_name || "");
const nudge = isTaskTool ? "" : taskGapNudge(p.session_id, "tool");
if (nudge) bodies.unshift(nudge);
emitHook("PostToolUse", bodies.join("\n\n"), CHAR_BUDGET);
