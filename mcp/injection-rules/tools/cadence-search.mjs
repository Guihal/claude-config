// Поиск каденций: назначает every_n_turns каждому каденс-правилу внутри полосы его тира.
//
// Зачем поиск, а не «взял простые числа»: правила с общим делителем сваливаются в один ход, и пик
// спроса задаётся именно совпадениями, а не средней нагрузкой. Полосу тира задаёт план, значение
// внутри полосы — эта функция.
//
// Чистая часть цикла: ни чтения файлов, ни записи. Вход — правила и профиль semantic-нагрузки,
// выход — карта «имя правила → период». Файлы пишет budget-sim.mjs.

/** Полосы тиров (редакторское решение плана 173212). T0 — фиксированная каденция, не ищется. */
export const TIER_BANDS = { T1: [4, 17], T2: [18, 37], T3: [38, 71] };

/**
 * Длина САМОГО ДЛИННОГО варианта текста. Форма проверяется явно, а не через тихое чтение
 * `.length`: на массиве `.length` вернул бы ЧИСЛО ВАРИАНТОВ (3) вместо длины в символах —
 * молча, без падения, — и поиск каденций счёл бы правило почти невесомым.
 * @param {string|string[]} value — текст правила или его варианты.
 */
export function maxVariantLength(value) {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("emit-length: empty variant list");
    let max = 0;
    for (const variant of value) {
      if (typeof variant !== "string")
        throw new Error("emit-length: unexpected shape");
      if (variant.length > max) max = variant.length;
    }
    return max;
  }
  throw new Error("emit-length: unexpected shape");
}

/**
 * Сколько символов правило кладёт в ход по каденции: движок отдаёт suffix, без него — тело.
 * Мера — худший (самый длинный) вариант: вариант выбирается случайно, и замер по короткому
 * сделал бы переполнение бюджета случайным событием.
 */
export function emitLength(rule) {
  return maxVariantLength(rule.remind?.suffix ?? rule.body);
}

function bandValues([lo, hi]) {
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/**
 * Профиль спроса на горизонте: lens[t] — сумма длин, count[t] — сколько правил сработало на ходу t.
 * Ходы нумеруются с 1, как turnIndex в движке (`core.mjs`: инкремент до отбора).
 */
function emptyProfile(horizon) {
  return {
    lens: new Float64Array(horizon + 1),
    count: new Int32Array(horizon + 1),
  };
}

function addCadence(profile, period, length, sign) {
  for (let t = period; t < profile.lens.length; t += period) {
    profile.lens[t] += sign * length;
    profile.count[t] += sign;
  }
}

/**
 * Спрос хода = сумма тел плюс стыки «\n\n» между ними — та же формула, что в runScenario и в
 * упаковке движка. Без стыков поиск оптимизировал бы не ту величину, которую потом меряет чек.
 */
function demandStats(profile) {
  const demands = [];
  for (let t = 1; t < profile.lens.length; t++) {
    const n = profile.count[t];
    demands.push(n === 0 ? 0 : profile.lens[t] + 2 * (n - 1));
  }
  demands.sort((a, b) => a - b);
  const at = (q) =>
    demands[Math.min(demands.length - 1, Math.floor(q * (demands.length - 1)))];
  return { max: demands[demands.length - 1], p95: at(0.95), p50: at(0.5) };
}

/** Лексикографическое сравнение цели: max, затем p95, затем p50. Меньше — лучше. */
function isBetter(a, b) {
  if (a.max !== b.max) return a.max < b.max;
  if (a.p95 !== b.p95) return a.p95 < b.p95;
  return a.p50 < b.p50;
}

function tierOf(rule) {
  const tier = rule._tier;
  if (!tier) throw new Error(`rule-without-tier: ${rule.name}`);
  return tier;
}

/** Порядок назначения: длинный суффикс первым — он сильнее двигает пик. Тайбрейк по имени. */
function searchOrder(rules) {
  return [...rules].sort((a, b) => {
    const byLen = emitLength(b) - emitLength(a);
    return byLen !== 0 ? byLen : a.name < b.name ? -1 : 1;
  });
}

function greedyAssign(order, profile, taken) {
  const assignment = new Map();
  for (const rule of order) {
    const length = emitLength(rule);
    let best = null;
    for (const value of bandValues(TIER_BANDS[tierOf(rule)])) {
      if (taken.has(value)) continue;
      addCadence(profile, value, length, +1);
      const stats = demandStats(profile);
      addCadence(profile, value, length, -1);
      if (best === null || isBetter(stats, best.stats)) best = { value, stats };
    }
    if (best === null) throw new Error(`band-exhausted: ${rule.name}`);
    taken.add(best.value);
    assignment.set(rule.name, best.value);
    addCadence(profile, best.value, length, +1);
  }
  return assignment;
}

/** Обмен значениями внутри одного тира, пока цель падает. Проходов не больше MAX_PASSES. */
function improveBySwaps(rules, assignment, profile, maxPasses) {
  const byTier = new Map();
  for (const rule of rules) {
    const tier = tierOf(rule);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(rule);
  }
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    let improved = false;
    for (const group of byTier.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = [group[i], group[j]];
          const [la, lb] = [emitLength(a), emitLength(b)];
          if (la === lb) continue;
          const [va, vb] = [assignment.get(a.name), assignment.get(b.name)];
          const before = demandStats(profile);
          addCadence(profile, va, la, -1);
          addCadence(profile, vb, lb, -1);
          addCadence(profile, va, lb, +1);
          addCadence(profile, vb, la, +1);
          const after = demandStats(profile);
          if (isBetter(after, before)) {
            assignment.set(a.name, vb);
            assignment.set(b.name, va);
            improved = true;
          } else {
            addCadence(profile, va, lb, -1);
            addCadence(profile, vb, la, -1);
            addCadence(profile, va, la, +1);
            addCadence(profile, vb, lb, +1);
          }
        }
      }
    }
    if (!improved) break;
  }
  return passes;
}

/**
 * Назначает периоды каденс-правилам с тиром из TIER_BANDS.
 * @param {object[]} rules — весь каталог (правила без каденции игнорируются).
 * @param {{lens:Float64Array,count:Int32Array}} base — вклад semantic-правил, замеренный движком:
 *   он не зависит от назначения (в `core.mjs` semantic и каденция — взаимоисключающие ветки).
 * @param {number} horizon — длина горизонта в ходах.
 * @param {number} maxPasses — потолок проходов улучшения (детерминизм: ни времени, ни случайности).
 * @returns {{assignment: Map<string, number>, stats: object, passes: number}}
 */
export function searchCadences({ rules, base, horizon, maxPasses = 8 }) {
  const profile = emptyProfile(horizon);
  profile.lens.set(base.lens);
  profile.count.set(base.count);

  const fixed = rules.filter(
    (r) => r.remind?.every_n_turns && !TIER_BANDS[r._tier],
  );
  const searched = rules.filter(
    (r) => r.remind?.every_n_turns && TIER_BANDS[r._tier],
  );
  const taken = new Set();
  for (const rule of fixed) {
    const value = rule.remind.every_n_turns;
    taken.add(value);
    addCadence(profile, value, emitLength(rule), +1);
  }

  const assignment = greedyAssign(searchOrder(searched), profile, taken);
  const passes = improveBySwaps(searched, assignment, profile, maxPasses);
  return { assignment, stats: demandStats(profile), passes };
}

export const _internals = { emptyProfile, addCadence, demandStats };

// Запускаемый чек формы: `node tools/cadence-search.mjs` → `cadence-search: emit-length ok`.
// Стоит здесь, потому что молчаливая ошибка emitLength на массиве не падает и не видна в
// выводе поиска — её видно только прицельным вводом.
if (process.argv[1]?.endsWith("cadence-search.mjs")) {
  const { strict: assert } = await import("node:assert");
  assert.equal(emitLength({ body: "abcd" }), 4);
  assert.equal(emitLength({ body: ["ab", "abcdef", "abc"] }), 6);
  assert.equal(emitLength({ body: "x", remind: { suffix: "abc" } }), 3);
  assert.equal(
    emitLength({ body: "xxxxxxxxxx", remind: { suffix: ["a", "abcd"] } }),
    4,
  );
  assert.throws(() => emitLength({ body: 42 }), /unexpected shape/);
  assert.throws(() => emitLength({ body: [1, 2] }), /unexpected shape/);
  assert.throws(() => emitLength({ body: [] }), /empty variant list/);
  console.log("cadence-search: emit-length ok");
}
