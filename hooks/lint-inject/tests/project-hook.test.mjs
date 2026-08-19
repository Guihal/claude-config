import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runColdForFiles } from "../cold-runner.ts";
import { applyHook, findHook } from "../hook.ts";
import { planFor } from "../linters/index.ts";

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "claude-hook-")); mkdirSync(path.join(root, ".git")); return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755);
}

async function rewrite(file, content) {
  await new Promise((resolve) => setTimeout(resolve, 20)); writeFileSync(file, content);
}

test("nearest hook cancels, overrides, and rejects invalid daemon plans", async () => {
  const root = project(); const file = path.join(root, "src/x.ts"); mkdirSync(path.dirname(file)); writeFileSync(file, ""); const config = path.join(root, "lint-inject.config.ts");
  writeFileSync(config, "export default () => null;\n"); assert.equal(findHook(file), config); assert.deepEqual((await applyHook(file, planFor(file))).plan.cold, []);
  await rewrite(config, "export default (_f, p) => ({ cold: p.cold.slice(0, 1) });\n"); assert.equal((await applyHook(file, planFor(file))).plan.cold.length, 1);
  await rewrite(config, "export default (_f, p) => ({ cold: p.cold, daemon: { ...p.daemon, args: ['--noEmit','--watch','--pretty','false'] } });\n");
  const valid = await applyHook(file, planFor(file)); assert.deepEqual(valid.plan.daemon.args, ["--noEmit", "--watch", "--pretty", "false"]); assert.equal(valid.plan.daemon.autoConfig.file, "tsconfig.json");
  await rewrite(config, "export default (_f, p) => ({ cold: p.cold, daemon: { bin: 'tsc', args: ['--noEmit'] } });\n");
  const invalid = await applyHook(file, planFor(file)); assert.match(invalid.hookError, /невалидный/); assert.ok(invalid.plan.cold.length > 0);
});

test("throws, invalid returns, and async non-returning calls fail open", async () => {
  const root = project(); const file = path.join(root, "x.js"); writeFileSync(file, ""); const config = path.join(root, "lint-inject.config.ts");
  writeFileSync(config, "export default () => { throw new Error('boom') };\n"); assert.match((await applyHook(file, planFor(file))).hookError, /boom/);
  await rewrite(config, "export default () => ({ nope: true });\n"); assert.match((await applyHook(file, planFor(file))).hookError, /невалидный/);
  await rewrite(config, "export default () => new Promise(() => {});\n"); const started = Date.now(); const timeout = await applyHook(file, planFor(file));
  assert.ok(Date.now() - started < 1_200); assert.match(timeout.hookError, /timeout 1000ms/); assert.ok(timeout.plan.cold.length > 0);
});

test("top-level await load timeout shares one second deadline and fails open", async () => {
  const root = project(); const file = path.join(root, "x.js"); writeFileSync(file, ""); const config = path.join(root, "lint-inject.config.ts");
  writeFileSync(config, "await new Promise(() => {}); export default (_f, p) => p;\n");
  const started = Date.now(); const result = await applyHook(file, planFor(file)); const elapsed = Date.now() - started;
  assert.ok(elapsed >= 900 && elapsed < 1_200, `elapsed=${elapsed}`); assert.match(result.hookError, /не загрузился: timeout 1000ms/); assert.ok(result.plan.cold.length > 0);
});

test("slow load plus hanging call uses one shared deadline", async () => {
  const root = project(); const file = path.join(root, "x.js"); writeFileSync(file, ""); const config = path.join(root, "lint-inject.config.ts");
  writeFileSync(config, "await new Promise((resolve) => setTimeout(resolve, 700)); export default () => new Promise(() => {});\n");
  const started = Date.now(); const result = await applyHook(file, planFor(file)); const elapsed = Date.now() - started;
  assert.ok(elapsed >= 900 && elapsed < 1_200, `elapsed=${elapsed}`); assert.match(result.hookError, /хук упал: timeout 1000ms/); assert.ok(result.plan.cold.length > 0);
});

test("custom hook daemon fields reach bounded cold typecheck", async () => {
  const root = project(); const file = path.join(root, "x.ts"); writeFileSync(file, "export const x = 1;\n"); const config = path.join(root, "lint-inject.config.ts"); const argsFile = path.join(root, "args");
  executable(path.join(root, "node_modules/.bin/eslint"), "printf '[]'"); executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  executable(path.join(root, "node_modules/.bin/tsc"), `test -f "$PWD/custom-tsconfig.json" || exit 9; printf '%s\\n' "$@" > '${argsFile}'; exit 2`);
  writeFileSync(config, `export default (_f, p) => ({ cold: p.cold, daemon: {
    bin: "tsc", args: ["--watch", "true", "-w", "false", "--watch=true", "--preserveWatchOutput=false", "--watch", "src/file.ts", "--custom-flag"],
    parse: () => [{ absPath: ${JSON.stringify(file)}, line: 1, col: 1, severity: "error", msg: "custom type", rule: "CUSTOM" }],
    autoConfig: { file: "custom-tsconfig.json", content: "// AUTO-GENERATED-BY-LINT-INJECT\\n{}\\n", configNames: ["custom-tsconfig.json"] }
  } });\n`);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], { budgetMs: 2_000, coldLinterMs: 1_000, changeWaitMs: 0 });
  assert.match(report, /custom type/); const args = readFileSync(argsFile, "utf8").trim().split("\n");
  assert.deepEqual(args, ["src/file.ts", "--custom-flag", "--noEmit", "--pretty", "false"]);
  assert.equal(existsSync(path.join(root, "custom-tsconfig.json")), false);
});
