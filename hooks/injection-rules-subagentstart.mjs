#!/usr/bin/env node
// SubagentStart hook — тела правил с send_on_subagent: true, один раз при спавне субагента.
//
// Роль решает состав набора через apply: список имён здесь НЕ хранится, иначе он разъехался бы
// с каталогом ровно так же, как разъехались core.mjs и собранный daemon.js.
// Спавн не блокируется ничем: нет payload или нет agent_type → пустой stdout, строка в stderr,
// нулевой код возврата.
import {
  readStdinJson,
  emitHook,
} from "/home/penis/.claude/hooks/_ir-helper.mjs";
import {
  subagentRules,
  pickVariant,
  SUBAGENT_CHAR_BUDGET,
} from "/home/penis/.claude/mcp/injection-rules/core.mjs";

let payload;
try {
  payload = readStdinJson();
} catch (err) {
  process.stderr.write(
    `[injection-rules] SubagentStart: payload не прочитан (${err.message}), правила не отправлены\n`,
  );
  process.exit(0);
}

const agentType = payload?.agent_type;
if (typeof agentType !== "string" || agentType === "") {
  process.stderr.write(
    "[injection-rules] SubagentStart: в payload нет agent_type, правила не отправлены\n",
  );
  process.exit(0);
}

emitHook(
  "SubagentStart",
  subagentRules(agentType)
    .map((r) => pickVariant(r.bodies).text)
    .join("\n\n"),
  SUBAGENT_CHAR_BUDGET,
);
