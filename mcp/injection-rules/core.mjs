// core.mjs — pure logic for injection-rules MCP (port of pi injection-rules.ts)
// Zero npm deps. Imported by both hooks and daemon.

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Каталоги экспортируются, потому что инструменты в этой же репе (tools/budget-sim.mjs) обязаны
// читать и писать ровно там, откуда читает движок. Своя копия пути в инструменте означает, что
// прогон на стенде (`RULES_DIR=/tmp/...`) правит боевой каталог, пока движок читает стенд.
export const RULES_DIR =
  process.env.RULES_DIR || "/home/penis/.claude/mcp/injection-rules/rules";
export const STATE_DIR =
  process.env.STATE_DIR || "/home/penis/.claude/mcp/injection-rules";
const BUFFER_CAP = 30;
// Потолок отбора: сколько символов правил движок отдаёт за один ход.
//
// Число НЕ выбирается на глаз и НЕ переписывается по памяти — его считает симулятор в этой же
// репе: `node tools/budget-sim.mjs --horizon 10000` печатает пик спроса, РЕЗЕРВ и рекомендацию
// `max(ceil100(пик + РЕЗЕРВ), 5500)`. Прежний комментарий держал замеры от 2026-08-10 и ссылался
// на `scratchpad/budget-sim.py`, которого больше нет: методика потерялась вместе с файлом, а числа
// перестали воспроизводиться. Поэтому здесь — путь к работающей команде, а не список чисел.
//
// Замер 2026-08-19 (30 правил, каденции назначены поиском `--assign`): пик патологического
// сценария 3458, РЕЗЕРВ 1576 (`simulate-first` — самая дорогая разница «тело вместо суффикса»
// среди правил, которые не отдают тело каждый ход), срезов 0 на 10000 ходов в обоих сценариях.
// Рекомендация `ceil100(3458 + 1576)` = 5100 ниже пола 5500, поэтому стоит пол.
// Числа — снимок на дату: устарели, значит перезапусти симулятор, а не правь их руками.
//
// ВАЖНО: бюджет отбора — не единственный лимит. Хук доставки режет собственный вывод, поэтому
// injection-rules-userprompt.mjs обязан передавать этот же CHAR_BUDGET в emitHook; с дефолтом
// 2000 нудж task-list молча обрезался на 40 ходах из 200.
// К стартовому своду (startupRules + SessionStart-хук) бюджет НЕ применяется.
export const CHAR_BUDGET_DEFAULT = 5500;

// Лимит читается из env, потому что симулятор (tools/budget-sim.mjs) обязан измерить СПРОС —
// сколько правил хотели доставить, — а при боевом лимите отбор ниже молча клипует кандидатов, и
// спрос из движка уже не достать, не продублировав логику отбора. Дубль неизбежно разъедется:
// именно так потерялась прежняя методика замера (см. историю числа выше).
// ПРОД-ПУТЬ ОДИН: env не задан → CHAR_BUDGET_DEFAULT. Невалидное значение → дефолт + строка в
// stderr; бросать на загрузке нельзя — это убило бы хук, а с ним всю инъекцию.
function readCharBudget() {
  const raw = process.env.IR_CHAR_BUDGET;
  if (raw === undefined || raw === "") return CHAR_BUDGET_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `[injection-rules] IR_CHAR_BUDGET=${raw} невалиден (нужно целое ≥ 1), беру дефолт ${CHAR_BUDGET_DEFAULT}`,
    );
    return CHAR_BUDGET_DEFAULT;
  }
  console.error(`[injection-rules] IR_CHAR_BUDGET override: ${parsed}`);
  return parsed;
}

export const CHAR_BUDGET = readCharBudget();

// Разовая доставка набора при спавне субагента — НЕ пер-тиковый лимит, поэтому свой конфиг.
// Смешать их — повторить ошибку, из-за которой лимит отбора и лимит emitHook когда-то разъехались.
// Дефолт = максимум всех ролей + тело самого длинного правила как резерв, вверх до тысячи.
// Команда воспроизводит расчёт для текущего каталога ролей и правил:
//   node -e 'import("./core.mjs").then(async m=>{const{readdirSync}=await import("node:fs");const roles=[...new Set(["main","worker","intent-auditor",...readdirSync("/home/penis/.claude/agents").filter(x=>x.endsWith(".md")).map(x=>x.slice(0,-3))])],sets=roles.map(x=>m.subagentRules(x)),max=Math.max(...sets.map(s=>s.reduce((n,r)=>n+r.body.length+r.name.length+3,0))),longest=Math.max(...m.loadRules().map(r=>r.body.length));console.log({max,longest,recommended:Math.ceil((max+longest)/1000)*1000})})'
export const SUBAGENT_CHAR_BUDGET_DEFAULT = 16000;

function readSubagentCharBudget() {
  const raw = process.env.IR_SUBAGENT_CHAR_BUDGET;
  if (raw === undefined || raw === "") return SUBAGENT_CHAR_BUDGET_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `[injection-rules] IR_SUBAGENT_CHAR_BUDGET=${raw} невалиден (нужно целое ≥ 1), беру дефолт ${SUBAGENT_CHAR_BUDGET_DEFAULT}`,
    );
    return SUBAGENT_CHAR_BUDGET_DEFAULT;
  }
  console.error(
    `[injection-rules] IR_SUBAGENT_CHAR_BUDGET override: ${parsed}`,
  );
  return parsed;
}

export const SUBAGENT_CHAR_BUDGET = readSubagentCharBudget();

// Сколько дней молчания переживает состояние сессии. Состояние копилось по файлу на сессию и не
// убиралось никогда: замер 2026-08-19 — 324 файла / 36 МБ за 25 дней, ~40 новых в сутки, то есть
// рост без retention, запрещённый правилом bounded-resources. Срок считается от mtime: живая
// сессия пишет состояние каждый ход, поэтому под уборку попадает только молчащее дольше срока.
// Потеря дешёвая: состояние — счётчик хода, буферы окна и штампы cooldown, всё восстановимо.
export const STATE_TTL_DAYS_DEFAULT = 14;

function readStateTtlDays() {
  const raw = process.env.IR_STATE_TTL_DAYS;
  if (raw === undefined || raw === "") return STATE_TTL_DAYS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `[injection-rules] IR_STATE_TTL_DAYS=${raw} невалиден (нужно целое ≥ 1), беру дефолт ${STATE_TTL_DAYS_DEFAULT}`,
    );
    return STATE_TTL_DAYS_DEFAULT;
  }
  return parsed;
}

export const STATE_TTL_DAYS = readStateTtlDays();
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

  // send_on_subagent: тело правила уходит субагенту при спавне (см. subagentRules).
  // Дефолт FALSE, зеркально send_on_start: слать роли весь свод запрещено (REQ-10), набор
  // собирается opt-in — правило само объявляет, что нужно роли, а не хук решает за него.
  if (
    json.send_on_subagent !== undefined &&
    typeof json.send_on_subagent !== "boolean"
  ) {
    throw new Error("send-on-subagent-not-boolean");
  }
  const sendOnSubagent = json.send_on_subagent === true;

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
    sendOnSubagent,
  };
}

// ── rule predicates ─────────────────────────────────────────
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

/** Читает состояние сессии с диска; нет файла — свежее состояние. Сессию НЕ регистрирует. */
function readStateFile(sessionId) {
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

function loadState(sessionId) {
  _sessions.add(sessionId);
  return readStateFile(sessionId);
}

/**
 * Удаляет состояния сессий, молчащих дольше STATE_TTL_DAYS, и брошенные .tmp от прерванной
 * записи (их не видит ни один читатель, поэтому иначе они лежат вечно).
 * Эффект — удаление файлов, поэтому вызывается ровно один раз за сессию, на первом тике.
 * Fail-open: любая ошибка уборки — строка в stderr, не исключение; хук важнее уборки.
 * @param {number} now — «сейчас» в мс (передаётся, чтобы уборку можно было проверить на стенде).
 * @returns {number} сколько файлов удалено.
 */
function pruneStaleState(now) {
  const cutoff = now - STATE_TTL_DAYS * 86400000;
  let removed = 0;
  try {
    for (const name of readdirSync(STATE_DIR)) {
      if (!name.startsWith("state.")) continue;
      if (!name.endsWith(".json") && !name.endsWith(".json.tmp")) continue;
      const path = join(STATE_DIR, name);
      try {
        if (statSync(path).mtimeMs >= cutoff) continue;
        unlinkSync(path);
        removed += 1;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  } catch (e) {
    console.error(`[injection-rules] state-prune: ${e.message}`);
    return removed;
  }
  if (removed > 0) {
    console.error(
      `[injection-rules] state-prune: удалено ${removed} состояний старше ${STATE_TTL_DAYS} дн`,
    );
  }
  return removed;
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

/**
 * Набор правил для роли субагента: зеркало startupRules, та же логика отбора по apply.
 * Пусто — штатный ответ (роль не объявлена ни в одном правиле), а не ошибка.
 */
export function subagentRules(agentType) {
  return loadRules().filter((r) => r.sendOnSubagent && applyRule(r, agentType));
}

export function getRule(name) {
  return loadRules().find((r) => r.name === name) || null;
}

/**
 * Здоровье движка; с sessionId — ещё и след последнего среза бюджета у этой сессии.
 * Срез пишется в состояние (`evaluate`), но до появления этой ветки прочитать его было нечем:
 * поле висело мёртвым, и «лимит не молчит» держалось на одной строке в stderr, которую видно
 * только под `claude --debug`. Запись о срезе НЕ стирается — она про ход, а не про «сейчас»,
 * поэтому рядом отдаётся turn_index: свежесть = turn_index − last_overflow.turn.
 */
export function status(sessionId) {
  const base = {
    rules_count: loadRules().length,
    sessions_count: _sessions.size,
    uptime_ms: Date.now() - _startedAt,
    // Наружу — чтобы паритет лимита у MCP-сервера (собранный бандл) и у хуков (импорт core.mjs)
    // можно было проверить командой, а не верой в то, что бандл пересобран.
    char_budget: CHAR_BUDGET,
    subagent_char_budget: SUBAGENT_CHAR_BUDGET,
    state_ttl_days: STATE_TTL_DAYS,
  };
  if (!sessionId) return base;
  const state = readStateFile(sessionId);
  return {
    ...base,
    turn_index: state.turnIndex,
    last_overflow: state.lastOverflow ?? null,
  };
}

export function applyRule(rule, agentId = "main") {
  // Роль приводится к нижнему регистру ЗДЕСЬ, а не у вызывающих: `apply` разбирается в нижний
  // регистр, а agent_type приходит из payload как есть, поэтому applyRule(rule, "Intent-Auditor")
  // без нормализации возвращал true там, где "intent-auditor" даёт false — исключение молча не
  // срабатывало. Через эту функцию ходят startupRules, subagentRules и отбор тика: одно место.
  const id = String(agentId).toLowerCase();
  if (rule.excludes.has(id)) return false;
  return rule.wildcard || rule.includes.has(id);
}

export function compileMatcher(pat) {
  return compilePattern(pat);
}

export function evaluate({ sessionId, source, text, tick, agentId = "main" }) {
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
    // Первый тик сессии = единственный момент уборки: readdir по каталогу состояний на КАЖДОМ
    // ходу — та же неограниченная работа, только по времени вместо диска.
    if (state.turnIndex === 1) pruneStaleState(Date.now());
    const rules = loadRules();
    const candidates = [];

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
    const dropped = [];
    let totalChars = 0;
    let demand = 0;
    for (const c of candidates) {
      demand += (demand ? 2 : 0) + c.body.length;
      const sep = applies.length ? 2 : 0;
      if (totalChars + sep + c.body.length > CHAR_BUDGET) {
        dropped.push(c.rule);
        continue;
      }
      applies.push({ rule: c.rule, body: c.body });
      totalChars += sep + c.body.length;
      // Штамп cooldown ставится ТОЛЬКО доставленному правилу. Раньше он стоял в цикле кандидатов,
      // и срезанное бюджетом правило замолкало ещё на cooldown_turns ходов, ни разу не долетев:
      // потеря удваивалась и была невидима.
      state.cooldown[c.rule] = state.turnIndex;
    }

    // Лимит не имеет права протухать молча (REQ-12): при срезе — строка в stderr и след в
    // состоянии сессии. stderr виден под `claude --debug`, state.*.json лежит на диске и
    // переживает сессию. console.error не бросает при закрытом fd 2, поэтому хук не ломается.
    if (dropped.length > 0) {
      state.lastOverflow = {
        turn: state.turnIndex,
        demand,
        budget: CHAR_BUDGET,
        dropped,
      };
      console.error(
        `[injection-rules] budget-overflow: turn=${state.turnIndex} budget=${CHAR_BUDGET} demand=${demand} dropped=${dropped.join(",")}`,
      );
    }

    saveState(sessionId, state);
    return { applies, dropped, turnIndex: state.turnIndex };
  }

  // no tick → just buffer
  saveState(sessionId, state);
  return { applies: [], dropped: [], turnIndex: state.turnIndex };
}
