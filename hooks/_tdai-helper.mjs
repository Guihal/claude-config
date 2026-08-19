// _tdai-helper.mjs — shared helpers for tdai-memory hooks.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

export function readStdinJson() {
  return JSON.parse(readFileSync(0, "utf8"));
}

export function emitHook(eventName, body) {
  if (!body) {
    process.stdout.write("");
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: String(body).slice(0, 2000) }
  }));
}

export function sessionKey(p) {
  return `cc-${p.session_id}`;
}

/**
 * Project id = nearest ancestor of cwd containing .git; falls back to $HOME.
 * Not cwd itself: one-shot working dirs (audit runs, temp checkouts) would each
 * become their own scope. Not "" either — an empty project_id makes the writer
 * force scope='global', leaking the record into every project.
 */
export function projectId(p) {
  let dir = p.cwd || process.cwd();
  for (;;) {
    if (existsSync(`${dir}/.git`)) return dir;
    const up = dirname(dir);
    if (up === dir) return homedir();
    dir = up;
  }
}

const PERSONA_STATE_DIR = "/home/penis/.claude/mcp/tdai-memory/state";
/** Inject the L3 persona on turn 1 of a session and every N-th turn after. */
const PERSONA_EVERY_N_TURNS = 15;

function personaStatePath(p) {
  return `${PERSONA_STATE_DIR}/persona-${p.session_id}`;
}

/**
 * Persona is tens of KB and changes rarely — injecting it every turn is the
 * single biggest cost in the recall payload. Count turns per session in a file
 * (hooks are separate processes, so there is no in-memory state to keep).
 */
export function shouldInjectPersona(p) {
  try {
    mkdirSync(PERSONA_STATE_DIR, { recursive: true });
    const f = personaStatePath(p);
    const n = existsSync(f) ? Number(readFileSync(f, "utf8")) || 0 : 0;
    writeFileSync(f, String(n + 1));
    return n % PERSONA_EVERY_N_TURNS === 0;
  } catch {
    return true; // fail-open: worst case is the old every-turn behaviour
  }
}

/** Drop the turn counter so the next prompt re-injects the persona (session start / resume / after compaction). */
export function resetPersonaCadence(p) {
  try { rmSync(personaStatePath(p), { force: true }); } catch { /* nothing to reset */ }
  // One counter file per session id would otherwise accumulate forever.
  try {
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    for (const f of readdirSync(PERSONA_STATE_DIR)) {
      const full = `${PERSONA_STATE_DIR}/${f}`;
      if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true });
    }
  } catch { /* dir missing or unreadable — nothing to prune */ }
}
