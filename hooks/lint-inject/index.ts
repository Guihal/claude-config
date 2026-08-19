import * as fs from "node:fs";
import * as path from "node:path";
import { runColdForFiles, type BatchItem, type Kind } from "./cold-runner.ts";
import { DEFAULT_TIMINGS, type Timings } from "./parse.ts";
import { planFor } from "./linters/index.ts";

export { planFor } from "./linters/index.ts";
export type { BatchItem, Kind } from "./cold-runner.ts";

export const READ_TIMINGS: Timings = { coldLinterMs: 2_000, budgetMs: 4_000, changeWaitMs: 1_000 };

export function runForFiles(
  items: BatchItem[],
  timings: Timings = DEFAULT_TIMINGS,
  signal?: AbortSignal,
  kind: Kind = "write",
  onPlansResolved?: () => void,
): Promise<string | undefined> {
  return runColdForFiles(items, timings, signal, kind, onPlansResolved);
}

export function inspect(
  fileAbs: string,
  timings: Timings = DEFAULT_TIMINGS,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return runForFiles([{ abs: fileAbs, editedAt: Date.now() }], timings, signal);
}

export let BATCH_MS = 400;

export function setBatchMs(ms: number): void {
  BATCH_MS = ms;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function findGitRoot(fileAbs: string): string | undefined {
  let directory = path.dirname(fileAbs);
  for (;;) {
    if (fs.existsSync(path.join(directory, ".git"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function isSkippedPath(gitRoot: string, fileAbs: string): boolean {
  return path.relative(gitRoot, fileAbs).split(path.sep)
    .some((part) => part === "vendor" || part === "node_modules" || part === ".git");
}

type ToolEvent = {
  isError?: boolean;
  toolName?: string;
  input?: { path?: string };
  content?: unknown[];
};
type ToolContext = { cwd?: string; signal?: AbortSignal };

export function makeBatchHandler(): {
  handler: (event: ToolEvent, context: ToolContext) => Promise<unknown> | undefined;
  shutdown: () => void;
} {
  let pending = new Map<string, number>();
  let ownerPromise: Promise<unknown> | undefined;
  const handler = (event: ToolEvent, context: ToolContext): Promise<unknown> | undefined => {
    if (event.isError || !["write", "edit", "read"].includes(event.toolName ?? "")) return undefined;
    const relative = event.input?.path;
    if (!relative) return undefined;
    const fileAbs = path.resolve(context.cwd ?? process.cwd(), relative);
    if (event.toolName === "read") {
      if (ownerPromise || pending.has(fileAbs)) return undefined;
      const gitRoot = findGitRoot(fileAbs);
      if (gitRoot ? isSkippedPath(gitRoot, fileAbs) : !planFor(fileAbs).cold.some((linter) => linter.configless)) return undefined;
      return runForFiles([{ abs: fileAbs, editedAt: Date.now() }], READ_TIMINGS, context.signal, "read")
        .then((report) => report
          ? { content: [...(event.content ?? []), { type: "text" as const, text: report }] }
          : undefined);
    }
    const canOwn = !ownerPromise;
    pending.set(fileAbs, Date.now());
    if (!canOwn) return undefined;
    ownerPromise = (async () => {
      await sleep(BATCH_MS, context.signal);
      if (context.signal?.aborted) { pending = new Map(); return undefined; }
      const items = [...pending.entries()].map(([abs, editedAt]) => ({ abs, editedAt }));
      pending = new Map();
      const report = items.length
        ? await runForFiles(items, DEFAULT_TIMINGS, context.signal, "write")
        : undefined;
      return report
        ? { content: [...(event.content ?? []), { type: "text" as const, text: report }] }
        : undefined;
    })().finally(() => { ownerPromise = undefined; });
    return ownerPromise;
  };
  return {
    handler,
    shutdown: () => { pending = new Map(); ownerPromise = undefined; },
  };
}
