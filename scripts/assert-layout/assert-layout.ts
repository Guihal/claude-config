#!/usr/bin/env bun
/**
 * assert-layout — декларативные layout-ассерты на брейкпоинтах через CDP.
 *
 * Ноль зависимостей: chromium из ~/.cache/ms-playwright (или CHROME_BIN),
 * CDP через глобальный WebSocket (Bun / Node 22+).
 *
 * CLI: bun assert-layout.ts [--config <path>]   (дефолт ./assert-layout.json)
 *
 * Конфиг:
 * {
 *   "url": "http://localhost:5173",            // ИЛИ
 *   "devServer": { "command": "npm run dev", "port": 5173, "waitMs": 30000 },
 *   "breakpoints": [375, 768, 1440],
 *   "settleMs": 400, "timeoutMs": 10000,
 *   "asserts": [
 *     { "name": "nav-visible", "selector": "nav",
 *       "checks": { "visible": true, "maxHeight": 100, "maxWidth": 400, "noHorizontalOverflow": true } }
 *   ]
 * }
 *
 * exit 0 = все ассерты на всех брейкпоинтах прошли; 1 = есть FAIL; 2 = ошибка конфига.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Check = { visible?: boolean; maxHeight?: number; maxWidth?: number; noHorizontalOverflow?: boolean };
type Assert = { name: string; selector: string; checks?: Check };
type Config = {
  url?: string;
  devServer?: { command: string; port: number; waitMs?: number };
  breakpoints: number[];
  settleMs: number;
  timeoutMs: number;
  asserts: Assert[];
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function loadConfig(p: string): Config {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<Config>;
  if (!Array.isArray(raw.breakpoints) || raw.breakpoints.length === 0) throw new Error("config: breakpoints обязателен");
  if (!Array.isArray(raw.asserts)) throw new Error("config: asserts обязателен");
  if (!raw.url && !raw.devServer?.port) throw new Error("config: нужен url или devServer.port");
  // неизвестный check — ошибка конфига, не тихий пропуск
  const KNOWN_CHECKS = new Set(["visible", "maxHeight", "maxWidth", "noHorizontalOverflow"]);
  for (const a of raw.asserts) {
    if (!a.name || !a.selector) throw new Error(`config: assert требует name и selector: ${JSON.stringify(a)}`);
    for (const key of Object.keys(a.checks ?? {})) {
      if (!KNOWN_CHECKS.has(key)) throw new Error(`config: неизвестный check "${key}" в assert "${a.name}" (доступно: ${[...KNOWN_CHECKS].join(", ")})`);
    }
  }
  return {
    breakpoints: raw.breakpoints,
    settleMs: raw.settleMs ?? 400,
    timeoutMs: raw.timeoutMs ?? 10_000,
    asserts: raw.asserts,
    url: raw.url,
    devServer: raw.devServer,
  };
}

// --- Chromium discovery -----------------------------------------------------

const PLAYWRIGHT_CACHE = path.join(os.homedir(), ".cache", "ms-playwright");

function findChromium(): string | undefined {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  if (!fs.existsSync(PLAYWRIGHT_CACHE)) return undefined;
  let best: { ver: number; p: string } | undefined;
  const pick = (re: RegExp, exe: string) => {
    for (const name of fs.readdirSync(PLAYWRIGHT_CACHE)) {
      const m = re.exec(name);
      if (!m) continue;
      const p = path.join(PLAYWRIGHT_CACHE, name, exe);
      if (fs.existsSync(p) && (!best || Number(m[1]) > best.ver)) best = { ver: Number(m[1]), p };
    }
  };
  pick(/^chromium-(\d+)$/, path.join("chrome-linux64", "chrome"));
  pick(/^chromium_headless_shell-(\d+)$/, path.join("chrome-headless-shell-linux64", "chrome-headless-shell"));
  return best?.p;
}

// --- CDP (глобальный WebSocket) ----------------------------------------------

type CdpPending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, CdpPending>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String((ev as MessageEvent).data)) as { id?: number; error?: { message: string }; result?: unknown };
      if (msg.id == null) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
    // смерть chromium посреди прогона: reject pending, иначе main зависнет вместо exit 2
    const failAll = () => {
      for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
      this.pending.clear();
    };
    ws.addEventListener("close", failAll);
    ws.addEventListener("error", failAll);
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`CDP connect timeout: ${url}`));
      }, 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`CDP connect failed: ${url}`));
      });
    });
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<unknown> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

// --- Браузер ------------------------------------------------------------------

type Browser = { proc: ChildProcess; port: number; userData: string };

async function launchBrowser(): Promise<Browser> {
  const exe = findChromium();
  if (!exe) throw new Error("chromium не найден: задайте CHROME_BIN или установите playwright (ms-playwright cache)");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "assert-layout-"));
  const proc = spawn(
    exe,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      `--user-data-dir=${userData}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  // DevTools listening печатается в stderr (verified chromium-1234) — слушаем оба канала.
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("DevTools ws endpoint не найден (таймаут)"));
    }, 15_000);
    const onData = (chunk: Buffer | string) => {
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(String(chunk));
      if (m) {
        cleanup();
        resolve(m[1]);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
  }).catch((err: Error) => {
    // не нашли ws endpoint — не оставляем зомби-процесс и tmpdir
    try {
      proc.kill("SIGKILL");
    } catch {
      // уже мёртв
    }
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      // tmpdir уже удалён
    }
    throw err;
  });
  // пайпы после отписки вернулись в paused — resume, иначе полный буфер застопорит chromium
  proc.stdout?.resume();
  proc.stderr?.resume();
  return { proc, port: Number(new URL(wsUrl).port), userData };
}

/** page-level ws endpoint: Page.* работают без Target.attachToTarget. */
async function pageWsUrl(port: number): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // браузер ещё поднимается
    }
    await sleep(100);
  }
  throw new Error("page target не найден в /json/list");
}

// --- Прогон одного брейкпоинта ------------------------------------------------

function buildExpr(asserts: Assert[]): string {
  const spec = asserts.map((a) => ({ selector: a.selector }));
  return `(() => {
    const spec = ${JSON.stringify(spec)};
    const de = document.documentElement;
    const out = spec.map((s) => {
      const el = document.querySelector(s.selector);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return {
        found: true,
        visible: r.width > 0 && r.height > 0,
        width: r.width,
        height: r.height,
        hOverflow: de.scrollWidth > de.clientWidth,
      };
    });
    return JSON.stringify(out);
  })()`;
}

async function evalJson(cdp: Cdp, expression: string): Promise<unknown> {
  const res = (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
    result?: { value?: string };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  };
  if (res.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "evaluation exception";
    throw new Error(desc.slice(0, 200));
  }
  const s = res.result?.value;
  if (s == null) throw new Error(`Runtime.evaluate вернул пустое значение: ${expression.slice(0, 80)}…`);
  return JSON.parse(s);
}

async function waitLoaded(cdp: Cdp, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await evalJson(cdp, `JSON.stringify({ ready: document.readyState === "complete", body: !!document.body })`);
      if ((ready as { ready: boolean }).ready) return;
    } catch {
      // навигация прервала контекст — продолжаем ждать
    }
    await sleep(150);
  }
  throw new Error("страница не загрузилась за timeoutMs");
}

type BreakpointResult = { ok: number; fail: number; failures: string[] };

async function runBreakpoint(cdp: Cdp, url: string, width: number, cfg: Config): Promise<BreakpointResult> {
  const height = width <= 600 ? 900 : 1200;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
  await cdp.send("Page.navigate", { url });
  await waitLoaded(cdp, cfg.timeoutMs);

  // settle: два одинаковых снимка подряд → DOM стабилен; нестабильный до дедлайна → FAIL.
  const expr = buildExpr(cfg.asserts);
  let prev = "";
  let state: unknown[] | undefined;
  let settled = false;
  const settleDeadline = Date.now() + Math.max(cfg.settleMs * 10, cfg.timeoutMs);
  while (Date.now() < settleDeadline) {
    let v: unknown[];
    try {
      v = (await evalJson(cdp, expr)) as unknown[];
    } catch {
      // страница в навигации / контекст пересоздан — ретраим до дедлайна (как waitLoaded)
      await sleep(cfg.settleMs);
      continue;
    }
    const s = JSON.stringify(v);
    if (prev !== "" && prev === s) {
      state = v;
      settled = true;
      break;
    }
    prev = s;
    state = v;
    await sleep(cfg.settleMs);
  }
  if (!settled) {
    const failures = cfg.asserts.map((a) => `  ✗ ${a.name}: DOM не стабилизировался (settle-таймаут)`);
    return { ok: 0, fail: cfg.asserts.length, failures }; // не оцениваем ассерты на нестабильном снимке
  }

  const ok: BreakpointResult = { ok: 0, fail: 0, failures: [] };
  const settledState = state!; // после !settled уже вернулись
  cfg.asserts.forEach((a, i) => {
    const snap = settledState[i] as
      | { found?: boolean; visible?: boolean; width?: number; height?: number; hOverflow?: boolean }
      | undefined;
    const checks = a.checks ?? {};
    const bad: string[] = [];
    if (!snap?.found) {
      bad.push(`element not found (${a.selector})`);
    } else {
      if (checks.visible && !snap.visible) bad.push("not visible");
      if (checks.maxHeight != null && snap.height! > checks.maxHeight) bad.push(`height ${snap.height} > ${checks.maxHeight}`);
      if (checks.maxWidth != null && snap.width! > checks.maxWidth) bad.push(`width ${snap.width} > ${checks.maxWidth}`);
      if (checks.noHorizontalOverflow && snap.hOverflow) bad.push("horizontal overflow");
    }
    if (bad.length > 0) {
      ok.fail += 1;
      ok.failures.push(`  ✗ ${a.name}: ${bad.join(", ")}`);
    } else {
      ok.ok += 1;
    }
  });
  return ok;
}

// --- devServer ----------------------------------------------------------------

async function startDevServer(ds: NonNullable<Config["devServer"]>): Promise<ChildProcess> {
  const proc = spawn(ds.command, { shell: true, stdio: ["ignore", "inherit", "inherit"], detached: true });
  const deadline = Date.now() + (ds.waitMs ?? 30_000);
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`devServer вышел с кодом ${proc.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${ds.port}`);
      if (res.ok) return proc;
    } catch {
      // ещё поднимается
    }
    await sleep(200);
  }
  killTree(proc); // не оставляем зомби при таймауте
  throw new Error(`devServer не поднялся на порту ${ds.port} за ${ds.waitMs ?? 30_000}ms`);
}

function killTree(proc: ChildProcess | undefined): void {
  if (!proc || proc.pid == null || proc.exitCode != null) return;
  try {
    process.kill(-proc.pid, "SIGTERM"); // detached: убиваем группу (дети vite и т.п.)
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      // уже мёртв
    }
  }
}

// --- Main ---------------------------------------------------------------------

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--config");
  const configPath = i >= 0 && argv[i + 1] ? argv[i + 1] : "assert-layout.json";
  if (!fs.existsSync(configPath)) {
    console.error(`assert-layout: конфиг не найден: ${configPath}`);
    return 2;
  }
  const cfg = loadConfig(configPath);
  const url = cfg.url ?? `http://127.0.0.1:${cfg.devServer!.port}`;

  let devProc: ChildProcess | undefined;
  if (cfg.devServer && !cfg.url) devProc = await startDevServer(cfg.devServer);

  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const cdp = await Cdp.connect(await pageWsUrl(browser.port));
    await cdp.send("Page.enable");
    let totalFail = 0;
    for (const width of cfg.breakpoints) {
      const r = await runBreakpoint(cdp, url, width, cfg);
      totalFail += r.fail;
      const verdict = r.fail === 0 ? "ok" : "FAIL";
      console.log(`${width}px: ${r.ok}/${r.ok + r.fail} ${verdict}`);
      for (const line of r.failures) console.log(line);
    }
    cdp.close();
    return totalFail > 0 ? 1 : 0;
  } finally {
    browser?.proc.kill("SIGTERM");
    if (browser?.userData) fs.rmSync(browser.userData, { recursive: true, force: true }); // tmpdir чистим и на success, и на ошибке
    killTree(devProc);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`assert-layout: ${(err as Error).message}`);
    process.exit(2);
  });
