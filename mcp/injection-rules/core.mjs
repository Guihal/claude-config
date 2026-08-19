// core.mjs — pure logic for injection-rules MCP (port of pi injection-rules.ts)
// Zero npm deps. Imported by both hooks and daemon.

import { readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const RULES_DIR =
  process.env.RULES_DIR || "/home/penis/.claude/mcp/injection-rules/rules";
const STATE_DIR =
  process.env.STATE_DIR || "/home/penis/.claude/mcp/injection-rules";
const BUFFER_CAP = 30;
// 2026-08-10: 2000 → 3600. a-working-product инжектится на каждом тике (952 симв.),
// ab-verify-recipes — раз в 11 ходов (593 симв.). Замер по реальному каталогу:
// чтобы ни одно правило не срезалось на горизонте 1320 ходов, нужно 3551.
// 2026-08-10: 3600 → 4200 (добавлено task-list, каденс 1) → 5400. После вычистки
// 10 правил (why-rule, task-triggers, 8 skill-*-hint) пиковый спрос упал: фактический
// сценарий 3831, патологический (все semantic в один ход) 5082 вместо 7789. 5400 =
// патологический пик + 318, т.е. теперь ОБА сценария без срезов. Замер:
// scratchpad/budget-sim.py — симулирует сортировку и отбор ниже на реальном каталоге.
// ВАЖНО: бюджет отбора — не единственный лимит. Хук доставки режет собственный вывод,
// поэтому injection-rules-userprompt.mjs обязан передавать этот же CHAR_BUDGET в
// emitHook; с дефолтом 2000 нудж task-list молча обрезался на 40 ходах из 200.
// К стартовому своду (startupRules + SessionStart-хук) бюджет НЕ применяется.
export const CHAR_BUDGET = 5400;
const VALID_SOURCES = new Set([
  "user_only",
  "assistant_only",
  "tool_only",
  "any",
]);
const RECENT_WINDOW_DEFAULT = 30;
const WINDOW_HARD_CAP = 500;

let _rulesCache = null;
let _startedAt = Date.now();
const _sessions = new Set();

// ── sanitization ────────────────────────────────────────────
export function sanitizeSessionId(id) {
  if (!id) return "anonymous";
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 12);
}

// ── pattern compilation ─────────────────────────────────────
function compilePattern(raw) {
  const value = raw.trim();
  if (!value) throw new Error("pattern-empty");
  const reMatch = /^\/(.+)\/([gimsuy]*)$/.exec(value);
  if (reMatch) {
    return new RegExp(reMatch[1], reMatch[2]);
  }
  const needle = value.toLowerCase();
  return { test: (text) => String(text).toLowerCase().includes(needle) };
}

function compilePatterns(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (!values.every((v) => typeof v === "string")) return [];
  return values.map(compilePattern);
}

// ── rule object ─────────────────────────────────────────────
function makeRule(json) {
  if (!json || typeof json !== "object") throw new Error("root-not-object");
  if (typeof json.name !== "string") throw new Error("name-not-string");
  if (typeof json.body !== "string") throw new Error("body-not-string");
  if (!Array.isArray(json.apply) || json.apply.length === 0)
    throw new Error("apply-empty");
  if (!json.apply.every((a) => typeof a === "string"))
    throw new Error("apply-not-string-array");

  let wildcard = false;
  const includes = new Set();
  const excludes = new Set();
  for (const raw of json.apply) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry === "*") wildcard = true;
    else if (entry.startsWith("!"))
      excludes.add(entry.slice(1).trim().toLowerCase());
    else includes.add(entry.toLowerCase());
  }
  if (!wildcard && includes.size === 0) throw new Error("apply-no-positive");

  let windowSize = RECENT_WINDOW_DEFAULT;
  if (json.window !== undefined && json.window !== null) {
    if (!Number.isInteger(json.window) || json.window < 1)
      throw new Error("window-invalid");
    if (json.window > WINDOW_HARD_CAP) throw new Error("window-too-large");
    windowSize = json.window;
  }

  // send_on_start: тело правила уходит в контекст на SessionStart (см. startupRules).
  // Дефолт true, как в pi: на старте агент обязан видеть ВЕСЬ свод правил, флаг — это
  // opt-out для правил, которым место только в напоминаниях. Бюджет CHAR_BUDGET к
  // старту не применяется: он режет пер-тиковую доставку, а не свод.
  if (
    json.send_on_start !== undefined &&
    typeof json.send_on_start !== "boolean"
  ) {
    throw new Error("send-on-start-not-boolean");
  }
  const sendOnStart = json.send_on_start !== false;

  let remindEvery, remindSuffix;
  let remindAny = [],
    remindAll = [],
    remindNone = [];
  let source = "any";
  let cooldownTurns = 0;
  if (json.remind && typeof json.remind === "object") {
    const r = json.remind;
    if (r.every_n_turns !== undefined) {
      if (!Number.isInteger(r.every_n_turns) || r.every_n_turns < 1)
        throw new Error("remind-every-invalid");
      remindEvery = r.every_n_turns;
    }
    if (r.suffix !== undefined) {
      if (typeof r.suffix !== "string")
        throw new Error("remind-suffix-not-string");
      remindSuffix = r.suffix;
    }
    if (r.when && typeof r.when === "object") {
      const w = r.when;
      if (w.any !== undefined) remindAny = compilePatterns(w.any);
      if (w.all !== undefined) remindAll = compilePatterns(w.all);
      if (w.none !== undefined) remindNone = compilePatterns(w.none);
      if (w.source !== undefined) {
        if (typeof w.source !== "string" || !VALID_SOURCES.has(w.source))
          throw new Error("remind-when-source-invalid");
        source = w.source;
      }
      if (w.cooldown_turns !== undefined) {
        if (!Number.isInteger(w.cooldown_turns) || w.cooldown_turns < 0)
          throw new Error("cooldown-invalid");
        cooldownTurns = w.cooldown_turns;
      }
    }
  }

  return {
    name: json.name,
    body: json.body,
    wildcard,
    includes,
    excludes,
    remindEvery,
    remindSuffix,
    remindAny,
    remindAll,
    remindNone,
    windowSize,
    source,
    cooldownTurns,
    sendOnStart,
  };
}

// ── rule predicates ─────────────────────────────────────────
function ruleMatchesAgent(rule, agentId) {
  if (rule.excludes.has(agentId)) return false;
  return rule.wildcard || rule.includes.has(agentId);
}

function semanticHit(rule, slicedTexts) {
  if (rule.remindAny.length > 0) {
    if (!rule.remindAny.some((m) => slicedTexts.some((t) => m.test(t))))
      return false;
  }
  if (rule.remindAll.length > 0) {
    if (!rule.remindAll.every((m) => slicedTexts.some((t) => m.test(t))))
      return false;
  }
  if (rule.remindNone.length > 0) {
    if (rule.remindNone.some((m) => slicedTexts.some((t) => m.test(t))))
      return false;
  }
  return true;
}

function ruleHasSemantic(rule) {
  return (
    rule.remindAny.length > 0 ||
    rule.remindAll.length > 0 ||
    rule.remindNone.length > 0
  );
}

// ── rules loading ───────────────────────────────────────────
export function loadRules() {
  if (_rulesCache) return _rulesCache;
  let files;
  try {
    files = readdirSync(RULES_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if (e.code === "ENOENT") return (_rulesCache = []);
    throw e;
  }
  const rules = [];
  const seen = new Set();
  for (const file of files) {
    try {
      const json = JSON.parse(readFileSync(join(RULES_DIR, file), "utf8"));
      if (seen.has(json.name)) continue; // dedupe by name
      seen.add(json.name);
      rules.push(makeRule(json));
    } catch (e) {
      console.error(`[injection-rules] ${file}: ${e.message}`);
    }
  }
  _rulesCache = rules;
  return rules;
}

// ── state I/O ───────────────────────────────────────────────
function statePath(sessionId) {
  return join(STATE_DIR, "state." + sanitizeSessionId(sessionId) + ".json");
}

function loadState(sessionId) {
  _sessions.add(sessionId);
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      return {
        sessionId,
        turnIndex: 0,
        buffers: { user: [], assistant: [], tool: [] },
        cooldown: {},
        updatedAt: new Date().toISOString(),
      };
    }
    throw e;
  }
}

function saveState(sessionId, state) {
  state.updatedAt = new Date().toISOString();
  const tmp = statePath(sessionId) + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, statePath(sessionId));
}

// ── public API ──────────────────────────────────────────────
export function listRules() {
  return loadRules().map((r) => ({
    name: r.name,
    body: r.body,
    apply: r.wildcard ? ["*"] : [...r.includes],
  }));
}

/**
 * Rules whose body должен уехать в контекст один раз при старте сессии.
 * Без state и без тика: старт не двигает turnIndex и не зависит от буферов.
 */
export function startupRules(agentId = "main") {
  return loadRules().filter((r) => r.sendOnStart && applyRule(r, agentId));
}

export function getRule(name) {
  return loadRules().find((r) => r.name === name) || null;
}

export function status() {
  return {
    rules_count: loadRules().length,
    sessions_count: _sessions.size,
    uptime_ms: Date.now() - _startedAt,
  };
}

export function applyRule(rule, agentId = "main") {
  if (rule.excludes.has(agentId)) return false;
  return rule.wildcard || rule.includes.has(agentId);
}

export function compileMatcher(pat) {
  return compilePattern(pat);
}

export function evaluate({ sessionId, source, text, tick }) {
  if (!sessionId) throw new Error("sessionId-required");
  if (!["user", "assistant", "tool"].includes(source))
    throw new Error("source-invalid");
  const state = loadState(sessionId);

  // 1. push text
  if (text !== undefined && text !== null && text !== "") {
    state.buffers[source].push(String(text));
    if (state.buffers[source].length > BUFFER_CAP) {
      state.buffers[source] = state.buffers[source].slice(-BUFFER_CAP);
    }
  }

  // 2. tick + evaluate
  if (tick) {
    state.turnIndex++;
    const rules = loadRules();
    const candidates = [];
    const agentId = "main";

    for (const rule of rules) {
      if (!applyRule(rule, agentId)) continue;

      // source filter
      if (rule.source !== "any") {
        const sourceMap = {
          user_only: "user",
          assistant_only: "assistant",
          tool_only: "tool",
        };
        if (sourceMap[rule.source] !== source) continue;
      }

      const sliceCount = Math.min(
        rule.windowSize,
        state.buffers[source].length,
      );
      const slicedTexts = state.buffers[source].slice(-sliceCount);

      let fires = false;
      let body = null;

      // semantic trigger
      if (ruleHasSemantic(rule)) {
        if (semanticHit(rule, slicedTexts)) {
          fires = true;
          body = rule.body;
        }
      } else if (rule.remindEvery) {
        // every_n_turns cadence
        if (state.turnIndex % rule.remindEvery === 0) {
          fires = true;
          body = rule.remindSuffix || rule.body;
        }
      }

      // cooldown
      if (fires && rule.cooldownTurns > 0) {
        const lastFire = state.cooldown[rule.name];
        if (
          lastFire !== undefined &&
          state.turnIndex - lastFire < rule.cooldownTurns
        )
          fires = false;
      }

      if (fires) {
        candidates.push({
          rule: rule.name,
          body,
          _priority: ruleHasSemantic(rule) ? 1 : 0,
        });
        state.cooldown[rule.name] = state.turnIndex;
      }
    }

    // 3. priority: semantic > remind; alphabetical tiebreak
    candidates.sort((a, b) => {
      if (a._priority !== b._priority) return b._priority - a._priority;
      return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
    });

    // 4. char budget
    // Доставка склеивает тела через "\n\n" (injection-rules-userprompt.mjs) и сравнивает
    // результат с этим же CHAR_BUDGET, поэтому стыки считаем здесь: иначе отбор говорит
    // «влезло», а emitHook молча срезает хвост последнего правила.
    const applies = [];
    let totalChars = 0;
    for (const c of candidates) {
      const sep = applies.length ? 2 : 0;
      if (totalChars + sep + c.body.length > CHAR_BUDGET) continue;
      applies.push({ rule: c.rule, body: c.body });
      totalChars += sep + c.body.length;
    }

    saveState(sessionId, state);
    return { applies, turnIndex: state.turnIndex };
  }

  // no tick → just buffer
  saveState(sessionId, state);
  return { applies: [], turnIndex: state.turnIndex };
}
