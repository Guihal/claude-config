import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AutoConfig } from "./auto-config-definitions.ts";
import type { ColdLinter, DaemonDef, ResolvedPlan } from "./linters/constructor.ts";

const HOOK_FILE = "lint-inject.config.ts";
export const HOOK_TIMEOUT_MS = 1_000;
export type LintHook = (fileAbs: string, plan: ResolvedPlan) => ResolvedPlan | null | void;
export type HookResult = { plan: ResolvedPlan; hookError?: string };
const hookCache = new Map<string, { mtime: number; hook: LintHook }>();
const hookInFlight = new Map<string, Promise<LintHook>>();

export function findHook(fileAbs: string): string | undefined {
  let directory = path.dirname(fileAbs);
  for (;;) {
    const candidate = path.join(directory, HOOK_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (fs.existsSync(path.join(directory, ".git")) || parent === directory) return undefined;
    directory = parent;
  }
}

function isAutoConfig(value: unknown): value is AutoConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<AutoConfig>;
  return typeof config.file === "string" &&
    (typeof config.content === "string" || typeof config.content === "function") &&
    Array.isArray(config.configNames) && config.configNames.every((name) => typeof name === "string") &&
    (config.pkgKeys === undefined || (Array.isArray(config.pkgKeys) && config.pkgKeys.every((name) => typeof name === "string")));
}

function isColdLinter(value: unknown): value is ColdLinter {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ColdLinter>;
  return typeof item.bin === "string" && typeof item.args === "function" && typeof item.parse === "function" &&
    (item.perFile === undefined || typeof item.perFile === "boolean") &&
    (item.slow === undefined || typeof item.slow === "boolean") &&
    (item.configless === undefined || typeof item.configless === "boolean") &&
    (item.env === undefined || (typeof item.env === "object" && item.env !== null && !Array.isArray(item.env))) &&
    (item.autoConfig === undefined || isAutoConfig(item.autoConfig));
}

function isDaemon(value: unknown): value is DaemonDef {
  if (!value || typeof value !== "object") return false;
  const daemon = value as Partial<DaemonDef>;
  return (daemon.bin === "tsc" || daemon.bin === "vue-tsc") &&
    (daemon.args === undefined || (Array.isArray(daemon.args) && daemon.args.every((arg) => typeof arg === "string") && daemon.args.includes("--watch"))) &&
    (daemon.parse === undefined || typeof daemon.parse === "function") &&
    (daemon.autoConfig === undefined || isAutoConfig(daemon.autoConfig));
}

function isPlan(value: unknown): value is ResolvedPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Partial<ResolvedPlan>;
  return Array.isArray(plan.cold) && plan.cold.every(isColdLinter) &&
    (plan.daemon === undefined || isDaemon(plan.daemon));
}

async function loadHook(configPath: string): Promise<LintHook> {
  const mtime = fs.statSync(configPath).mtimeMs;
  const cached = hookCache.get(configPath);
  if (cached?.mtime === mtime) return cached.hook;
  const pending = hookInFlight.get(configPath);
  if (pending) return pending;
  const loading = (async () => {
    const module = await import(`${pathToFileURL(configPath).href}?mtime=${mtime}`) as { hook?: unknown; default?: unknown };
    const candidate = module.hook ?? module.default;
    const hook: LintHook = typeof candidate === "function" ? candidate as LintHook : () => undefined;
    hookCache.set(configPath, { mtime, hook });
    return hook;
  })();
  hookInFlight.set(configPath, loading);
  try { return await loading; } finally { hookInFlight.delete(configPath); }
}

async function beforeDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  operation.catch(() => {});
  if (remaining <= 0) throw new Error(`timeout ${HOOK_TIMEOUT_MS}ms`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${HOOK_TIMEOUT_MS}ms`)), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function applyHook(fileAbs: string, base: ResolvedPlan): Promise<HookResult> {
  const configPath = findHook(fileAbs);
  if (!configPath) return { plan: base };
  const deadline = Date.now() + HOOK_TIMEOUT_MS;
  let hook: LintHook;
  try { hook = await beforeDeadline(loadHook(configPath), deadline); }
  catch (error) {
    hookInFlight.delete(configPath);
    return { plan: base, hookError: `хук не загрузился: ${(error as Error).message}` };
  }
  try {
    const result = await beforeDeadline(Promise.resolve().then(() => hook(fileAbs, base)), deadline);
    if (result === null) return { plan: { cold: [] } };
    if (result === undefined) return { plan: base };
    if (!isPlan(result)) return { plan: base, hookError: "невалидный возврат хука" };
    return { plan: result };
  } catch (error) {
    return { plan: base, hookError: `хук упал: ${(error as Error).message}` };
  }
}
