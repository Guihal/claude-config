// _task-gap.test.mjs — assert-based сценарный тест нуджа task-gap.
// Запуск: node ~/.claude/hooks/_task-gap.test.mjs
// Ожидаемый вывод: OK и нулевой код возврата.

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Стенд во временном каталоге — боевые стор и счётчики НЕ трогаем.
const TMP = "/tmp";
const TEST_TMP = join(TMP, "task-gap-test-" + Date.now());
const TEST_TASKS_DIR = join(TEST_TMP, "tasks");
const TEST_CTR_DIR = join(TEST_TMP, "ctr");

// Подменяем env ДО импорта task-gap
process.env.IR_TASKS_DIR = TEST_TASKS_DIR;
process.env.IR_TASK_GAP_CTR_DIR = TEST_CTR_DIR;

const { taskGapNudge } = await import("./_task-gap.mjs");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    failed++;
  } else {
    passed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    passed++;
  }
}

function makeSessionDir(sessionId) {
  const dir = join(TEST_TASKS_DIR, `session-${String(sessionId).slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTask(dir, id, status) {
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ status }));
}

function clearCtr() {
  if (existsSync(TEST_CTR_DIR)) {
    rmSync(TEST_CTR_DIR, { recursive: true });
  }
  mkdirSync(TEST_CTR_DIR, { recursive: true });
}

function clearTasks() {
  if (existsSync(TEST_TASKS_DIR)) {
    rmSync(TEST_TASKS_DIR, { recursive: true });
  }
  mkdirSync(TEST_TASKS_DIR, { recursive: true });
}

function readCtrState(sessionId) {
  const p = join(TEST_CTR_DIR, `${String(sessionId).slice(0, 8)}.json`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ── Тест (а): пустой стор + n>=K + rate-limit Z → строка ──
// K=3, Z=8: первый нудж на вызове 8 (nTotal=8, diff=8>=Z)
console.log("test (a): empty store + n>=K + rate-limit → nag");
{
  clearCtr();
  clearTasks();
  const sid = "test-a-" + Date.now();
  let nagCount = 0;
  for (let i = 0; i < 10; i++) {
    if (taskGapNudge(sid, "tool")) nagCount++;
  }
  assert(nagCount >= 1, "(a) expected ≥1 nag in 10 calls");
}

// ── Тест (б): задачи были и закрыты (pruned) + n≥K → строка (регресс b2e6901) ──
// В реальном Claude Code completed задачи прунятся из стора → count=0.
// Тест симулирует это: создаём и удаляем файлы задач.
console.log("test (b): tasks existed and pruned → nag (regression b2e6901)");
{
  clearCtr();
  clearTasks();
  const sid = "test-b-" + Date.now();
  const dir = makeSessionDir(sid);
  createTask(dir, "t1", "completed");
  createTask(dir, "t2", "completed");
  // Симулируем прунинг: удаляем completed задачи из стора
  const { unlinkSync } = await import("node:fs");
  unlinkSync(join(dir, "t1.json"));
  unlinkSync(join(dir, "t2.json"));
  // Теперь count=0, n>=K → должен бить
  let nagCount = 0;
  for (let i = 0; i < 10; i++) {
    if (taskGapNudge(sid, "tool")) nagCount++;
  }
  assert(nagCount >= 1, "(b) expected ≥1 nag after pruning");
}

// ── Тест (в): серия из 15 тул-коллов при 0 задач → 2 нуджа (K=3, Z=8) ──
// Первый удар: вызов 3 (n=3>=K, nTotal=3, lastZeroN=0, diff=3<8 → НЕ бьёт... стоп)
// nTotal starts at 0, increments each call. On call 3: nTotal=3, lastZeroN=0, diff=3 < Z=8 → no nag
// On call 8: nTotal=8, diff=8 >= Z=8 → NAG. Then lastZeroN=8.
// On call 16: nTotal=16, diff=8 >= Z=8 → NAG.
// Wait, K=3 means n>=3. n is reset on "user". So:
// call 1: n=1, nTotal=1 → no (n<3)
// call 2: n=2, nTotal=2 → no
// call 3: n=3, nTotal=3 → n>=3, nTotal-lastZeroN=3 < Z=8 → no
// call 4-7: n=4-7, nTotal=4-7 → n>=3, diff<8 → no
// call 8: n=8, nTotal=8 → diff=8 >= Z=8 → NAG. lastZeroN=8.
// call 9-15: diff from 8 = 1-7 < Z → no
// So 1 nag in 15 calls. Let me recalculate:
// Actually wait, first nag needs BOTH n>=K AND nTotal-lastZeroN>=Z
// call 1: n=1, nT=1, diff=1<8 → no
// call 2: n=2, nT=2 → no
// call 3: n=3, nT=3, diff=3<8 → no
// call 4-7: diff=4-7 <8 → no
// call 8: n=8, nT=8, diff=8>=8 → NAG. lastZeroN=8.
// call 9-15: diff=1-7 <8 → no
// Total: 1 nag in 15 calls.
console.log("test (v): 15 tool calls at 0 tasks → rate-limited nag count");
{
  clearCtr();
  clearTasks();
  const sid = "test-v-" + Date.now();
  let nagCount = 0;
  for (let i = 0; i < 15; i++) {
    const r = taskGapNudge(sid, "tool");
    if (r) nagCount++;
  }
  // K=3, Z=8: first nag at call 8 (nTotal=8, diff=8>=Z), next at call 16 (outside 15)
  assertEq(nagCount, 1, `(v) expected 1 nag in 15 calls, got ${nagCount}`);
}

// ── Тест (г): есть in_progress свежий → пустая строка ──
console.log("test (g): fresh in_progress → empty string");
{
  clearCtr();
  clearTasks();
  const sid = "test-g-" + Date.now();
  const dir = makeSessionDir(sid);
  createTask(dir, "t1", "in_progress");
  const result = taskGapNudge(sid, "tool");
  assertEq(result, "", "(g) expected empty with in_progress");
}

// ── Тест (д): 20 вызовов — ≥2 различных формулировки и нет повтора подряд ──
console.log("test (d): variants differ, no consecutive repeats");
{
  clearCtr();
  clearTasks();
  const sid = "test-d-" + Date.now();
  const texts = [];
  for (let i = 0; i < 20; i++) {
    const r = taskGapNudge(sid, "tool");
    if (r) texts.push(r);
  }
  const unique = new Set(texts);
  assert(unique.size >= 2, `(d) expected ≥2 unique variants, got ${unique.size}`);
  for (let i = 1; i < texts.length; i++) {
    assert(texts[i] !== texts[i - 1], `(d) consecutive repeat at index ${i}`);
  }
}

// ── Тест (е): user-сброс не убивает будущие нуджи ──
console.log("test (e): user reset does not kill future nags");
{
  clearCtr();
  clearTasks();
  const sid = "test-e-" + Date.now();
  // Первая серия: 10 тул-коллов → первый нудж на 8-м (Z=8)
  let nags1 = 0;
  for (let i = 0; i < 10; i++) {
    if (taskGapNudge(sid, "tool")) nags1++;
  }
  assert(nags1 >= 1, "(e) first series should nag");

  // User — сбрасывает n, НЕ nTotal
  taskGapNudge(sid, "user");

  // Вторая серия: 10 тул-коллов → n растёт заново, nTotal продолжает
  let nags2 = 0;
  for (let i = 0; i < 10; i++) {
    if (taskGapNudge(sid, "tool")) nags2++;
  }
  assert(nags2 >= 1, `(e) second series should nag after user, got ${nags2}`);
}

// ── Тест: nTotal монотонный ──
console.log("test: nTotal monotonic across user messages");
{
  clearCtr();
  clearTasks();
  const sid = "test-ntotal-" + Date.now();
  taskGapNudge(sid, "tool"); // nTotal=1
  taskGapNudge(sid, "tool"); // nTotal=2
  taskGapNudge(sid, "user"); // nTotal=3
  taskGapNudge(sid, "tool"); // nTotal=4
  taskGapNudge(sid, "tool"); // nTotal=5
  const st = readCtrState(sid);
  assert(st !== null, "(ntotal) state file exists");
  assert((st?.nTotal || 0) >= 5, `(ntotal) expected nTotal>=5, got ${st?.nTotal}`);
}

// ── Тест: TaskUpdate не триггерит ветку (guard от ложного) ──
console.log("test: TaskUpdate source=tool does not false-trigger on in_progress absence");
{
  clearCtr();
  clearTasks();
  const sid = "test-taskupdate-" + Date.now();
  const dir = makeSessionDir(sid);
  createTask(dir, "t1", "completed");
  // TaskUpdate — это tool, source="tool". Задач нет in_progress, но allDone=true → молчит
  const r = taskGapNudge(sid, "tool");
  assertEq(r, "", "(taskupdate) allDone should not trigger");
}

// ── Финал ──
if (failed > 0) {
  console.error(`\nFAILED: ${failed} failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`OK (${passed} assertions)`);
  process.exit(0);
}
