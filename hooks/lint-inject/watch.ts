import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  countErrors,
  DEFAULT_TIMINGS,
  parseTscOutput,
  stripAnsi,
  type Diag,
  type Timings,
} from "./parse.ts";

const CHANGE_MARK = "File change detected";
const DONE_RE = /Found \d+ errors?\. Watching for file changes\./;

export type Daemon = {
  bin: string;
  root: string;
  proc: ChildProcess;
  buffer: string[];
  lastDiags: Diag[];
  lastCounts: Map<string, number>;
  /** Снимок, уже показанный агенту — источник prevCounts. */
  reportedCounts: Map<string, number>;
  runId: number;
  lastChangeAt: number;
  lastRunStartedAt: number;
  lastRunEndedAt: number;
  ready: boolean;
  killed: boolean;
  runWaiters: (() => void)[];
  changeWaiters: (() => void)[];
  /** tsc-семейство: маркеры циклов (CHANGE_MARK/DONE_RE) tsc-специфичны, не параметризуются. */
  parse: (output: string, cwd: string) => Diag[];
};

export type Snapshot = {
  diags: Diag[];
  counts: Map<string, number>;
  /** Демон ещё не выдал baseline — типы в этом инжекте отсутствуют. */
  starting: boolean;
  /** Свежий цикл не закрылся в бюджет — данные могут быть устаревшими. */
  stale: boolean;
};

const daemons = new Map<string, Daemon>();
/** Ключи, где демон умер, не дойдя до baseline: не поднимать заново на каждую запись. */
const failed = new Set<string>();

export function daemonKey(tsRoot: string, bin: string): string {
  return `${tsRoot}::${bin}`;
}

let exitHookRegistered = false;

/** Страховка на случай выхода без session_shutdown. Регистрируется при первом spawn, не из factory. */
function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.on("exit", killAll);
}

/**
 * Lazy-start. Нет tsconfig.json или бинаря → undefined, работает только холодный линтер.
 * opts.args/parse: параметризация DaemonDef; дефолты — tsc-семейство (tsc/vue-tsc).
 */
export function getOrStartDaemon(
  tsRoot: string,
  bin: string,
  binPath: string,
  opts: { args?: string[]; parse?: (output: string, cwd: string) => Diag[] } = {},
): Daemon | undefined {
  const key = daemonKey(tsRoot, bin);
  const existing = daemons.get(key);
  if (existing && !existing.killed) return existing;
  if (failed.has(key)) return undefined;
  if (!fs.existsSync(path.join(tsRoot, "tsconfig.json"))) return undefined;
  if (!fs.existsSync(binPath)) return undefined;
  registerExitHook();

  const args = opts.args ?? ["--noEmit", "--watch", "--pretty", "false", "--preserveWatchOutput"];
  const parse = opts.parse ?? parseTscOutput;
  const proc = spawn(binPath, args, {
    cwd: tsRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const d: Daemon = {
    bin,
    root: tsRoot,
    proc,
    buffer: [],
    lastDiags: [],
    lastCounts: new Map(),
    reportedCounts: new Map(),
    runId: 0,
    lastChangeAt: 0,
    lastRunStartedAt: Date.now(),
    lastRunEndedAt: 0,
    ready: false,
    killed: false,
    runWaiters: [],
    changeWaiters: [],
    parse,
  };

  const onData = (chunk: Buffer | string) => consume(d, String(chunk));
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  const die = () => {
    // не дожил до baseline сам (killed уже стоит, если это наш SIGTERM) → бинарь/конфиг сломан
    if (!d.ready && !d.killed) failed.add(key);
    d.killed = true;
    daemons.delete(key);
    wake(d.runWaiters);
    wake(d.changeWaiters);
  };
  // spawn ENOENT/EACCES приходит событием: без листенера node роняет процесс агента
  proc.on("error", die);
  proc.on("exit", die);

  daemons.set(key, d);
  return d;
}

function wake(waiters: (() => void)[]): void {
  const pending = waiters.splice(0);
  for (const w of pending) w();
}

let carry = new WeakMap<Daemon, string>();

function consume(d: Daemon, chunk: string): void {
  const text = (carry.get(d) ?? "") + stripAnsi(chunk);
  const lines = text.split("\n");
  carry.set(d, lines.pop() ?? "");

  for (const line of lines) {
    if (line.includes(CHANGE_MARK)) {
      d.lastChangeAt = Date.now();
      d.lastRunStartedAt = d.lastChangeAt;
      d.buffer = [];
      wake(d.changeWaiters);
      continue;
    }
    if (DONE_RE.test(line)) {
      d.lastDiags = d.parse(d.buffer.join("\n"), d.root);
      d.lastCounts = countErrors(d.lastDiags);
      d.runId += 1;
      d.lastRunEndedAt = Date.now();
      d.ready = true;
      d.buffer = [];
      wake(d.runWaiters);
      continue;
    }
    d.buffer.push(line);
  }
}

function waitFor(waiters: (() => void)[], ms: number): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      const i = waiters.indexOf(cb);
      if (i >= 0) waiters.splice(i, 1);
      resolve(false);
    }, ms);
    const cb = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    };
    waiters.push(cb);
  });
}

function snapshot(d: Daemon, starting: boolean, stale: boolean): Snapshot {
  return { diags: d.lastDiags, counts: d.lastCounts, starting, stale };
}

/**
 * Ждёт цикл, начавшийся после editedAt. Ветки закрывают гонку «tsc напечатал
 * File change detected раньше, чем мы подписались».
 */
export async function awaitFreshRun(
  d: Daemon,
  editedAt: number,
  timings: Timings = DEFAULT_TIMINGS,
  deadline = Date.now() + timings.budgetMs,
): Promise<Snapshot> {
  const remaining = () => deadline - Date.now();

  // Холодный старт не блокирует: baseline догонит к следующей правке.
  if (!d.ready) return snapshot(d, true, false);

  // 1. Цикл после правки уже закрыт — ждать нечего.
  if (d.lastRunStartedAt > editedAt && d.lastRunEndedAt > d.lastRunStartedAt) {
    return snapshot(d, false, false);
  }

  // 2. Цикл уже идёт — ждём только его закрытия.
  if (d.lastChangeAt > editedAt) {
    const closed = await waitFor(d.runWaiters, remaining());
    return snapshot(d, false, !closed);
  }

  // 3. Ждём старта цикла; не начался — правка вне графа tsconfig.
  const started = await waitFor(d.changeWaiters, Math.min(timings.changeWaitMs, remaining()));
  if (!started) return snapshot(d, false, false);
  const closed = await waitFor(d.runWaiters, remaining());
  return snapshot(d, false, !closed);
}

export function killAll(): void {
  for (const d of daemons.values()) {
    if (d.killed) continue;
    d.killed = true;
    try {
      d.proc.kill("SIGTERM");
    } catch {
      // процесс уже мёртв — идемпотентность важнее причины
    }
  }
  daemons.clear();
  failed.clear();
  carry = new WeakMap();
}
