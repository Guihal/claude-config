#!/usr/bin/env node
// Port of ~/.pi/agent/extensions/project-structure.ts (pi coding agent extension).
// Two modes:
//   --hook           SessionStart hook: reads {cwd} from stdin, emits additionalContext JSON
//   [path] [-d N]    CLI tool: prints plain tree for path (default cwd)
// Respects .gitignore files (root + nested): ignored entries are shown but
// marked "(ignored)" and never expanded.
//
// Two ignore layers, deliberately different:
//   .gitignore                 → entry is SHOWN as "(ignored, N items)" and not expanded
//   project-structure.ignore   → entry is DROPPED entirely, costs zero lines
// The second layer is what keeps the tree readable: a large tracked directory
// (u24's `backups/`, 22 MB across 33 dirs) is not gitignored, so without it the
// char budget is spent before the source tree is ever reached.
import * as fs from "node:fs";
import * as path from "node:path";

// Always-ignored regardless of .gitignore (.git is never gitignored itself).
const HARD_IGNORED = new Set([".git", "node_modules", "__pycache__", ".idea", ".vscode"]);
const SKIP_FILES = new Set([".DS_Store"]);

const SELF_PATH = new URL(import.meta.url).pathname;
const DEFAULT_DEPTH = 2;
const MAX_CONFIG_DEPTH = 30;
const TREE_CONF = "pj-tree.conf";
const DROP_IGNORE_NAME = "project-structure.ignore";

function shouldSkipFile(name) {
  if (SKIP_FILES.has(name)) return true;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return true;
  return false;
}

// --- drop-list: gitignore-style, matched against a single basename segment ---
// `**/foo` is not supported; list patterns flat. Trailing `/` = dir-only,
// leading `!` re-includes. Last match wins.
function globToSegmentRegex(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const close = glob.indexOf("]", i);
      if (close === -1) out += "\\[";
      else { out += glob.slice(i, close + 1).replace(/\\/g, "\\\\"); i = close; }
    } else if (/[.+^${}()|\\]/.test(c)) out += "\\" + c;
    else out += c;
  }
  return new RegExp(out + "$");
}

function compileDropList(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    let body = raw.trim();
    if (!body || body.startsWith("#")) continue;
    let negate = false, dirOnly = false;
    if (body.startsWith("!")) { negate = true; body = body.slice(1); }
    if (body.endsWith("/")) { dirOnly = true; body = body.slice(0, -1); }
    if (!body) continue;
    try { out.push({ re: globToSegmentRegex(body), dirOnly, negate }); } catch {}
  }
  return out;
}

function loadDropList(absPath) {
  try { return compileDropList(fs.readFileSync(absPath, "utf8")); } catch { return null; }
}

// On any failure the safe-min list still guarantees .git/ and node_modules/.
const SAFE_MIN = compileDropList("node_modules/\n.git/\n");
const GLOBAL_DROP = (() => {
  const loaded = loadDropList(path.join(path.dirname(SELF_PATH), DROP_IGNORE_NAME));
  return loaded && loaded.length ? loaded : SAFE_MIN;
})();

const cwdDropCache = new Map();
function getCwdDrop(dir) {
  const key = path.resolve(dir);
  if (cwdDropCache.has(key)) return cwdDropCache.get(key);
  const loaded = loadDropList(path.join(key, DROP_IGNORE_NAME));
  const result = loaded && loaded.length ? loaded : [];
  cwdDropCache.set(key, result);
  return result;
}

function isDropped(name, isDir, patterns) {
  let dropped = false;
  for (const p of patterns) {
    if (p.dirOnly && !isDir) continue;
    if (!p.re.test(name)) continue;
    dropped = !p.negate;
  }
  return dropped;
}

// --- per-project depth: pj-tree.conf with a single `depth=N` line ---
function resolveDepth(cwd) {
  let text;
  try { text = fs.readFileSync(path.join(cwd, TREE_CONF), "utf8"); } catch { return DEFAULT_DEPTH; }
  let resolved;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0 || line.slice(0, sep).trim() !== "depth") continue;
    const value = line.slice(sep + 1).trim();
    if (!/^\d+$/.test(value)) continue;
    const depth = Number(value);
    if (Number.isSafeInteger(depth) && depth <= MAX_CONFIG_DEPTH) resolved = depth;
  }
  return resolved ?? DEFAULT_DEPTH;
}

// --- minimal .gitignore matcher (last match wins, supports !, /, **, *, ?) ---

function patternToRegex(pattern) {
  // anchored if a slash appears anywhere except the very end
  const anchored = pattern.slice(0, -1).includes("/");
  let p = pattern.replace(/^\//, "");
  let re = "";
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") { re += "(?:[^/]+/)*"; i += 3; }
        else { re += ".*"; i += 2; }
      } else { re += "[^/]*"; i += 1; }
    } else if (c === "?") { re += "[^/]"; i += 1; }
    else { re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&"); i += 1; }
  }
  const prefix = anchored ? "^" : "(?:^|/)";
  return new RegExp(prefix + re + "$");
}

function loadGitignore(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
  } catch {
    return null;
  }
  const rules = [];
  for (let line of text.split("\n")) {
    line = line.replace(/\r$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) { negated = true; line = line.slice(1); }
    let dirOnly = false;
    if (line.endsWith("/")) { dirOnly = true; line = line.slice(0, -1); }
    if (!line) continue;
    rules.push({ regex: patternToRegex(line), negated, dirOnly });
  }
  return rules.length ? { base: dir, rules } : null;
}

// stack of {base, rules}; relPath computed per matcher base; last match wins
function isIgnored(fullPath, isDir, matchers) {
  let ignored = false;
  for (const m of matchers) {
    const rel = path.relative(m.base, fullPath);
    if (rel.startsWith("..")) continue;
    const relPosix = rel.split(path.sep).join("/");
    for (const r of m.rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.regex.test(relPosix)) ignored = !r.negated;
    }
  }
  return ignored;
}

// --- tree builder ---

function ignoredSuffix(dirPath, isDir) {
  if (!isDir) return "  (ignored)";
  try {
    const count = fs.readdirSync(dirPath).length;
    if (count > 0) return `/  (ignored, ${count} items)`;
  } catch {}
  return "/  (ignored)";
}

function buildTree(dir, maxDepth, prefix, lines, charBudget, matchers, dropList) {
  if (lines.join("\n").length > charBudget) {
    if (lines.length > 0 && !lines[lines.length - 1].includes("Truncated")) {
      lines.push(`Truncated. Full tree: node ${SELF_PATH} <path> -d <n>`);
    }
    return -1;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  // Dropped entries are removed BEFORE the indexed loop so the connector math
  // (isEntryLast / childPrefix) stays correct against the visible set.
  entries = entries.filter((e) => !(e.isFile() && shouldSkipFile(e.name)));
  entries = entries.filter((e) => !isDropped(e.name, e.isDirectory(), dropList));

  const localIgnore = loadGitignore(dir);
  const scopedMatchers = localIgnore && matchers.at(-1)?.base !== dir
    ? [...matchers, localIgnore] : matchers;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isEntryLast = i === entries.length - 1;
    const connector = isEntryLast ? "└── " : "├── ";
    const childPrefix = isEntryLast ? "    " : "│   ";
    const full = path.join(dir, entry.name);
    const isDir = entry.isDirectory();
    const ignored = HARD_IGNORED.has(entry.name) && isDir
      ? true
      : isIgnored(full, isDir, scopedMatchers);

    if (ignored) {
      lines.push(`${prefix}${connector}${entry.name}${ignoredSuffix(full, isDir)}`);
      continue;
    }

    if (isDir) {
      lines.push(`${prefix}${connector}${entry.name}/`);
      if (maxDepth > 0) {
        const result = buildTree(
          full, maxDepth - 1, `${prefix}${childPrefix}`,
          lines, charBudget, scopedMatchers, dropList,
        );
        if (result === -1) return -1;
      }
    } else {
      lines.push(`${prefix}${connector}${entry.name}`);
    }
  }

  return 0;
}

function walk(root, maxDepth, charBudget, dropList) {
  const lines = [`${path.basename(root)}/`];
  const rootIgnore = loadGitignore(root);
  buildTree(root, maxDepth, "", lines, charBudget, rootIgnore ? [rootIgnore] : [], dropList);
  return lines;
}

function getProjectTree(dir, maxDepth, charBudget) {
  const root = path.resolve(dir);
  // Global drop-list first, so a per-project `!node_modules` can re-include.
  const dropList = GLOBAL_DROP.concat(getCwdDrop(root));
  const result = walk(root, maxDepth, charBudget, dropList).join("\n");
  if (result.length <= charBudget) return result;
  // Overflowed: redo at 0.8× so the truncation notice reflects a real
  // ramp-down instead of a rebuild that overflows at the same point.
  return walk(root, maxDepth, Math.floor(charBudget * 0.8), dropList).join("\n");
}

// --- entrypoints ---

const args = process.argv.slice(2);

if (args.includes("--hook")) {
  let cwd = process.cwd();
  try {
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    if (parsed.cwd) cwd = parsed.cwd;
  } catch {}
  const tree = getProjectTree(cwd, resolveDepth(cwd), 12000);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "## Project Structure\n```\n" + tree + "\n```",
    },
  }));
} else {
  let target = process.cwd();
  let depth = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-d" || args[i] === "--depth") depth = Number(args[++i]) || null;
    else target = args[i];
  }
  process.stdout.write(getProjectTree(target, depth ?? resolveDepth(target), 40000) + "\n");
}
