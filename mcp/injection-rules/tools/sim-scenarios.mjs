// Тексты сценариев для budget-sim: собираются ИЗ САМИХ ПРАВИЛ, а не пишутся руками.
//
// Зачем так: список триггеров живёт в rules/*.json и меняется вместе с каталогом. Хардкод фраз
// здесь означал бы вторую копию того же факта, которая протухнет при первом же новом правиле —
// ровно тот дефект, против которого заводится derive-not-snapshot.

/** Литералы (не регэкспы) из when.any / when.all — то, чем можно ЗАДЕТЬ semantic-правило. */
function triggerLiterals(rule) {
  const when = rule.remind?.when;
  if (!when) return [];
  return [...(when.any ?? []), ...(when.all ?? [])].filter(
    (p) => !/^\/.*\/[gimsuy]*$/.test(p),
  );
}

/** Литералы из when.none — то, чего в тексте быть НЕ должно, иначе правило замолчит. */
function forbiddenLiterals(rules) {
  const forbidden = new Set();
  for (const rule of rules) {
    for (const pattern of rule.remind?.when?.none ?? []) {
      if (!/^\/.*\/[gimsuy]*$/.test(pattern))
        forbidden.add(pattern.toLowerCase());
    }
  }
  return forbidden;
}

/**
 * baseline — обычный ход без единого триггера; pathological — ход, задевающий все semantic-правила
 * сразу. Оба текста детерминированы и не содержат ничего из when.none.
 */
export function scenarioTexts(rules) {
  const forbidden = forbiddenLiterals(rules);
  const clean = (text) => !forbidden.has(text.toLowerCase());

  const triggers = [];
  for (const rule of rules) {
    for (const literal of triggerLiterals(rule)) {
      if (clean(literal)) triggers.push(literal);
    }
  }

  const baseline =
    "обычный ход оператора без единого триггера, только текст задачи";
  if (!clean(baseline)) throw new Error("baseline-text-forbidden");

  return {
    baseline: [baseline],
    pathological: [triggers.join(" ")],
  };
}
