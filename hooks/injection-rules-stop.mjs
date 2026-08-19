#!/usr/bin/env node
// Stop hook — push assistant text (from transcript_path) into buffer; no additionalContext
import { readFileSync } from "node:fs";
import { readStdinJson } from "/home/penis/.claude/hooks/_ir-helper.mjs";
import { evaluate } from "/home/penis/.claude/mcp/injection-rules/core.mjs";
const p = readStdinJson();
let text = "";
try {
  const content = readFileSync(p.transcript_path, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.message?.role === "assistant" && obj.message?.content) {
        text = typeof obj.message.content === "string" ? obj.message.content : JSON.stringify(obj.message.content);
        break;
      }
    } catch {}
  }
} catch {}
evaluate({ sessionId: p.session_id, source: "assistant", text, tick: false });
process.stdout.write("");
