import * as fs from "node:fs";
import { findUserConfig } from "./auto-config.ts";
import { applyHook } from "./hook.ts";
import { coldJob, runJobs, typecheckJob, type LintJob } from "./lint-job.ts";
import {
  buildOwnReport, buildReport, DEFAULT_TIMINGS,
  type ParseResult, type Timings,
} from "./parse.ts";
import { planFor } from "./linters/index.ts";

export type Kind = "write" | "read";
export type BatchItem = { abs: string; editedAt: number };
type ResolvedItem = BatchItem & Awaited<ReturnType<typeof applyHook>>;

function addJob(jobs: Map<string, LintJob>, candidate: LintJob | undefined): void {
  if (!candidate) return;
  const existing = jobs.get(candidate.key);
  if (existing) {
    for (const file of candidate.files) if (!existing.files.includes(file)) existing.files.push(file);
  } else jobs.set(candidate.key, candidate);
}

function resultFor(results: Map<string, ParseResult>, job: LintJob | undefined): ParseResult | undefined {
  return job ? results.get(job.key) : undefined;
}

function coldCandidate(item: ResolvedItem, linter: ResolvedItem["plan"]["cold"][number], kind: Kind) {
  if (kind === "read" && linter.slow) return undefined;
  const job = coldJob(item.abs, linter);
  if (kind === "read" && job?.autoConfig && !findUserConfig(job.configRoot, job.autoConfig)) return undefined;
  return job;
}

export async function runColdForFiles(
  items: BatchItem[],
  timings: Timings = DEFAULT_TIMINGS,
  signal?: AbortSignal,
  kind: Kind = "write",
  onPlansResolved?: () => void,
): Promise<string | undefined> {
  const existing = items.filter((item) => {
    try { return fs.statSync(item.abs).isFile(); } catch { return false; }
  });
  if (existing.length === 0) { onPlansResolved?.(); return undefined; }
  const resolved: ResolvedItem[] = await Promise.all(existing.map(async (item) => ({
    ...item, ...(await applyHook(item.abs, planFor(item.abs))),
  })));
  onPlansResolved?.();
  const deadline = Date.now() + timings.budgetMs;
  const coldJobs = new Map<string, LintJob>();
  for (const item of resolved) {
    for (const linter of item.plan.cold) addJob(coldJobs, coldCandidate(item, linter, kind));
  }
  const coldResults = await runJobs([...coldJobs.values()], timings, deadline, signal);
  const ownColdError = (item: ResolvedItem) => item.plan.cold.some((linter) =>
    resultFor(coldResults, coldCandidate(item, linter, kind))?.diags
      .some((diag) => diag.severity === "error" && diag.absPath === item.abs));

  const typeJobs = new Map<string, LintJob>();
  if (kind === "write") {
    for (const item of resolved) {
      if (item.plan.daemon && !ownColdError(item)) addJob(typeJobs, typecheckJob(item.abs, item.plan.daemon));
    }
  }
  const typeResults = await runJobs([...typeJobs.values()], timings, deadline, signal);
  const sections: string[] = [];
  const hookErrors = [...new Set(resolved.map((item) => item.hookError).filter((value): value is string => !!value))];
  if (hookErrors.length) sections.push(`[lint-inject] hook: ${hookErrors.join("; ")}`);
  const batchEdited = new Set(existing.map((item) => item.abs));
  for (const item of resolved) for (const linter of item.plan.cold) {
    const job = coldCandidate(item, linter, kind);
    const result = resultFor(coldResults, job);
    if (!job || !result) continue;
    if (result.parseError) {
      sections.push(`[lint-inject] ${linter.bin}: вывод не распарсен: ${result.parseError}`);
      continue;
    }
    const report = kind === "read"
      ? buildOwnReport({ editedAbs: item.abs, rootAbs: job.root, diags: result.diags })
      : buildReport({ editedAbs: item.abs, rootAbs: job.root, diags: result.diags, prevCounts: new Map(), batchEdited }).text;
    if (report) sections.push(`[lint-inject] ${linter.bin}:`, report);
  }
  for (const item of resolved) {
    if (kind !== "write" || !item.plan.daemon || ownColdError(item)) continue;
    const job = typecheckJob(item.abs, item.plan.daemon);
    const result = resultFor(typeResults, job);
    if (!job || !result) continue;
    if (result.parseError) {
      sections.push(`[lint-inject] ${item.plan.daemon.bin}: вывод не распарсен: ${result.parseError}`);
      continue;
    }
    const report = buildReport({
      editedAbs: item.abs, rootAbs: job.root, diags: result.diags,
      prevCounts: new Map(), batchEdited,
    }).text;
    if (report) sections.push(`[lint-inject] ${item.plan.daemon.bin}:`, report);
  }
  return sections.length ? sections.join("\n") : undefined;
}
