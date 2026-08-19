import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const BUN = "/home/penis/.bun/bin/bun";
const WRAPPER = new URL("../../lint-inject-posttoolbatch.mjs", import.meta.url).pathname;

function project(prefix = "claude-wrapper-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix)); mkdirSync(path.join(root, ".git", "info"), { recursive: true }); return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755);
}

function payload(files, toolName = "Edit") {
  return JSON.stringify({ tool_calls: files.map((file) => ({ tool_name: toolName, tool_input: { file_path: file } })) });
}

function completed(child, input) {
  return new Promise((resolve, reject) => {
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (status) => resolve({ status, stdout, stderr })); child.stdin.end(input);
  });
}

function wrapper(input, options = {}) {
  return spawnSync(BUN, [WRAPPER], { input, encoding: "utf8", timeout: 5_000, ...options });
}

function fakeEslint(root, file, extra = "") {
  const calls = path.join(root, "calls");
  executable(path.join(root, "node_modules/.bin/eslint"), `${extra}
test -f "$PWD/eslint.config.mjs" || exit 9
printf 'call\\n' >> '${calls}'
printf '[{"filePath":"${file}","messages":[{"line":1,"column":1,"severity":1,"message":"unused","ruleId":"no-unused-vars"}]}]'; exit 1`);
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  return calls;
}

test("malformed, irrelevant, relative, and skipped payloads stay silent and exit zero", () => {
  for (const input of ["{", "{}", payload(["relative.js"]), payload(["/tmp/node_modules/x.js"]), payload(["/tmp/x.js"], "Read")]) {
    const result = wrapper(input); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  }
});

test("wrapper deduplicates writes and emits Claude PostToolBatch context", () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "const unused = 1;\n"); const calls = fakeEslint(root, file);
  const input = JSON.stringify({ tool_calls: [
    { tool_name: "Edit", tool_input: { file_path: file } },
    { tool_name: "Write", tool_input: { file_path: file } },
    { tool_name: "NotebookEdit", tool_input: { file_path: file } },
  ] });
  const result = wrapper(input); assert.equal(result.status, 0, result.stderr); const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "PostToolBatch"); assert.match(output.hookSpecificOutput.additionalContext, /no-unused-vars/);
  assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 1); assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("overlapping Bun wrappers retain config until both linters finish", async () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n"); const log = path.join(root, "overlap");
  executable(path.join(root, "node_modules/.bin/eslint"), `printf 'start\\n' >> '${log}'; test -f "$PWD/eslint.config.mjs" || exit 9; sleep 0.4; test -f "$PWD/eslint.config.mjs" || exit 8; printf 'end\\n' >> '${log}'; printf '[]'`);
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  const first = completed(spawn(BUN, [WRAPPER], { stdio: ["pipe", "pipe", "pipe"] }), payload([file])); await new Promise((resolve) => setTimeout(resolve, 60));
  const second = completed(spawn(BUN, [WRAPPER], { stdio: ["pipe", "pipe", "pipe"] }), payload([file])); const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 0); assert.equal(b.status, 0); assert.doesNotMatch(a.stdout + b.stdout, /вывод не распарсен/);
  const lines = readFileSync(log, "utf8").trim().split("\n"); assert.equal(lines.filter((line) => line === "start").length, 2); assert.equal(lines.filter((line) => line === "end").length, 2);
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("async hook timeout keeps advisory and fallback ESLint diagnostics", () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "const unused = 1;\n"); fakeEslint(root, file);
  writeFileSync(path.join(root, "lint-inject.config.ts"), "export default () => new Promise(() => {});\n");
  const result = wrapper(payload([file])); assert.equal(result.status, 0, result.stderr); const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, /\[lint-inject\] hook:.*timeout 1000ms/); assert.match(text, /\[lint-inject\] eslint:/); assert.match(text, /no-unused-vars/);
});

test("slow module load plus hanging call shares deadline and preserves fallback lint", () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "const unused = 1;\n"); fakeEslint(root, file);
  writeFileSync(path.join(root, "lint-inject.config.ts"), "await new Promise((resolve) => setTimeout(resolve, 700)); export default () => new Promise(() => {});\n");
  const started = Date.now(); const result = wrapper(payload([file])); const elapsed = Date.now() - started; assert.equal(result.status, 0, result.stderr); assert.ok(elapsed < 1_800, `elapsed=${elapsed}`);
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext; assert.match(text, /timeout 1000ms/); assert.match(text, /no-unused-vars/);
});

test("synchronous infinite hook is terminated by outer watchdog", () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n"); writeFileSync(path.join(root, "lint-inject.config.ts"), "for (;;) {}\nexport default (_f, p) => p;\n");
  const started = Date.now(); const result = wrapper(payload([file]), { timeout: 3_000 }); const elapsed = Date.now() - started;
  assert.equal(result.status, 0, result.stderr); assert.ok(elapsed >= 1_100 && elapsed < 2_500, `elapsed=${elapsed}`);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /\[lint-inject\] hook: хук упал: timeout 1000ms/);
});

test("synchronous infinite exported hook call is outer-killed with advisory only", () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n"); writeFileSync(path.join(root, "lint-inject.config.ts"), "export default () => { for (;;) {} };\n");
  const started = Date.now(); const result = wrapper(payload([file]), { timeout: 3_000 }); const elapsed = Date.now() - started;
  assert.equal(result.status, 0, result.stderr); assert.ok(elapsed >= 1_100 && elapsed < 2_500, `elapsed=${elapsed}`);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, "[lint-inject] hook: хук упал: timeout 1000ms");
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("worker exit error remains fail-open and terminates promptly", () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n"); writeFileSync(path.join(root, "lint-inject.config.ts"), "process.exit(7); export default (_f, p) => p;\n");
  const started = Date.now(); const result = wrapper(payload([file])); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.ok(Date.now() - started < 1_000);
});
