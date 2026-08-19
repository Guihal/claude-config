#!/usr/bin/env node
// UserPromptSubmit hook — push user text, tick, return applies
import {
  readStdinJson,
  emitHook,
} from "/home/penis/.claude/hooks/_ir-helper.mjs";
import {
  CHAR_BUDGET,
  evaluate,
} from "/home/penis/.claude/mcp/injection-rules/core.mjs";
const p = readStdinJson();
const r = evaluate({
  sessionId: p.session_id,
  source: "user",
  text: p.prompt,
  tick: true,
});
// Все applies, не только первое. evaluate уже упаковал их под CHAR_BUDGET
// (core.mjs:270-277), так что бюджет не превысить. Брать applies[0] означало
// ронять всё, что совпало на том же ходу: шесть правил (пять code-* на каденции
// 10 и why-rule на 5) проигрывали соседям по алфавиту и не долетали НИ РАЗУ.
// Лимит доставки = лимит отбора: с дефолтом emitHook (2000) join уезжал за край и
// нудж task-list молча обрезался на 40 ходах из 200 (repro: scratchpad/repro-trunc.mjs).
emitHook(
  "UserPromptSubmit",
  (r.applies || []).map((a) => a.body).join("\n\n"),
  CHAR_BUDGET,
);
