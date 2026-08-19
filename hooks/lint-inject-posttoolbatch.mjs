#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

const TIMINGS = { coldLinterMs: 2_000, budgetMs: 4_000, changeWaitMs: 1_000 };
const MAX_REPORT_CHARS = 4_000;
const PROJECT_HOOK_TIMEOUT_MS = 1_000;
const PROJECT_HOOK_WATCHDOG_MS = 1_250;
const SKIP = new Set(["node_modules", "vendor", ".git", "dist", "build", ".nuxt", ".output"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

function emit(text) {
  if (!text) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolBatch",
      additionalContext: text.slice(0, MAX_REPORT_CHARS),
    },
  }));
}

export function editedFiles(toolCalls) {
  const files = new Set();
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    if (!WRITE_TOOLS.has(call?.tool_name)) continue;
    const file = call.tool_input?.file_path;
    if (typeof file !== "string" || !path.isAbsolute(file)) continue;
    if (file.split(path.sep).some((part) => SKIP.has(part))) continue;
    files.add(file);
  }
  return [...files];
}

function lintInWorker(items) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./lint-inject-posttoolbatch-worker.mjs", import.meta.url), {
      workerData: { items, timings: TIMINGS },
    });
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      void worker.terminate();
      operation(value);
    };
    const watchdog = setTimeout(() => finish(
      resolve,
      `[lint-inject] hook: хук упал: timeout ${PROJECT_HOOK_TIMEOUT_MS}ms`,
    ), PROJECT_HOOK_WATCHDOG_MS);
    worker.on("message", (message) => {
      if (message?.type === "plans-resolved") { clearTimeout(watchdog); return; }
      if (message?.type === "report") finish(resolve, message.report);
      if (message?.type === "error") finish(reject, new Error(message.error));
    });
    worker.on("error", (error) => finish(reject, error));
    worker.on("exit", (code) => {
      if (!settled) finish(reject, new Error(`lint worker exited ${code}`));
    });
  });
}

export async function handlePayload(payload) {
  const files = editedFiles(payload?.tool_calls);
  if (files.length === 0) return undefined;
  const editedAt = Date.now();
  return lintInWorker(files.map((abs) => ({ abs, editedAt })));
}

async function main() {
  let payload;
  try { payload = JSON.parse(readFileSync(0, "utf8")); }
  catch { return; }
  try { emit(await handlePayload(payload)); }
  catch { /* lint advice never blocks Claude */ }
}

await main();
