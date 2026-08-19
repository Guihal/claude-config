import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  acquireAutoConfig, findUserConfig, releaseAutoConfig, writeExclusiveConfig,
} from "../auto-config.ts";
import { AUTO_MARKER, ESLINT_CONFIG_DEFAULT } from "../auto-config-definitions.ts";
import { ensureOwnedExclude, removeOwnedExclude } from "../git-exclude.ts";
import { ownersDirectory, withRootLock } from "../lease-lock.ts";
import { runColdForFiles } from "../cold-runner.ts";

const TIMINGS = { budgetMs: 3_000, coldLinterMs: 1_500, changeWaitMs: 0 };
const autoModule = pathToFileURL(new URL("../auto-config.ts", import.meta.url).pathname).href;
const definitionsModule = pathToFileURL(new URL("../auto-config-definitions.ts", import.meta.url).pathname).href;

function project(prefix = "claude-auto-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, ".git", "info"), { recursive: true });
  return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function cleanPrettier(root) {
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
}

function completed(child) {
  return new Promise((resolve, reject) => {
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("generated ESLint config exists during lint and cleanup restores exact Git bytes", async () => {
  const root = project(); const file = path.join(root, "src/bad.js"); mkdirSync(path.dirname(file)); writeFileSync(file, "const unused = 1;\n");
  const exclude = path.join(root, ".git/info/exclude"); const original = "# keep-without-newline"; writeFileSync(exclude, original);
  executable(path.join(root, "node_modules/.bin/eslint"), `test -f "$PWD/eslint.config.mjs" || exit 9
grep -q ${AUTO_MARKER} "$PWD/eslint.config.mjs" || exit 8
printf '[{"filePath":"${file}","messages":[{"line":1,"column":7,"severity":1,"message":"unused","ruleId":"no-unused-vars"}]}]'
exit 1`);
  cleanPrettier(root);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS);
  assert.match(report, /\[lint-inject\] eslint:/); assert.match(report, /no-unused-vars/);
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
  assert.equal(readFileSync(exclude, "utf8"), original);
});

test("user ESLint config remains byte-for-byte authoritative", async () => {
  const root = project(); const file = path.join(root, "x.js"); writeFileSync(file, "export {};\n");
  const config = path.join(root, "eslint.config.mjs"); const content = "export default [{ rules: {} }];\n"; writeFileSync(config, content);
  executable(path.join(root, "node_modules/.bin/eslint"), "test -f \"$PWD/eslint.config.mjs\" || exit 9\nprintf '[]'"); cleanPrettier(root);
  assert.equal(await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS), undefined);
  assert.equal(readFileSync(config, "utf8"), content);
});

test("generated tsconfig drives cold non-watch tsc and is removed", async () => {
  const root = project(); const file = path.join(root, "bad.ts"); writeFileSync(file, 'const value: number = "bad";\n');
  const argsFile = path.join(root, "args"); executable(path.join(root, "node_modules/.bin/eslint"), "printf '[]'"); cleanPrettier(root);
  executable(path.join(root, "node_modules/.bin/tsc"), `test -f "$PWD/tsconfig.json" || exit 9
grep -q ${AUTO_MARKER} "$PWD/tsconfig.json" || exit 8
printf '%s\n' "$@" > '${argsFile}'
printf 'bad.ts(1,7): error TS2322: bad type\n'; exit 2`);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS);
  assert.match(report, /\[lint-inject\] tsc:/); assert.match(report, /TS2322/);
  const args = readFileSync(argsFile, "utf8"); assert.match(args, /--noEmit/); assert.doesNotMatch(args, /--watch|--preserveWatchOutput/);
  assert.equal(existsSync(path.join(root, "tsconfig.json")), false);
});

test("missing binaries never create defaults", async () => {
  const root = project(); const file = path.join(root, "bad.ts"); writeFileSync(file, "export {};\n");
  const previous = process.env.PATH; process.env.PATH = "";
  try { assert.equal(await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS), undefined); }
  finally { process.env.PATH = previous; }
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
  assert.equal(existsSync(path.join(root, "tsconfig.json")), false);
});

test("exclusive create preserves a user config that wins the lock race", async () => {
  const root = project(); const config = path.join(root, "eslint.config.mjs"); let child;
  const code = `import {acquireAutoConfig} from ${JSON.stringify(autoModule)}; import {ESLINT_CONFIG_DEFAULT} from ${JSON.stringify(definitionsModule)}; const u=await acquireAutoConfig(process.argv[1],ESLINT_CONFIG_DEFAULT); process.stdout.write(JSON.stringify({available:u.isAvailable,leased:!!u.lease}));`;
  await withRootLock(root, async () => {
    child = spawn(process.execPath, ["--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(config, "export default [];\n", { flag: "wx" });
  });
  const result = await completed(child); assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), { available: true, leased: false });
  assert.equal(readFileSync(config, "utf8"), "export default [];\n");
});

test("realpath aliases share owners and final release performs cleanup", async () => {
  const root = project(); const alias = `${root}-alias`; symlinkSync(root, alias, "dir");
  const first = await acquireAutoConfig(root, ESLINT_CONFIG_DEFAULT); const second = await acquireAutoConfig(alias, ESLINT_CONFIG_DEFAULT);
  assert.ok(first.lease); assert.ok(second.lease); await releaseAutoConfig(first.lease);
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), true);
  await releaseAutoConfig(second.lease); assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("dead owner is pruned when a live owner adopts the orphan", async () => {
  const root = project(); const config = path.join(root, "eslint.config.mjs");
  const code = `import {acquireAutoConfig} from ${JSON.stringify(autoModule)}; import {ESLINT_CONFIG_DEFAULT} from ${JSON.stringify(definitionsModule)}; const u=await acquireAutoConfig(process.argv[1],ESLINT_CONFIG_DEFAULT); process.stdout.write(String(!!u.lease)); process.exit(0);`;
  const orphan = await completed(spawn(process.execPath, ["--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] }));
  assert.equal(orphan.stdout, "true"); assert.equal(existsSync(config), true);
  const adopted = await acquireAutoConfig(root, ESLINT_CONFIG_DEFAULT); assert.ok(adopted.lease); await releaseAutoConfig(adopted.lease);
  assert.equal(existsSync(config), false);
});

test("ordinary, linked-worktree, and submodule excludes are restored", async () => {
  const cases = [];
  const ordinary = project("claude-git-ordinary-"); cases.push([ordinary, path.join(ordinary, ".git/info/exclude")]);
  const linked = mkdtempSync(path.join(tmpdir(), "claude-git-linked-")); const worktreeGit = path.join(linked, "meta/worktrees/w"); const common = path.join(linked, "meta"); mkdirSync(path.join(common, "info"), { recursive: true }); mkdirSync(worktreeGit, { recursive: true }); writeFileSync(path.join(linked, ".git"), `gitdir: ${worktreeGit}\n`); writeFileSync(path.join(worktreeGit, "commondir"), "../..\n"); cases.push([linked, path.join(common, "info/exclude")]);
  const submodule = mkdtempSync(path.join(tmpdir(), "claude-git-submodule-")); const subGit = path.join(submodule, "module-git"); mkdirSync(path.join(subGit, "info"), { recursive: true }); writeFileSync(path.join(submodule, ".git"), `gitdir: ${subGit}\n`); cases.push([submodule, path.join(subGit, "info/exclude")]);
  for (const [root, exclude] of cases) {
    const original = "# keep\n"; writeFileSync(exclude, original);
    const use = await acquireAutoConfig(root, ESLINT_CONFIG_DEFAULT); assert.ok(use.lease); assert.notEqual(readFileSync(exclude, "utf8"), original);
    await releaseAutoConfig(use.lease); assert.equal(readFileSync(exclude, "utf8"), original);
  }
});

test("pre-existing path and unrelated marker bytes are never claimed", async () => {
  const root = project(); const exclude = path.join(root, ".git/info/exclude"); const original = "# unrelated\neslint.config.mjs\n# lint-inject-auto:foreign:plain\nforeign.json\n"; writeFileSync(exclude, original);
  const use = await acquireAutoConfig(root, ESLINT_CONFIG_DEFAULT); assert.ok(use.lease); await releaseAutoConfig(use.lease);
  assert.equal(readFileSync(exclude, "utf8"), original);
});

test("partial exclusive writes remove only their own inode", () => {
  const root = project(); const config = path.join(root, "eslint.config.mjs");
  assert.throws(() => writeExclusiveConfig(config, `// ${AUTO_MARKER}\n`, (fd, content) => { writeFileSync(fd, content.slice(0, 4)); throw new Error("write failed"); }), /write failed/);
  assert.equal(existsSync(config), false);
  assert.throws(() => writeExclusiveConfig(config, `// ${AUTO_MARKER}\n`, (fd) => { writeFileSync(fd, "partial"); unlinkSync(config); writeFileSync(config, "export default [];\n", { flag: "wx" }); throw new Error("replacement"); }), /replacement/);
  assert.equal(readFileSync(config, "utf8"), "export default [];\n");
});

test("exclusive create and exclude prefix collisions preserve user bytes", () => {
  const root = project(); const config = path.join(root, "eslint.config.mjs"); writeFileSync(config, "export default [];\n", { flag: "wx" });
  assert.equal(findUserConfig(root, ESLINT_CONFIG_DEFAULT), config); assert.equal(writeExclusiveConfig(config, `// ${AUTO_MARKER}\n`), false);
  unlinkSync(config); const exclude = path.join(root, ".git/info/exclude"); writeFileSync(exclude, ""); ensureOwnedExclude(root, config);
  const collision = `prefix${readFileSync(exclude, "utf8")}`; writeFileSync(exclude, collision); removeOwnedExclude(root, config);
  assert.equal(readFileSync(exclude, "utf8"), collision);
});

test("owner registration failure rolls back config and owned exclude", async () => {
  const root = project(); const config = path.join(root, "eslint.config.mjs"); const owners = ownersDirectory(config); const exclude = path.join(root, ".git/info/exclude"); const original = "# keep\n"; writeFileSync(exclude, original);
  mkdirSync(path.dirname(owners), { recursive: true }); writeFileSync(owners, "blocks directory");
  const use = await acquireAutoConfig(root, ESLINT_CONFIG_DEFAULT); assert.equal(use.isAvailable, false);
  assert.equal(existsSync(config), false); assert.equal(readFileSync(exclude, "utf8"), original); unlinkSync(owners);
});
