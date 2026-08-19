import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runColdForFiles } from "../cold-runner.ts";

function project(prefix = "claude-job-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, ".git", "info"), { recursive: true });
  writeFileSync(path.join(root, ".git/info/exclude"), "# keep-without-newline");
  return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755);
}

function assertClean(root) {
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
  assert.equal(existsSync(path.join(root, "tsconfig.json")), false);
  assert.equal(readFileSync(path.join(root, ".git/info/exclude"), "utf8"), "# keep-without-newline");
}

test("timed-out ESLint releases generated config and exact exclude bytes", async () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n");
  executable(path.join(root, "node_modules/.bin/eslint"), "sleep 2; printf '[]'");
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  await runColdForFiles([{ abs: file, editedAt: Date.now() }], { budgetMs: 180, coldLinterMs: 100, changeWaitMs: 0 });
  assertClean(root);
});

test("timed-out tsc releases both generated configs", async () => {
  const root = project(); const file = path.join(root, "bad.ts"); writeFileSync(file, "export const x = 1;\n");
  executable(path.join(root, "node_modules/.bin/eslint"), "printf '[]'");
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  executable(path.join(root, "node_modules/.bin/tsc"), "sleep 2");
  await runColdForFiles([{ abs: file, editedAt: Date.now() }], { budgetMs: 220, coldLinterMs: 100, changeWaitMs: 0 });
  assertClean(root);
});

test("nested user tsconfig wins and sets the typecheck cwd", async () => {
  const root = project(); const packageRoot = path.join(root, "packages/app"); const file = path.join(packageRoot, "src/bad.ts"); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'const x: number = "bad";\n');
  const config = path.join(packageRoot, "tsconfig.json"); const content = '{"compilerOptions":{"strict":true}}\n'; writeFileSync(config, content);
  const cwdLog = path.join(root, "cwd"); executable(path.join(root, "node_modules/.bin/eslint"), "printf '[]'"); executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  executable(path.join(root, "node_modules/.bin/tsc"), `pwd > '${cwdLog}'; printf 'src/bad.ts(1,7): error TS2322: bad type\\n'; exit 2`);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], { budgetMs: 2_000, coldLinterMs: 1_000, changeWaitMs: 0 });
  assert.match(report, /TS2322/); assert.equal(readFileSync(cwdLog, "utf8").trim(), packageRoot);
  assert.equal(readFileSync(config, "utf8"), content); assert.equal(existsSync(path.join(root, "tsconfig.json")), false);
});

test("bounded worker pool runs at most three cold jobs concurrently", async () => {
  const root = project(); const extensions = [".json", ".html", ".md", ".yaml"];
  for (const [index, ext] of extensions.entries()) writeFileSync(path.join(root, `x${index}${ext}`), "{}\n");
  for (const bin of ["prettier", "markdownlint", "yamllint"]) executable(path.join(root, `node_modules/.bin/${bin}`), "sleep 0.2; exit 0");
  const files = extensions.map((ext, index) => path.join(root, `x${index}${ext}`)); const started = Date.now();
  await runColdForFiles(files.map((abs) => ({ abs, editedAt: Date.now() })), { budgetMs: 2_000, coldLinterMs: 1_000, changeWaitMs: 0 });
  const elapsed = Date.now() - started; assert.ok(elapsed >= 180, `too fast: ${elapsed}`); assert.ok(elapsed < 800, `not bounded-parallel: ${elapsed}`);
});

test("parser failure is advisory and cleanup still runs", async () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n");
  executable(path.join(root, "node_modules/.bin/eslint"), "printf 'not-json' >&2; exit 2"); executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], { budgetMs: 1_000, coldLinterMs: 500, changeWaitMs: 0 });
  assert.match(report, /вывод не распарсен: not-json/); assertClean(root);
});
