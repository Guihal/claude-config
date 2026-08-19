/**
 * searxng — lazy SearXNG search MCP server for Claude Code.
 *
 * Port of ~/.pi/agent/extensions/searxng/index.ts (pi extension) to MCP stdio.
 * Same behaviour: starts the Docker container on first tool call, stops it after
 * SEARXNG_IDLE_TIMEOUT seconds of no calls (default 300), searches the SearXNG
 * JSON API directly.
 *
 * Raw JSON-RPC over stdio — only initialize / tools/list / tools/call are needed,
 * which is cheaper than pulling the MCP SDK dependency tree.
 */

import { execSync } from "node:child_process";

// ── Config ─────────────────────────────────────────────────
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";
const IDLE_TIMEOUT_MS =
  parseInt(process.env.SEARXNG_IDLE_TIMEOUT || "300", 10) * 1000;
const SEARXNG_DIR = process.env.SEARXNG_DIR || `${process.env.HOME}/searxng`;
const COMPOSE_FILE = `${SEARXNG_DIR}/docker-compose.yml`;
const HEALTH_ATTEMPTS = 20;
const FETCH_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ── State ──────────────────────────────────────────────────
let containerRunning = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeRequests = 0;

const DEBUG = process.env.SEARXNG_DEBUG === "1";
function log(msg: string) {
  if (DEBUG) process.stderr.write(`[searxng] ${msg}\n`);
}

// ── Container lifecycle ────────────────────────────────────
function isContainerRunning(): boolean {
  try {
    const out = execSync(
      "docker inspect -f '{{.State.Running}}' searxng-core 2>/dev/null",
      { encoding: "utf-8", timeout: 5_000 }
    ).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function startContainer(): void {
  if (isContainerRunning()) {
    containerRunning = true;
    log("container already running");
    return;
  }
  log("starting container...");
  try {
    execSync(`docker compose -f '${COMPOSE_FILE}' up -d`, {
      timeout: 30_000,
      stdio: "pipe",
    });
    for (let i = 0; i < HEALTH_ATTEMPTS; i++) {
      try {
        execSync(`curl -sf ${SEARXNG_URL}/`, { timeout: 3_000, stdio: "pipe" });
        containerRunning = true;
        log(`container healthy (${i + 1}s)`);
        return;
      } catch {
        execSync("sleep 1", { stdio: "pipe" });
      }
    }
    containerRunning = true;
    log("container started (health check timeout, proceeding)");
  } catch (e: any) {
    log(`start failed: ${e.message}`);
    throw new Error(`Failed to start SearXNG container: ${e.message}`);
  }
}

function stopContainer(): void {
  if (!containerRunning) return;
  if (activeRequests > 0) {
    log(`deferred stop: ${activeRequests} active request(s)`);
    return;
  }
  log("stopping container...");
  try {
    execSync(`docker compose -f '${COMPOSE_FILE}' stop`, {
      timeout: 15_000,
      stdio: "pipe",
    });
    containerRunning = false;
    log("container stopped");
  } catch (e: any) {
    log(`stop failed: ${e.message}`);
  }
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    log("idle timeout");
    stopContainer();
  }, IDLE_TIMEOUT_MS);
}

function cancelIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// ── SearXNG HTTP client ───────────────────────────────────
interface SearxngResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  score: number;
}

interface SearxngResponse {
  results: SearxngResult[];
  suggestions: string[];
  query: string;
  number_of_results: number;
}

async function searchSearxng(
  query: string,
  options: {
    pageno?: number;
    time_range?: string;
    language?: string;
    safesearch?: string;
    categories?: string;
    engines?: string;
  } = {}
): Promise<SearxngResponse> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    pageno: String(options.pageno ?? 1),
    language: options.language ?? "all",
    safesearch: options.safesearch ?? "0",
  });
  if (options.time_range) params.set("time_range", options.time_range);
  if (options.categories) params.set("categories", options.categories);
  if (options.engines) params.set("engines", options.engines);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SEARXNG_URL}/search?${params}`, {
      signal: controller.signal,
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}: ${res.statusText}`);
    return (await res.json()) as SearxngResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function formatResults(data: SearxngResponse): string {
  const parts: string[] = [];
  if (data.suggestions?.length) {
    parts.push(`Suggestions: ${data.suggestions.join(", ")}\n`);
  }
  for (const r of (data.results ?? []).slice(0, 10)) {
    parts.push(`### ${r.title}\n${r.content || "(no description)"}\nURL: ${r.url}\n`);
  }
  if (!parts.length) return "No results found.";
  return parts.join("\n");
}

async function suggestSearxng(query: string, language = "all"): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${SEARXNG_URL}/autocompleter?q=${encodeURIComponent(query)}&lang=${language}`,
      { signal: controller.signal, headers: { "User-Agent": UA } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: any = await res.json();
    // SearXNG autocompleter returns [query, [suggestions]] or {results:[...]}
    const suggestions: string[] = Array.isArray(raw) ? raw[1] ?? [] : raw?.results ?? [];
    return suggestions.length ? `Suggestions: ${suggestions.join(", ")}` : "No suggestions.";
  } finally {
    clearTimeout(timeout);
  }
}

// ── Tool definitions ───────────────────────────────────────
const TOOLS = [
  {
    name: "searxng_search",
    description:
      "Search the web via SearXNG (self-hosted, 70+ engines, no CAPTCHA). " +
      "Auto-starts/stops the Docker container on demand. Use for all web search; " +
      "for reading a specific URL use WebFetch instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        pageno: { type: "number", description: "Page number (starts at 1)" },
        time_range: { type: "string", description: "Time filter: day, week, month, year" },
        language: { type: "string", description: "Language code (en, ru, ...) or 'all'" },
        safesearch: { type: "string", description: "Safe search: 0=off, 1=moderate, 2=strict" },
        categories: {
          type: "string",
          description: "Comma-separated categories: general, images, news, science, it",
        },
        engines: {
          type: "string",
          description: "Comma-separated engine names: google, bing, duckduckgo, wikipedia",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "searxng_suggest",
    description: "Get search autocomplete suggestions from SearXNG.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial query to autocomplete" },
        language: { type: "string", description: "Language code or 'all'" },
      },
      required: ["query"],
    },
  },
];

async function callTool(name: string, args: any): Promise<{ text: string; isError?: boolean }> {
  activeRequests++;
  cancelIdleTimer();
  try {
    if (!isContainerRunning()) startContainer();
    if (name === "searxng_search") {
      const data = await searchSearxng(args.query, args);
      return { text: formatResults(data) };
    }
    if (name === "searxng_suggest") {
      return { text: await suggestSearxng(args.query, args.language ?? "all") };
    }
    return { text: `Unknown tool: ${name}`, isError: true };
  } catch (e: any) {
    return { text: `${name} failed: ${e.message}`, isError: true };
  } finally {
    activeRequests--;
    resetIdleTimer();
  }
}

// ── JSON-RPC stdio loop ────────────────────────────────────
function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req: any) {
  // Notifications carry no `id` — process side effects, never reply.
  if (req.id === undefined || req.id === null) return;

  const reply = (result: unknown) => send({ jsonrpc: "2.0", id: req.id, result });

  switch (req.method) {
    case "initialize":
      return reply({
        protocolVersion: req.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "searxng", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args } = req.params ?? {};
      const out = await callTool(name, args ?? {});
      return reply({
        content: [{ type: "text", text: out.text }],
        isError: out.isError ?? false,
      });
    }
    default:
      return send({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
  }
}

// pi stopped the container on `session_shutdown`; MCP's equivalent is process exit.
let pending = 0;
function shutdown() {
  // Drain in-flight requests first — stdin can close while a search is still running.
  if (pending > 0) {
    setTimeout(shutdown, 50);
    return;
  }
  cancelIdleTimer();
  if (containerRunning && activeRequests === 0) stopContainer();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      pending++;
      handle(JSON.parse(line)).finally(() => {
        pending--;
      });
    } catch (e: any) {
      pending--;
      log(`parse error: ${e.message}`);
    }
  }
});
process.stdin.on("end", shutdown);
