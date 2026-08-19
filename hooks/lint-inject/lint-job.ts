import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { acquireAutoConfig, releaseAutoConfig } from "./auto-config.ts";
import { resolveContext, type ParseResult, type Timings } from "./parse.ts";
import type { AutoConfig } from "./auto-config-definitions.ts";
import type { ColdLinter, DaemonDef } from "./linters/constructor.ts";

const execute = promisify(execFile);
const MAX_PARALLEL = 3;

export type LintJob = {
  key: string;
  bin: string;
  binPath: string;
  cwd: string;
  root: string;
  configRoot: string;
  files: string[];
  args: () => string[];
  parse: (stdout: string, stderr: string, exitCode: number) => ParseResult;
  autoConfig?: AutoConfig;
  env?: Record<string, string>;
  slow?: boolean;
};

function contextFor(fileAbs: string, linter: ColdLinter) {
  const local = resolveContext(fileAbs, linter.bin, { pathFallback: false });
  if (local.binPath) return local;
  if (!local.gitRoot && !linter.configless) return local;
  return resolveContext(fileAbs, linter.bin, { pathFallback: true });
}

export function coldJob(fileAbs: string, linter: ColdLinter): LintJob | undefined {
  const context = contextFor(fileAbs, linter);
  if (!context.binPath) return undefined;
  const cwd = context.binCwd ?? context.gitRoot ?? path.dirname(fileAbs);
  const baseKey = `${context.binPath}::${cwd}`;
  const job: LintJob = {
    key: linter.perFile ? `${baseKey}::${fileAbs}` : baseKey,
    bin: linter.bin,
    binPath: context.binPath,
    cwd,
    root: cwd,
    configRoot: context.gitRoot ?? context.binCwd ?? path.dirname(fileAbs),
    files: [fileAbs],
    args: () => linter.args(job.files),
    parse: (stdout, stderr, exitCode) => linter.parse(stdout, stderr, cwd, exitCode, job.files),
    autoConfig: linter.autoConfig,
    env: linter.env,
    slow: linter.slow,
  };
  return job;
}

function typecheckArgs(configured?: string[]): string[] {
  const configuredArgs = configured ?? ["--noEmit", "--watch", "--pretty", "false", "--preserveWatchOutput"];
  const args: string[] = [];
  for (let index = 0; index < configuredArgs.length; index += 1) {
    const arg = configuredArgs[index];
    const isExactWatch = arg === "--watch" || arg === "-w" || arg === "--preserveWatchOutput";
    const isAssignedWatch = /^--watch=/.test(arg) || /^-w=/.test(arg) || /^--preserveWatchOutput=/.test(arg);
    if (!isExactWatch && !isAssignedWatch) { args.push(arg); continue; }
    const next = configuredArgs[index + 1]?.toLowerCase();
    if (isExactWatch && (next === "true" || next === "false")) index += 1;
  }
  if (!args.includes("--noEmit")) args.push("--noEmit");
  if (!args.includes("--pretty")) args.push("--pretty", "false");
  return args;
}

export function typecheckJob(fileAbs: string, daemon: DaemonDef): LintJob | undefined {
  const context = resolveContext(fileAbs, daemon.bin, { pathFallback: false });
  if (!context.binPath || !context.binCwd) return undefined;
  const cwd = context.tsRoot ?? context.gitRoot ?? context.binCwd;
  return {
    key: `${context.binPath}::${cwd}::typecheck`,
    bin: daemon.bin,
    binPath: context.binPath,
    cwd,
    root: cwd,
    configRoot: cwd,
    files: [fileAbs],
    args: () => typecheckArgs(daemon.args),
    parse: (stdout, stderr, exitCode) => {
      const output = `${stdout}\n${stderr}`;
      const diags = (daemon.parse ?? (() => []))(output, cwd).map((diag) =>
        diag.rule && !diag.msg.includes(diag.rule) ? { ...diag, msg: `${diag.msg} (${diag.rule})` } : diag);
      return diags.length > 0 || exitCode === 0
        ? { diags }
        : { diags: [], parseError: (output.trim() || `${daemon.bin} exit ${exitCode}`).slice(0, 200) };
    },
    autoConfig: daemon.autoConfig,
    slow: true,
  };
}

async function runJob(
  job: LintJob,
  timeoutCap: number,
  deadline: number,
  signal?: AbortSignal,
): Promise<ParseResult | undefined> {
  let remaining = Math.min(timeoutCap, deadline - Date.now());
  if (remaining <= 0 || signal?.aborted) return undefined;
  const configUse = job.autoConfig
    ? await acquireAutoConfig(job.configRoot, job.autoConfig, remaining)
    : { isAvailable: true };
  if (!configUse.isAvailable) return undefined;
  let stdout = ""; let stderr = ""; let exitCode = 0;
  try {
    try {
      remaining = Math.min(timeoutCap, deadline - Date.now());
      if (remaining <= 0 || signal?.aborted) return undefined;
      const result = await execute(job.binPath, job.args(), {
        cwd: job.cwd, timeout: remaining, signal, maxBuffer: 4 * 1024 * 1024,
        env: job.env ? { ...process.env, ...job.env } : undefined,
      });
      stdout = result.stdout; stderr = result.stderr;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; killed?: boolean; code?: number | string };
      if (failure.killed || failure.code === "ABORT_ERR") return undefined;
      stdout = failure.stdout ?? ""; stderr = failure.stderr ?? "";
      exitCode = typeof failure.code === "number" ? failure.code : 0;
    }
    return job.parse(stdout, stderr, exitCode);
  } finally {
    if (configUse.lease) await releaseAutoConfig(configUse.lease);
  }
}

export async function runJobs(
  jobs: LintJob[], timings: Timings, deadline: number, signal?: AbortSignal,
): Promise<Map<string, ParseResult>> {
  const results = new Map<string, ParseResult>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, jobs.length) }, async () => {
    while (cursor < jobs.length && !signal?.aborted) {
      const job = jobs[cursor++];
      const cap = job.slow ? timings.budgetMs : timings.coldLinterMs;
      const result = await runJob(job, cap, deadline, signal);
      if (result) results.set(job.key, result);
    }
  }));
  return results;
}
