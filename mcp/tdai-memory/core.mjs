// core.mjs — I/O-isolated TDAI memory bridge. Factory pattern, no module state.

const GATEWAY = process.env.TDAI_GATEWAY || "http://127.0.0.1:8420";
const RECALL_TIMEOUT_MS = 5000;
const CAPTURE_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 2000;
const SESSION_END_TIMEOUT_MS = 5000;

const CATEGORY_LINE = /^- \[[^\[\]\n]+\] /m;
/** Persona share of the 2000-char hook budget (see emitHook in _tdai-helper.mjs). */
const PERSONA_MAX_CHARS = 1200;

// createPost: returns (path, body, timeoutMs) => Promise<{ok, data, latencyMs, error?}>
export function createPost({ fetchImpl = globalThis.fetch, baseUrl = GATEWAY } = {}) {
  return async function post(path, body, timeoutMs) {
    const t0 = Date.now();
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return { ok: false, error: `${path} → HTTP ${res.status}`, latencyMs: Date.now() - t0 };
      }
      const data = await res.json();
      return { ok: true, data, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
    }
  };
}

// filterContext: pure, deterministic on input. Drops noise, keeps memory lines.
export function filterContext(rawContext) {
  if (!rawContext) return "";
  const cleaned = rawContext
    .replace(/<memory-tools-guide>[\s\S]*?<\/memory-tools-guide>/g, "")
    .replace(/<scene-navigation>[\s\S]*?<\/scene-navigation>/g, "")
    .replace(/<user-persona>[\s\S]*?<\/user-persona>/g, "")
    .replace(/^以下是当前对话召回的相关记忆.*$/m, "")
    .replace(/\s*\(活动时间:[^)]*\)/g, "");
  const lines = cleaned.split("\n");
  const seen = new Set();
  const kept = [];
  for (const line of lines) {
    const m = line.match(CATEGORY_LINE);
    if (!m) continue;
    const key = line.slice(m[0].length, m[0].length + 80).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  let filtered = kept.join("\n");
  if (filtered.length > 4096) filtered = filtered.slice(0, 4096) + "…(truncated)";
  return filtered.trim();
}

// flattenAssistantContent: drops thinking/tool_use/tool_result, keeps text.
export function flattenAssistantContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && b.type === "text")
    .map((b) => String(b.text || ""))
    .filter(Boolean)
    .join("\n");
}

// createRecall: returns ({query, sessionKey}) => Promise<{ok, context, memoryCount, latencyMs, degraded}>
export function createRecall({ post, filter = filterContext } = {}) {
  return async function recall({ query, sessionKey, projectId, includePersona }) {
    const r = await post(
      "/recall",
      { query, session_key: sessionKey, project_id: projectId || "", include_persona: includePersona !== false },
      RECALL_TIMEOUT_MS
    );
    if (!r.ok) {
      return { ok: false, context: "", memoryCount: 0, latencyMs: r.latencyMs, degraded: true, error: r.error };
    }
    const raw = r.data.context || "";
    let context = filter(raw);
    // The persona block is not a `- [type] ...` line, so filterContext always drops
    // it — re-attach it on the turns the gateway actually sent it (cadence gate).
    if (includePersona !== false) {
      let persona = raw.match(/<user-persona>[\s\S]*?<\/user-persona>/)?.[0];
      if (persona && [...persona].length > PERSONA_MAX_CHARS) {
        // The hook output is hard-capped at 2000 chars; keep the persona small
        // enough that the recalled memory lines still fit next to it.
        persona = `${[...persona].slice(0, PERSONA_MAX_CHARS).join("")}…(truncated)\n</user-persona>`;
      }
      // Memories first — a persona cut by the emit cap costs less than losing them.
      if (persona) context = context ? `${context}\n\n${persona}` : persona;
    }
    return { ok: true, context, memoryCount: r.data.memory_count || 0, latencyMs: r.latencyMs, degraded: false };
  };
}

// createStatus: returns () => Promise<{ok, totals, latencyMs, degraded}>
export function createStatus({ post } = {}) {
  return async function status() {
    const r = await post("/status", {}, STATUS_TIMEOUT_MS);
    if (!r.ok) return { ok: false, totals: null, latencyMs: r.latencyMs, degraded: true, error: r.error };
    return { ok: true, totals: r.data.totals, latencyMs: r.latencyMs, degraded: !!r.data.totals?.stale };
  };
}

// createCapture: returns ({userContent, assistantContent, sessionKey}) => Promise<{ok, latencyMs}>
export function createCapture({ post } = {}) {
  return async function capture({ userContent, assistantContent, sessionKey, projectId }) {
    const r = await post(
      "/capture",
      { user_content: userContent, assistant_content: assistantContent, session_key: sessionKey, session_id: sessionKey, project_id: projectId || "" },
      CAPTURE_TIMEOUT_MS
    );
    if (!r.ok) return { ok: false, latencyMs: r.latencyMs, degraded: true, error: r.error };
    return { ok: true, latencyMs: r.latencyMs, degraded: false };
  };
}

// createSessionEnd: returns ({sessionKey}) => Promise<{ok, latencyMs}>
export function createSessionEnd({ post } = {}) {
  return async function sessionEnd({ sessionKey }) {
    const r = await post("/session/end", { session_key: sessionKey }, SESSION_END_TIMEOUT_MS);
    if (!r.ok) return { ok: false, latencyMs: r.latencyMs, degraded: true, error: r.error };
    return { ok: true, latencyMs: r.latencyMs, degraded: false };
  };
}

// defaultInstances: wired to real fetch + gateway. For production use.
const defaultPost = createPost();
export const defaultInstances = {
  post: defaultPost,
  recall: createRecall({ post: defaultPost }),
  status: createStatus({ post: defaultPost }),
  capture: createCapture({ post: defaultPost }),
  sessionEnd: createSessionEnd({ post: defaultPost }),
  filterContext,
  flattenAssistantContent,
};
