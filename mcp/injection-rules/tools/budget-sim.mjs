#!/usr/bin/env node
/* eslint-disable no-console -- CLI-инструмент: печать отчёта и есть его продукт, логгер тут лишний слой */
// Симулятор спроса на бюджет инъекции правил.
//
// Единственный носитель методики замера: прежняя (scratchpad/budget-sim.py) была утрачена, и
// числа в комментарии core.mjs перестали воспроизводиться. Поэтому этот файл живёт в репозитории.
//
// Как меряется спрос. Логика отбора НЕ дублируется — гоняется настоящий evaluate() из core.mjs,
// в двух экземплярах модуля сразу: "demand" с заведомо огромным лимитом (никого не срезает,
// поэтому его applies и есть спрос) и "real" с боевым. Разница по именам = срезанные правила.
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { scenarioTexts } from "./sim-scenarios.mjs";
import { searchCadences, emitLength, TIER_BANDS } from "./cadence-search.mjs";
// Каталоги — у движка, а не своей копией: он резолвит их из env (`core.mjs:11-14`), стенд задаётся
// той же env. С хардкодом здесь `--assign` писал бы в боевые правила, пока движок читает стенд.
// STATE_DIR берётся статическим импортом намеренно: loadEngine подменяет process.env.STATE_DIR на
// временный каталог, и после первого прохода env отдаёт уже его, а гарду нужен боевой.
import { RULES_DIR, STATE_DIR as STATE_DIR_REAL } from "../core.mjs";

const CORE_URL = pathToFileURL(
  "/home/penis/.claude/mcp/injection-rules/core.mjs",
).href;
// Пол бюджета: строго выше прежних 5400 (REQ-3 звучит «увеличивай лимит»). Бюджет — потолок на
// завтра, а не замер сегодняшнего пика, поэтому опускать его вслед за пиком запрещено.
const BUDGET_FLOOR = 5500;
const DEMAND_BUDGET = 10_000_000;
const HORIZON_DEFAULT = 10000;

function parseArgs(argv) {
  const args = {
    horizon: HORIZON_DEFAULT,
    budgetOverride: null,
    assign: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--horizon") args.horizon = requireInt(flag, argv[++i]);
    else if (flag === "--budget-override")
      args.budgetOverride = requireInt(flag, argv[++i]);
    else if (flag === "--assign") args.assign = true;
    else
      fail(
        `неизвестный аргумент: ${flag}. Есть только --horizon, --budget-override, --assign`,
      );
  }
  return args;
}

function requireInt(flag, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    fail(`${flag} требует целое ≥ 1, получено: ${raw}`);
  return value;
}

function fail(message) {
  console.error(`[budget-sim] ${message}`);
  process.exit(2);
}

/** Импортирует свежий экземпляр движка со своим лимитом и своим каталогом состояния. */
async function loadEngine(pass, budget, stateDir) {
  process.env.IR_CHAR_BUDGET = String(budget);
  process.env.STATE_DIR = stateDir;
  return import(`${CORE_URL}?pass=${pass}`);
}

function readRuleFiles() {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      path: join(RULES_DIR, f),
      rule: JSON.parse(readFileSync(join(RULES_DIR, f), "utf8")),
    }));
}

function readRules() {
  return readRuleFiles().map((entry) => entry.rule);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function lcmOf(values) {
  return values.reduce((acc, n) => (acc / gcd(acc, n)) * n, 1);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[idx];
}

/**
 * Резерв бюджета = самое дорогое одиночное событие «правило отдало тело вместо суффикса».
 *
 * Считается по Р3 плана: `max(body − suffix)` среди правил, которые НЕ отдают тело каждый ход.
 * Правило, отдающее тело всегда (`a-working-product`: нет суффикса, semantic-хак `when.none` с
 * never-match регэкспом), уже целиком сидит в измеренном пике — считать его резервом значило бы
 * заложить один и тот же расход дважды и не заложить будущее правило, ради которого резерв заведён.
 *
 * Кто именно «отдаёт тело каждый ход» — НЕ вычисляется предикатом над полями правила: набор полей
 * меняется (`when` без паттернов, каденция без суффикса), и предикат тихо соврал бы на первом же
 * новом сочетании. Это ЗАМЕР: `alwaysBody` приходит из прогона настоящего движка — правило попало
 * туда, только если на КАЖДОМ ходу обоих сценариев оно отдало ровно своё тело.
 */
function measureReserve(rules, alwaysBody) {
  let best = { name: "-", delta: 0 };
  for (const rule of rules) {
    if (alwaysBody.has(rule.name)) continue;
    const delta = rule.body.length - (rule.remind?.suffix?.length ?? 0);
    if (delta > best.delta) best = { name: rule.name, delta };
  }
  return best;
}

/** Один прогон сценария: спрос, доставка, срезы по каждому правилу. */
async function runScenario({ name, texts, horizon, realBudget, rules }) {
  const demandDir = mkdtempSync(join(tmpdir(), "irsim-demand-"));
  const realDir = mkdtempSync(join(tmpdir(), "irsim-real-"));
  try {
    const demand = await loadEngine(`demand-${name}`, DEMAND_BUDGET, demandDir);
    const real = await loadEngine(`real-${name}`, realBudget, realDir);
    if (demand.CHAR_BUDGET === real.CHAR_BUDGET) {
      fail(
        `приём с двумя экземплярами модуля перестал работать: оба лимита ${real.CHAR_BUDGET}. ` +
          `Без разделения экземпляров замер спроса врёт — останавливаюсь.`,
      );
    }

    const demands = [];
    const delivered = new Map();
    const cuts = new Map();
    const semanticHits = new Map();
    // Сколько раз правило отдало ровно своё ТЕЛО (а не суффикс) — вход для measureReserve.
    const fullBody = new Map();
    const bodyByName = new Map(rules.map((r) => [r.name, r.body]));

    for (let turn = 0; turn < horizon; turn++) {
      const text = texts[turn % texts.length];
      const want = demand.evaluate({
        sessionId: name,
        source: "user",
        text,
        tick: true,
      });
      const got = real.evaluate({
        sessionId: name,
        source: "user",
        text,
        tick: true,
      });

      const wantNames = new Set(want.applies.map((a) => a.rule));
      const gotNames = new Set(got.applies.map((a) => a.rule));
      demands.push(
        want.applies.reduce(
          (sum, a, i) => sum + a.body.length + (i ? 2 : 0),
          0,
        ),
      );

      for (const applied of want.applies) {
        if (applied.body === bodyByName.get(applied.rule))
          fullBody.set(applied.rule, (fullBody.get(applied.rule) ?? 0) + 1);
      }
      for (const rule of wantNames) {
        semanticHits.set(rule, (semanticHits.get(rule) ?? 0) + 1);
        if (!gotNames.has(rule)) cuts.set(rule, (cuts.get(rule) ?? 0) + 1);
      }
      for (const rule of gotNames)
        delivered.set(rule, (delivered.get(rule) ?? 0) + 1);
    }

    const sorted = [...demands].sort((a, b) => a - b);
    return {
      name,
      max: sorted[sorted.length - 1],
      p95: quantile(sorted, 0.95),
      p50: quantile(sorted, 0.5),
      min: sorted[0],
      delivered,
      cuts,
      semanticHits,
      fullBody,
    };
  } finally {
    rmSync(demandDir, { recursive: true, force: true });
    rmSync(realDir, { recursive: true, force: true });
  }
}

function expectedDeliveries(rule, horizon) {
  const every = rule.remind?.every_n_turns;
  if (!every) return null;
  return Math.floor(horizon / every);
}

/**
 * Имена state-файлов, которые оставил бы САМ симулятор, если бы промахнулся мимо временного
 * каталога. Движок хеширует sessionId (`core.mjs:74`) — повторяем ту же формулу.
 *
 * Считать файлы в боевом каталоге нельзя: туда законно пишут ДРУГИЕ живые сессии Claude Code, и
 * счётчик «до/после» ловил их, а не симулятор (воспроизведено: два одинаковых прогона подряд
 * разошлись, потому что между ними тикнула чужая сессия). Признак должен быть про нас, а не про
 * каталог.
 */
function ownStateFiles(sessionIds) {
  return sessionIds.map(
    (id) =>
      "state." +
      createHash("sha256").update(String(id)).digest("hex").slice(0, 12) +
      ".json",
  );
}

function leakedStateFiles(sessionIds) {
  const present = new Set(readdirSync(STATE_DIR_REAL));
  return ownStateFiles(sessionIds).filter((f) => present.has(f));
}

/**
 * Вклад semantic-правил по ходам, замеренный НАСТОЯЩИМ движком.
 * Он не зависит от каденций (в `core.mjs` semantic и каденция — взаимоисключающие ветки), поэтому
 * меряется один раз и служит фоном, поверх которого поиск раскладывает каденс-правила.
 */
async function measureSemanticBase({ texts, horizon, semanticNames }) {
  const dir = mkdtempSync(join(tmpdir(), "irsim-base-"));
  try {
    const engine = await loadEngine("base", DEMAND_BUDGET, dir);
    const lens = new Float64Array(horizon + 1);
    const count = new Int32Array(horizon + 1);
    for (let turn = 1; turn <= horizon; turn++) {
      const got = engine.evaluate({
        sessionId: "base",
        source: "user",
        text: texts[(turn - 1) % texts.length],
        tick: true,
      });
      for (const applied of got.applies) {
        if (!semanticNames.has(applied.rule)) continue;
        lens[turn] += applied.body.length;
        count[turn] += 1;
      }
    }
    return { lens, count };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Назначает каденции поиском, пишет их в файлы правил и проверяет, что записанное = напечатанное. */
async function runAssign(horizon) {
  const entries = readRuleFiles();
  const rules = entries.map((e) => e.rule);
  const semanticNames = new Set(
    rules.filter((r) => r.remind?.when).map((r) => r.name),
  );
  const base = await measureSemanticBase({
    texts: scenarioTexts(rules).pathological,
    horizon,
    semanticNames,
  });
  const { assignment, stats, passes } = searchCadences({
    rules,
    base,
    horizon,
  });

  console.log(
    `\nназначение каденций (проходов улучшения: ${passes}, цель: max=${stats.max} p95=${stats.p95} p50=${stats.p50})`,
  );
  console.log("правило                   тир   было  стало  вклад/ход");
  for (const { path, rule } of entries) {
    const value = assignment.get(rule.name);
    if (value === undefined) continue;
    const [lo, hi] = TIER_BANDS[rule._tier];
    if (value < lo || value > hi)
      fail(`${rule.name}: ${value} вне полосы ${rule._tier}`);
    console.log(
      `${rule.name.padEnd(26)}${rule._tier.padEnd(6)}${String(rule.remind.every_n_turns).padEnd(6)}${String(value).padEnd(7)}${emitLength(rule)}`,
    );
    rule.remind.every_n_turns = value;
    writeFileSync(path, `${JSON.stringify(rule, null, 2)}\n`, "utf8");
  }

  for (const rule of readRules()) {
    const value = assignment.get(rule.name);
    if (value === undefined) continue;
    if (rule.remind.every_n_turns !== value)
      fail(`записанное разошлось с напечатанным: ${rule.name}`);
  }
  const values = readRules()
    .map((r) => r.remind?.every_n_turns)
    .filter(Boolean);
  if (new Set(values).size !== values.length)
    fail("после записи каденции перестали быть попарно различными");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Сессии, которыми ходит симулятор: их имена и проверяются на утечку в боевой каталог.
  const ownSessions = ["baseline", "pathological", "base"];
  if (args.assign) await runAssign(args.horizon);
  const rules = readRules();
  const realBudget =
    args.budgetOverride ?? Number(process.env.IR_CHAR_BUDGET_BASE ?? 0) ?? 0;
  const budget =
    realBudget || (await import(`${CORE_URL}?pass=probe`)).CHAR_BUDGET_DEFAULT;

  const scenarios = scenarioTexts(rules);
  const results = [];
  for (const [name, texts] of Object.entries(scenarios)) {
    results.push(
      await runScenario({
        name,
        texts,
        horizon: args.horizon,
        realBudget: budget,
        rules,
      }),
    );
  }

  console.log(`rules=${rules.length} horizon=${args.horizon} budget=${budget}`);
  const problems = [];

  for (const r of results) {
    console.log(
      `${r.name} max=${r.max} p95=${r.p95} p50=${r.p50} min=${r.min}`,
    );
  }

  // Ассерты сценариев: baseline не должен трогать правила-по-триггеру, pathological — обязан задеть
  // каждое. Без них «спрос» тихо перестал бы отличаться между сценариями.
  // Смотрим на СПРОС (semanticHits), а не на доставку: при заниженном бюджете правило может быть
  // срезано на упаковке, и по delivered сценарий выглядел бы сломанным, хотя сработал штатно.
  //
  // Semantic-правила делятся на два вида, и мерить их одним ассертом нельзя:
  //  - по триггеру (`when.any` / `when.all`) — обязаны молчать в baseline и звучать в pathological;
  //  - безусловные — `when.none` с never-match регэкспом (`a-working-product`): `semanticHit` у них
  //    всегда true, правило звучит КАЖДЫЙ ход в любом сценарии и составляет постоянную часть пика.
  //    Прогонять их через первый ассерт нельзя — он бы падал на штатном поведении.
  const isTriggered = (r) => r.remind?.when?.any || r.remind?.when?.all;
  const isAlwaysOn = (r) => r.remind?.when && !isTriggered(r);
  const base = results.find((r) => r.name === "baseline");
  const path = results.find((r) => r.name === "pathological");
  for (const rule of rules.filter(isTriggered)) {
    if ((base.semanticHits.get(rule.name) ?? 0) > 0) {
      problems.push(`baseline задел правило-по-триггеру ${rule.name}`);
    }
    if ((path.semanticHits.get(rule.name) ?? 0) === 0) {
      problems.push(
        `pathological ни разу не задел правило-по-триггеру ${rule.name}`,
      );
    }
  }
  for (const rule of rules.filter(isAlwaysOn)) {
    for (const scenario of [base, path]) {
      const hits = scenario.semanticHits.get(rule.name) ?? 0;
      if (hits !== args.horizon) {
        problems.push(
          `always-on правило ${rule.name} сработало ${hits} раз из ${args.horizon} в сценарии ${scenario.name}`,
        );
      }
    }
  }

  console.log("\nправило                 доставлено  срезано  ожидалось");
  for (const rule of rules) {
    const expected = expectedDeliveries(rule, args.horizon);
    const got = path.delivered.get(rule.name) ?? 0;
    const cut = path.cuts.get(rule.name) ?? 0;
    console.log(
      `${rule.name.padEnd(24)}${String(got).padEnd(12)}${String(cut).padEnd(9)}${expected ?? "-"}`,
    );
    if (cut > 0) problems.push(`cuts: ${rule.name} срезано ${cut} раз`);
    if (expected !== null && got !== expected) {
      problems.push(
        `delivered≠expected: ${rule.name} ${got} вместо ${expected}`,
      );
    }
  }

  const cadences = rules.map((r) => r.remind?.every_n_turns).filter(Boolean);
  console.log(`\nLCM каденций=${lcmOf(cadences)} (горизонт ${args.horizon})`);

  const alwaysBody = new Set(
    rules
      .filter((r) =>
        results.every(
          (res) => (res.fullBody.get(r.name) ?? 0) === args.horizon,
        ),
      )
      .map((r) => r.name),
  );
  const reserve = measureReserve(rules, alwaysBody);
  const peak = path.max;
  const recommended = Math.max(
    Math.ceil((peak + reserve.delta) / 100) * 100,
    BUDGET_FLOOR,
  );
  console.log(
    `РЕЗЕРВ=${reserve.delta} (правило ${reserve.name}); тело каждый ход: ${[...alwaysBody].join(", ") || "нет"}`,
  );
  console.log(
    `рекомендация: max(ceil100(${peak} + ${reserve.delta}), пол ${BUDGET_FLOOR}) = ${recommended}`,
  );

  if (peak + reserve.delta > budget) {
    problems.push(
      `reserve: пик ${peak} + РЕЗЕРВ ${reserve.delta} > CHAR_BUDGET ${budget} — резерв протух`,
    );
  }

  const leaked = leakedStateFiles(ownSessions);
  console.log(
    `состояние симулятора в боевом каталоге: ${leaked.length === 0 ? "нет (ok)" : leaked.join(", ")}`,
  );
  if (leaked.length > 0)
    problems.push(
      `симулятор задел боевой каталог состояния: ${leaked.join(", ")}`,
    );

  if (problems.length === 0) {
    console.log("VERDICT ok");
  } else {
    console.log(`VERDICT fail\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }
}

await main();
