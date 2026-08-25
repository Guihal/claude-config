#!/usr/bin/env node
/* eslint-disable no-console -- CLI-инструмент: печать отчёта и есть его продукт */
// Линтер вариантов формулировок.
//
// Зачем инструмент, а не «глазами»: каталог из трёх десятков правил, у каждого несколько
// вариантов текста, и требования к ним механические — ядро сохранено, ор на месте, варианты не
// сливаются, длина не разъехалась. Сверять это руками на каждой итерации ревью нельзя.
//
// Каталог берётся у движка (`RULES_DIR`), а не своей копией пути: прогон на стенде
// (`RULES_DIR=/tmp/...`) обязан читать стенд, а не боевые правила.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { RULES_DIR } from "../core.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));

// Порог схожести вариантов по ОЧИЩЕННОЙ шкале (без якорей `_core` и стоп-слов).
//
// Откуда число. Калибровка прогоном `--report-similarity` на пилоте из трёх правил
// (`50-task-list` — длинный суффикс, `62-edit-discipline` — средний, `61-repo-hygiene` —
// короткий), по 3 заведомо РАЗЛИЧНЫХ варианта плюс контрольный негатив (вариант 0 с
// переставленными словами и заменой пары связок):
//   различные варианты, очищенная шкала: 50 → 0.41 / 0.34 / 0.27; 62 → 0.37 / 0.31 / 0.12;
//                                        61 → 0.57 / 0.38 / 0.28  → максимум 0.57;
//   контрольный негатив против своего оригинала: 1.00 у всех трёх правил.
// Порог 0.70 лежит с запасом выше максимума честных вариантов (0.57) и заведомо ниже клише.
// Верхнюю границу честных пар задаёт КОРОТКИЙ суффикс: на 190 символах общий словарь
// неизбежен, и порог строже 0.65 валил бы корректно написанные варианты.
// Двигать число можно только новым прогоном `--report-similarity`, а не «на глаз».
const SIM_MAX = 0.7;

// Первые N символов вариантов обязаны различаться: одинаковое начало съедает эффект
// вариативности раньше, чем агент дочитает до различий.
const HEAD_CHARS = 40;

// Разброс длины вариантов относительно эталона (первого). Вариант вдвое длиннее эталона —
// провал: суффикс живёт в пер-тиковом бюджете, а не в отдельном.
const LENGTH_TOLERANCE = 0.3;

// Минимум подряд идущих ЗАГЛАВНЫХ БУКВ в «орущем» фрагменте. Пробелы и знаки препинания внутри
// фрагмента не прерывают его: «СДАЁШЬ РАБОЧИЙ ПРОДУКТ» — один КАПС-заголовок, хотя каждое слово
// по отдельности короче порога.
const CAPS_MIN_LETTERS = 8;
const CAPS_FRAGMENT = /[A-ZА-ЯЁ]{2,}(?:[\s,.:;!?—–-]+[A-ZА-ЯЁ]{2,})*/g;

const TIERS = ["T0", "T1", "T2", "T3"];

function fail(message) {
  console.error(`[lint-variants] ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    tiers: null,
    rules: [],
    strictCaps: false,
    baseline: null,
    reportSimilarity: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--tier") {
      const raw = argv[++i];
      if (!raw) fail("--tier требует список тиров, например T0,T1");
      args.tiers = raw.split(",").map((t) => t.trim());
      for (const tier of args.tiers)
        if (!TIERS.includes(tier)) fail(`неизвестный тир: ${tier}`);
    } else if (flag === "--rule") {
      const raw = argv[++i];
      if (!raw) fail("--rule требует имя правила");
      args.rules.push(raw);
    } else if (flag === "--strict-caps") args.strictCaps = true;
    else if (flag === "--baseline") {
      const raw = argv[++i];
      if (!raw) fail("--baseline требует git-ref, например HEAD");
      args.baseline = raw;
    } else if (flag === "--report-similarity") args.reportSimilarity = true;
    else
      fail(
        `неизвестный аргумент: ${flag}. Есть --tier, --rule, --strict-caps, --baseline, --report-similarity`,
      );
  }
  return args;
}

function readCatalog() {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      rule: JSON.parse(readFileSync(join(RULES_DIR, file), "utf8")),
    }));
}

/** `string | string[]` → массив вариантов; отсутствие поля → пустой массив. */
function variantsOf(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  throw new Error("variants: unexpected shape");
}

const STOPWORDS = new Set(
  JSON.parse(readFileSync(join(TOOLS_DIR, "stopwords-ru.json"), "utf8")).words,
);

function normalize(text) {
  return text.toLowerCase().replace(/ё/g, "е");
}

function words(text) {
  return normalize(text)
    .split(/[^0-9a-zа-я_-]+/)
    .filter((w) => w.length > 0);
}

/**
 * Множество слов варианта для меры схожести.
 * @param {string} text
 * @param {Set<string>} [drop] — слова якорей `_core` и стоп-слова; при `undefined` не вычитается
 *   ничего (сырая шкала).
 */
function wordSet(text, drop) {
  const set = new Set();
  for (const word of words(text)) {
    if (drop && drop.has(word)) continue;
    set.add(word);
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Якоря ядра правила с проверкой формы. Битое поле не молчит: `_core: "строка"` или пустой
 * элемент дали бы пустой (или бессмысленный) набор якорей, и проверка REQ-8 прошла бы вхолостую
 * — ровно тот отказ, ради которого линтер существует.
 * @param {string} file
 * @param {object} rule
 * @param {string[]} problems — накопитель замечаний прогона.
 * @returns {string[]} якоря; при битой форме — пустой массив (замечание уже записано).
 */
function coreAnchors(file, rule, problems) {
  const core = rule._core;
  if (core === undefined) return [];
  if (
    !Array.isArray(core) ||
    core.some((anchor) => typeof anchor !== "string" || anchor.trim() === "")
  ) {
    problems.push(`${file}: _core должен быть массивом непустых строк`);
    return [];
  }
  return core;
}

/** Слова, которые вычитаются из очищенной шкалы: стоп-слова + лексемы якорей ядра. */
function dropSet(core) {
  const drop = new Set(STOPWORDS);
  for (const anchor of core) for (const word of words(anchor)) drop.add(word);
  return drop;
}

function capsLetters(fragment) {
  return (fragment.match(/[A-ZА-ЯЁ]/g) ?? []).length;
}

function hasShout(text) {
  for (const fragment of text.match(CAPS_FRAGMENT) ?? []) {
    if (capsLetters(fragment) >= CAPS_MIN_LETTERS) return true;
  }
  return false;
}

/** Тег `[NN-name]` в начале текста (после ведущих переводов строки), если он там есть. */
function leadingTag(text) {
  const match = /^\s*(\[[0-9a-z-]+\])/.exec(text);
  return match ? match[1] : null;
}

function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: RULES_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null; // файла в этой ревизии нет — правило новое
  }
}

/** Относительный путь правила внутри репозитория (для `git show <ref>:<path>`). */
function repoPath(file) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: RULES_DIR,
    encoding: "utf8",
  }).trim();
  return resolve(RULES_DIR, file).slice(root.length + 1);
}

function reportSimilarity(catalog) {
  console.log(`каталог: ${RULES_DIR}`);
  for (const { file, rule } of catalog) {
    for (const [field, value] of [
      ["body", rule.body],
      ["suffix", rule.remind?.suffix],
    ]) {
      const list = variantsOf(value);
      if (list.length < 2) continue;
      const drop = dropSet(rule._core ?? []);
      console.log(`\n${file} — ${field}, вариантов ${list.length}`);
      console.log("  пара      сырая  очищенная");
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const raw = jaccard(wordSet(list[i]), wordSet(list[j]));
          const clean = jaccard(wordSet(list[i], drop), wordSet(list[j], drop));
          console.log(
            `  ${i}–${j}       ${raw.toFixed(2)}   ${clean.toFixed(2)}`,
          );
        }
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = readCatalog();
  if (catalog.length === 0) fail(`в каталоге ${RULES_DIR} нет правил`);

  if (args.reportSimilarity) {
    reportSimilarity(catalog);
    return;
  }

  const problems = [];

  // 0. У каждого правила каталога есть `_tier`: без него срез бюджета сортирует `undefined`,
  // а фильтр `--tier` молча теряет правило.
  const tiered = catalog.filter(({ rule }) => TIERS.includes(rule._tier));
  console.log(
    `tier coverage: ${tiered.length}/${catalog.length} rules have _tier`,
  );
  for (const { file, rule } of catalog) {
    if (!TIERS.includes(rule._tier))
      problems.push(`${file}: нет валидного _tier`);
  }

  // 1. Охват вариантами: правило считается покрытым, если варианты есть хотя бы у одного из
  // текстов, которые оно реально доставляет (тело или суффикс).
  const covered = catalog.filter(
    ({ rule }) =>
      variantsOf(rule.body).length >= 2 ||
      variantsOf(rule.remind?.suffix).length >= 2,
  );
  console.log(
    `coverage: ${covered.length}/${catalog.length} rules with variants`,
  );
  for (const { file, rule } of catalog) {
    if (
      variantsOf(rule.body).length < 2 &&
      variantsOf(rule.remind?.suffix).length < 2
    )
      problems.push(`${file}: нет вариантов ни у тела, ни у суффикса`);
  }

  // 2. Ядро, различие, длина, тег — по каждому правилу и каждому его тексту.
  let anchorsOk = true;
  for (const { file, rule } of catalog) {
    const core = coreAnchors(file, rule, problems);
    // Проверка якорей идёт циклом по `core`: у правила с пустым `_core` этот цикл ПУСТ, и REQ-8
    // прошёл бы на любом тексте. Поэтому отсутствие якорей у правила с вариантами — сам по себе
    // провал: «ядро сохранено» нечем доказать, а линтер молча печатал бы `core anchors: ok`.
    const hasVariants =
      variantsOf(rule.body).length >= 2 ||
      variantsOf(rule.remind?.suffix).length >= 2;
    if (hasVariants && core.length === 0) {
      anchorsOk = false;
      problems.push(
        `${file}: ≥2 варианта, но пустой _core — инвариант ядра (REQ-8) проверять нечем`,
      );
    }
    const drop = dropSet(core);
    for (const [field, value] of [
      ["body", rule.body],
      ["suffix", rule.remind?.suffix],
    ]) {
      const list = variantsOf(value);
      if (list.length === 0) continue;

      for (const [index, text] of list.entries()) {
        for (const anchor of core) {
          if (!normalize(text).includes(normalize(anchor))) {
            anchorsOk = false;
            problems.push(
              `${file}: ${field}[${index}] потерял якорь ядра «${anchor}»`,
            );
          }
        }
      }

      const referenceTag = leadingTag(list[0]);
      if (referenceTag) {
        for (const [index, text] of list.entries()) {
          if (leadingTag(text) !== referenceTag)
            problems.push(
              `${file}: ${field}[${index}] не открывается тегом ${referenceTag}`,
            );
        }
      }

      const referenceLength = list[0].length;
      for (const [index, text] of list.entries()) {
        const ratio = Math.abs(text.length - referenceLength) / referenceLength;
        if (ratio > LENGTH_TOLERANCE)
          problems.push(
            `${file}: ${field}[${index}] длина ${text.length} против эталона ${referenceLength} (>${LENGTH_TOLERANCE * 100}%)`,
          );
      }

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const sim = jaccard(wordSet(list[i], drop), wordSet(list[j], drop));
          if (sim >= SIM_MAX)
            problems.push(
              `${file}: ${field}[${i}] и ${field}[${j}] сливаются, схожесть ${sim.toFixed(2)} ≥ ${SIM_MAX}`,
            );
          if (list[i].slice(0, HEAD_CHARS) === list[j].slice(0, HEAD_CHARS))
            problems.push(
              `${file}: ${field}[${i}] и ${field}[${j}] совпадают первыми ${HEAD_CHARS} символами`,
            );
        }
      }
    }
  }
  console.log(`core anchors: ${anchorsOk ? "ok" : "fail"}`);

  // 3. Отбор для проверок ора и минимума вариантов: тиры из --tier плюс поимённые --rule.
  if (args.tiers || args.rules.length > 0) {
    const selected = catalog.filter(
      ({ rule }) =>
        (args.tiers && args.tiers.includes(rule._tier)) ||
        args.rules.includes(rule.name),
    );
    const withThree = selected.filter(
      ({ rule }) =>
        variantsOf(rule.body).length >= 3 ||
        variantsOf(rule.remind?.suffix).length >= 3,
    );
    console.log(`variants: ${withThree.length}/${selected.length} have >=3`);
    for (const { file, rule } of selected) {
      if (
        variantsOf(rule.body).length < 3 &&
        variantsOf(rule.remind?.suffix).length < 3
      )
        problems.push(`${file}: меньше 3 вариантов у важного правила`);
    }

    if (args.strictCaps) {
      let shouting = 0;
      for (const { file, rule } of selected) {
        const texts = [
          ...variantsOf(rule.body),
          ...variantsOf(rule.remind?.suffix),
        ];
        const silent = texts.filter((t) => !hasShout(t));
        if (silent.length === 0) shouting += 1;
        else
          problems.push(
            `${file}: ${silent.length} текст(ов) без КАПС-фрагмента ≥${CAPS_MIN_LETTERS} букв`,
          );
      }
      console.log(`caps: ${shouting}/${selected.length} T0-T1 rules ok`);
    }
  }

  // 4. Сверка с базовой ревизией: что изменилось в эталонах и не поехал ли `_derives`.
  if (args.baseline) {
    const changedReference = [];
    const changedDerives = [];
    for (const { file, rule } of catalog) {
      const raw = gitShow(args.baseline, repoPath(file));
      if (raw === null) continue;
      const old = JSON.parse(raw);
      const pairs = [
        ["body", variantsOf(old.body)[0], variantsOf(rule.body)[0]],
        [
          "suffix",
          variantsOf(old.remind?.suffix)[0],
          variantsOf(rule.remind?.suffix)[0],
        ],
      ];
      for (const [field, before, after] of pairs) {
        if (before !== undefined && before !== after)
          changedReference.push(`${rule.name}:${field}`);
      }
      if (old._derives !== rule._derives) changedDerives.push(rule.name);
    }
    console.log(`reference changed: ${changedReference.join(", ") || "none"}`);
    console.log(`_derives changed: ${changedDerives.join(", ") || "none"}`);
    if (changedDerives.length > 0)
      problems.push(
        `_derives изменился у: ${changedDerives.join(", ")} — правило перестало быть проекцией того же раздела образа`,
      );
  }

  if (problems.length === 0) {
    console.log("VERDICT ok");
  } else {
    console.log(`VERDICT fail\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main();
