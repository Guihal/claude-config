#!/usr/bin/env node
// tdai-memory-stop.mjs — Stop hook. Non-blocking: spawns detached child for capture, parent exits immediately.
import { readFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { defaultInstances, flattenAssistantContent } from "/home/penis/.claude/mcp/tdai-memory/core.mjs";
import { readStdinJson, sessionKey, projectId } from "/home/penis/.claude/hooks/_tdai-helper.mjs";

const p = readStdinJson();
const sk = sessionKey(p);

// Read last 50 lines of transcript, reverse scan for last assistant + last user
let lastAssistant = "", lastUser = "";
try {
  const lines = readFileSync(p.transcript_path, "utf8").split("\n");
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (!lastAssistant && obj.message?.role === "assistant") {
        lastAssistant = flattenAssistantContent(obj.message.content);
      }
      if (!lastUser && obj.message?.role === "user") {
        lastUser = typeof obj.message.content === "string"
          ? obj.message.content
          : (obj.message.content || []).map((b) => b?.text || "").join("\n");
      }
      if (lastAssistant && lastUser) break;
    } catch { /* skip unparseable line */ }
  }
} catch (e) {
  process.stderr.write(`[tdai-memory] transcript read failed: ${e instanceof Error ? e.message : e}\n`);
}

// Skip spawn if no assistant content (only tool_use/thinking responses)
if (!lastAssistant) {
  process.exit(0);
}

const payload = JSON.stringify({ sessionKey: sk, projectId: projectId(p), userContent: lastUser, assistantContent: lastAssistant });
// Payload goes over stdin, not argv: Linux caps a single argv entry at
// MAX_ARG_STRLEN (128 KiB), and a long assistant turn blows past it — spawn then
// dies with E2BIG and the whole capture is lost.
const childScript = `
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const args = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const core = await import("/home/penis/.claude/mcp/tdai-memory/core.mjs");
  await core.defaultInstances.capture(args);
  process.exit(0);
`;

const logFd = openSync("/home/penis/.claude/mcp/tdai-memory/logs/tdai-capture.log", "a");
const child = spawn("/home/penis/.bun/bin/bun", ["-e", childScript], { detached: true, stdio: ["pipe", logFd, logFd] });
// Без этих листенеров любая ошибка спавна (нет bun → ENOENT) или обрыв пайпа
// (ребёнок умер, не дочитав → EPIPE) прилетает как unhandled 'error' и роняет
// Stop-хук целиком. Память — вещь необязательная: не записалось, значит не записалось.
child.on("error", () => {});
child.stdin.on("error", () => {});
child.stdin.end(payload);
child.unref();
// Parent exits immediately; child captures async.
