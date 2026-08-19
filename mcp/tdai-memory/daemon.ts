#!/usr/bin/env bun
// daemon.ts — stdio MCP server for tdai-memory.
// SDK 1.29.0 pinned (exact, no caret). v1.30+/1.31+ not audited for CC 2.1.220; v2-beta has breaking changes; do not bump without re-verifying handshake.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { defaultInstances, createRecall, createStatus, createCapture, createSessionEnd, createPost, filterContext } from "./core.mjs";

/**
 * Project id = nearest ancestor of cwd containing .git; falls back to $HOME.
 * Not cwd itself: one-shot working dirs (audit runs, temp checkouts) would each
 * become their own scope. Not "" either — an empty project_id makes the writer
 * force scope='global', leaking the record into every project.
 * Keep in sync with ~/.claude/hooks/_tdai-helper.mjs projectId().
 */
function detectProjectId() {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(`${dir}/.git`)) return dir;
    const up = dirname(dir);
    if (up === dir) return homedir();
    dir = up;
  }
}

// cwd never changes for the lifetime of the process.
const PROJECT_ID = detectProjectId();

// --- daemon state (Map per session) ---
const state = new Map();

function newSessionState() {
  return {
    lastRecallLatencyMs: null,
    lastCaptureLatencyMs: null,
    lastRecallAt: null,
    lastCaptureAt: null,
    totalL1: null,
    totalL0: null,
    sessionSnapshotFetched: false,
    degraded: false,
    warned: false,
  };
}

function ensureState(sk) {
  if (!state.has(sk)) state.set(sk, newSessionState());
  return state.get(sk);
}

// --- daemon ops ---
async function recallOp(sk, query) {
  const s = ensureState(sk);
  const t0 = Date.now();
  const r = await defaultInstances.recall({ query, sessionKey: sk, projectId: PROJECT_ID });
  s.lastRecallLatencyMs = Date.now() - t0;
  s.lastRecallAt = Date.now();
  if (!r.ok) {
    s.degraded = true;
    if (!s.warned) {
      s.warned = true;
      process.stderr.write(`[tdai-memory] recall failed: ${r.error}\n`);
    }
    return { ok: false, context: "", memoryCount: 0, latencyMs: r.latencyMs, degraded: true, error: r.error };
  }
  // one-shot /status fetch
  if (!s.sessionSnapshotFetched) {
    s.sessionSnapshotFetched = true;
    const sr = await defaultInstances.status();
    if (sr.ok && sr.totals) {
      s.totalL1 = sr.totals.l1Records;
      s.totalL0 = sr.totals.l0Messages;
      if (sr.totals.stale) s.degraded = true;
    }
  }
  return { ok: true, context: r.context, memoryCount: r.memoryCount, latencyMs: r.latencyMs, degraded: s.degraded };
}

async function captureOp(sk, userContent, assistantContent) {
  const s = ensureState(sk);
  const t0 = Date.now();
  const r = await defaultInstances.capture({ userContent, assistantContent, sessionKey: sk, projectId: PROJECT_ID });
  s.lastCaptureLatencyMs = Date.now() - t0;
  s.lastCaptureAt = Date.now();
  if (!r.ok) {
    s.degraded = true;
    if (!s.warned) {
      s.warned = true;
      process.stderr.write(`[tdai-memory] capture failed: ${r.error}\n`);
    }
  }
  return { ok: r.ok, latencyMs: r.latencyMs, degraded: s.degraded, error: r.error };
}

async function statusOp() {
  // aggregate latest across all sessions
  let l0 = null, l1 = null;
  let lastRecallAt = null, lastCaptureAt = null;
  let anyDegraded = false;
  for (const s of state.values()) {
    if (s.totalL0 !== null) l0 = s.totalL0;
    if (s.totalL1 !== null) l1 = s.totalL1;
    if (s.lastRecallAt && (!lastRecallAt || s.lastRecallAt > lastRecallAt)) lastRecallAt = s.lastRecallAt;
    if (s.lastCaptureAt && (!lastCaptureAt || s.lastCaptureAt > lastCaptureAt)) lastCaptureAt = s.lastCaptureAt;
    if (s.degraded) anyDegraded = true;
  }
  return { l0Messages: l0, l1Records: l1, sceneBlocks: null, stale: anyDegraded, degraded: anyDegraded, lastRecallAt, lastCaptureAt, sessionCount: state.size };
}

async function sessionEndOp(sk) {
  const r = await defaultInstances.sessionEnd({ sessionKey: sk });
  state.delete(sk);
  return { ok: r.ok, latencyMs: r.latencyMs, degraded: r.degraded, error: r.error };
}

// --- MCP server ---
const server = new Server({ name: "tdai-memory", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "recall",
      description: "Recall relevant memory context for a query. Fail-open: returns empty context if gateway down.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          session_key: { type: "string" },
        },
        required: ["query", "session_key"],
      },
    },
    {
      name: "capture",
      description: "Capture a user/assistant exchange to memory. Fire-and-forget.",
      inputSchema: {
        type: "object",
        properties: {
          user_content: { type: "string" },
          assistant_content: { type: "string" },
          session_key: { type: "string" },
        },
        required: ["session_key"],
      },
    },
    {
      name: "status",
      description: "Memory health: L0/L1 totals, last recall/capture times, degraded flag.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "session_end",
      description: "Flush session memory and clear state.",
      inputSchema: {
        type: "object",
        properties: { session_key: { type: "string" } },
        required: ["session_key"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "recall") {
      const r = await recallOp(args.session_key, args.query);
      return { content: [{ type: "text", text: JSON.stringify(r) }] };
    }
    if (name === "capture") {
      const r = await captureOp(args.session_key, args.user_content || "", args.assistant_content || "");
      return { content: [{ type: "text", text: JSON.stringify(r) }] };
    }
    if (name === "status") {
      return { content: [{ type: "text", text: JSON.stringify(await statusOp()) }] };
    }
    if (name === "session_end") {
      return { content: [{ type: "text", text: JSON.stringify(await sessionEndOp(args.session_key)) }] };
    }
    return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: `error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
});

// --- SIGTERM/SIGINT: flush all sessions, 5s overall ---
async function flushAll() {
  if (state.size === 0) return;
  const flush = Promise.allSettled([...state.keys()].map((sk) => defaultInstances.sessionEnd({ sessionKey: sk })));
  await Promise.race([flush, new Promise((r) => setTimeout(r, 5000))]);
  state.clear();
}

process.on("SIGTERM", async () => { await flushAll(); process.exit(0); });
process.on("SIGINT", async () => { await flushAll(); process.exit(0); });

// --- start ---
const transport = new StdioServerTransport();
await server.connect(transport);
