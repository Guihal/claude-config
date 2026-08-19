import * as fs from "node:fs";
import * as path from "node:path";

export type Severity = "error" | "warning";
export type Diag = {
  absPath: string;
  line: number;
  col: number;
  severity: Severity;
  msg: string;
  /** Ключ группировки: eslint ruleId, tsc "TS<code>", stylelint rule, и т.д. */
  rule?: string;
};

/** Опциональный параметр ждущих функций — тесты гоняют пороги в сотнях мс. */
export const DEFAULT_TIMINGS = {
  budgetMs: 15_000,
  changeWaitMs: 2_000,
  coldLinterMs: 10_000,
};
export type Timings = typeof DEFAULT_TIMINGS;

export const MAX_LINES = 30;
const MAX_AFFECTED_FILES = 5;

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export type ParseResult = { diags: Diag[]; parseError?: string };

function jsonParseError(stderr: string, stdout: string): ParseResult {
  return { diags: [], parseError: stderr.trim().slice(0, 200) || stdout.trim().slice(0, 200) };
}

/** Некоторые линтеры (stylelint 16, markdownlint) пишут JSON в stderr, а не stdout. */
function parseJsonEither(stdout: string, stderr: string): unknown {
  for (const s of [stdout, stderr]) {
    try {
      return JSON.parse(stripAnsi(s).trim());
    } catch {
      // следующий канал
    }
  }
  return undefined;
}

/** eslint --format json */
export function parseEslintJson(stdout: string, stderr = ""): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripAnsi(stdout).trim());
  } catch {
    return jsonParseError(stderr, stdout);
  }
  if (!Array.isArray(raw)) return { diags: [], parseError: "unexpected eslint json shape" };
  const diags: Diag[] = [];
  for (const file of raw as EslintFile[]) {
    for (const m of file.messages ?? []) {
      diags.push({
        absPath: path.resolve(file.filePath),
        line: m.line ?? 0,
        col: m.column ?? 0,
        severity: m.severity === 2 ? "error" : "warning",
        msg: m.ruleId ? `${m.message} (${m.ruleId})` : m.message,
        rule: m.ruleId ?? undefined,
      });
    }
  }
  return { diags };
}

type EslintFile = {
  filePath: string;
  messages?: { line?: number; column?: number; severity?: number; message: string; ruleId?: string | null }[];
};

/** stylelint --formatter json */
export function parseStylelintJson(stdout: string, stderr = ""): ParseResult {
  const raw = parseJsonEither(stdout, stderr);
  if (!raw) return jsonParseError(stderr, stdout);
  if (!Array.isArray(raw)) return { diags: [], parseError: "unexpected stylelint json shape" };
  const diags: Diag[] = [];
  for (const file of raw as StylelintFile[]) {
    for (const w of file.warnings ?? []) {
      diags.push({
        absPath: path.resolve(file.source ?? ""),
        line: w.line ?? 0,
        col: w.column ?? 0,
        severity: w.severity === "warning" ? "warning" : "error",
        msg: w.text,
        rule: w.rule,
      });
    }
  }
  return { diags };
}

type StylelintFile = {
  source?: string;
  warnings?: { line?: number; column?: number; text: string; severity?: string; rule?: string }[];
};

const TSC_RE = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/;

/** tsc / vue-tsc: пути относительные от cwd процесса. */
export function parseTscOutput(output: string, cwd: string): Diag[] {
  const diags: Diag[] = [];
  for (const rawLine of output.split("\n")) {
    const m = TSC_RE.exec(stripAnsi(rawLine).trim());
    if (!m) continue;
    diags.push({
      absPath: path.resolve(cwd, m[1]),
      line: Number(m[2]),
      col: Number(m[3]),
      severity: m[4] === "warning" ? "warning" : "error",
      msg: m[6],
      rule: m[5],
    });
  }
  return diags;
}

/** prettier --list-different: stdout = относительные пути при отличиях, пусто при чистоте. */
export function parsePrettierList(stdout: string, stderr = "", cwd = process.cwd()): ParseResult {
  const lines = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0 && stderr.trim()) {
    // rc=2 — синтаксическая ошибка (сломанный .json и т.п.): не молчим, показываем stderr-хвост
    return { diags: [], parseError: stderr.trim().slice(0, 200) };
  }
  const diags: Diag[] = lines.map((p) => ({
    absPath: path.resolve(cwd, p),
    line: 0,
    col: 0,
    severity: "warning", // формат-проблема не должна гасить секцию демона (brokenByCold смотрит errors)
    msg: "file is not formatted",
    rule: "prettier/prettier",
  }));
  return { diags };
}

type RuffItem = {
  filename: string;
  code?: string;
  message: string;
  severity?: string;
  location?: { row?: number; column?: number };
};

/** ruff check --output-format json */
export function parseRuffJson(stdout: string, stderr = ""): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripAnsi(stdout).trim());
  } catch {
    return jsonParseError(stderr, stdout);
  }
  if (!Array.isArray(raw)) return { diags: [], parseError: "unexpected ruff json shape" };
  const diags: Diag[] = [];
  for (const item of raw as RuffItem[]) {
    const loc = item.location ?? {};
    diags.push({
      absPath: path.resolve(item.filename),
      line: loc.row ?? 0,
      col: loc.column ?? 0,
      severity: item.severity === "warning" ? "warning" : "error",
      msg: item.code ? `${item.message} (${item.code})` : item.message,
      rule: item.code,
    });
  }
  return { diags };
}

type ShellcheckComment = {
  file: string;
  line?: number;
  column?: number;
  level?: string;
  message: string;
  code?: number;
};

/** shellcheck --format=json: плоский массив [{file,...}] (shellcheck 0.11+)
 *  ИЛИ объект {comments:[...]} (старые версии). */
export function parseShellcheckJson(stdout: string, stderr = ""): ParseResult {
  const raw = parseJsonEither(stdout, stderr);
  if (!raw) return jsonParseError(stderr, stdout);
  const comments = Array.isArray(raw)
    ? (raw as ShellcheckComment[])
    : (raw as { comments?: ShellcheckComment[] }).comments ?? [];
  if (!Array.isArray(comments)) return { diags: [], parseError: "unexpected shellcheck json shape" };
  const diags: Diag[] = [];
  for (const c of comments) {
    diags.push({
      absPath: path.resolve(c.file),
      line: c.line ?? 0,
      col: c.column ?? 0,
      severity: c.level === "error" ? "error" : "warning", // info/style → warning (шум гасим)
      msg: c.message,
      rule: c.code != null ? `SC${c.code}` : undefined,
    });
  }
  return { diags };
}

type MarkdownlintItem =
  | {
      fileName: string;
      lineNumber?: number;
      ruleNames?: string[];
      ruleDescription?: string;
      errorDetail?: string;
      severity?: number;
    }
  | {
      file: string;
      issues?: {
        lineNumber?: number;
        ruleNames?: string[];
        ruleDescription?: string;
        errorDetail?: string;
        severity?: number;
      }[];
    };

/** markdownlint --json: flat [{fileName,...}] (новые версии) или [{file, issues}] (старые). */
export function parseMarkdownlintJson(stdout: string, stderr = ""): ParseResult {
  const raw = parseJsonEither(stdout, stderr);
  if (!raw) return jsonParseError(stderr, stdout);
  if (!Array.isArray(raw)) return { diags: [], parseError: "unexpected markdownlint json shape" };
  const diags: Diag[] = [];
  const push = (absPath: string, line: number | undefined, sev: number | undefined, rule: string | undefined, desc: string | undefined, detail: string | undefined) => {
    diags.push({
      absPath,
      line: line ?? 0,
      col: 0,
      severity: sev === 1 ? "warning" : "error", // markdownlint: 0=off, 1=warning, 2=error
      msg: [desc, detail].filter(Boolean).join(" — "),
      rule,
    });
  };
  for (const item of raw as MarkdownlintItem[]) {
    if ("fileName" in item && typeof item.fileName === "string") {
      push(item.fileName, item.lineNumber, item.severity, item.ruleNames?.[0], item.ruleDescription, item.errorDetail);
    } else if ("file" in item && typeof item.file === "string" && Array.isArray(item.issues)) {
      for (const iss of item.issues) {
        push(item.file, iss.lineNumber, iss.severity, iss.ruleNames?.[0], iss.ruleDescription, iss.errorDetail);
      }
    }
  }
  return { diags };
}

/** php -l: exit 0 = чисто; 255 = parse error; missing-file exit version-dependent (1/255). */
const PHP_ERR_RE = /^PHP (?:Parse|Fatal) error:\s+(.+?) in (.+) on line (\d+)$/;
const PHP_MISSING = "Could not open input file";

export function parsePhpLint(stdout: string, stderr = "", cwd = process.cwd(), exitCode?: number): ParseResult {
  const both = `${stdout}\n${stderr}`;
  if (exitCode === 0) return { diags: [] };
  // файл удалён/недоступен — тихий no-op (канал stdout/stderr зависит от версии PHP)
  if (both.includes(PHP_MISSING)) return { diags: [] };
  for (const line of both.split("\n")) {
    const m = PHP_ERR_RE.exec(stripAnsi(line).trim());
    if (m) {
      return {
        diags: [{ absPath: path.resolve(cwd, m[2]), line: Number(m[3]), col: 0, severity: "error", msg: m[1], rule: "php" }],
      };
    }
  }
  return { diags: [], parseError: (stderr || stdout).trim().slice(0, 200) };
}

/** cargo clippy / rustc --message-format=json: поток JSON-строк, compiler-message → diag. */
export function parseClippyJson(stdout: string, stderr = ""): ParseResult {
  const diags: Diag[] = [];
  let sawMessage = false;
  for (const raw of stdout.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    let obj: { reason?: string; message?: { level?: string; message?: string; code?: { code?: string } | null; spans?: { file_name?: string; line_start?: number; column_start?: number }[] } };
    try {
      obj = JSON.parse(t);
    } catch {
      continue; // не-JSON строка (например stderr-шум в stdout) — не роняем весь прогон
    }
    if (obj?.reason !== "compiler-message" || !obj.message) continue;
    sawMessage = true;
    const msg = obj.message;
    const sev = msg.level === "warning" ? "warning" : msg.level === "error" ? "error" : null;
    if (!sev) continue; // note/help — не диагностики
    const span = msg.spans?.[0];
    if (!span?.file_name || typeof span.line_start !== "number") continue; // span-нет — пропускаем
    const code = msg.code?.code ?? undefined;
    diags.push({
      absPath: path.resolve(span.file_name),
      line: span.line_start,
      col: span.column_start ?? 0,
      severity: sev,
      msg: code ? `${msg.message} (${code})` : msg.message ?? "clippy",
      rule: code,
    });
  }
  if (!sawMessage) {
    // нет ни одной compiler-message (нет Cargo.toml / cargo error) — не «здоров», а сломан
    const err = (stderr || stdout).trim();
    return { diags: [], parseError: (err || "нет compiler-message").slice(0, 200) };
  }
  return { diags };
}

/** go vet: "file:line:col: msg" и "file:line: msg". Находки — в stderr (реальный go vet).
 *  Ненулевой exit без матчей → parseError (нет go.mod → молча падает, иначе backoff не сработает). */
export function parseGoVet(stdout: string, stderr = "", cwd = process.cwd(), exitCode?: number): ParseResult {
  const diags: Diag[] = [];
  const re1 = /^(.+?):(\d+):(\d+): (.*)$/;
  const re2 = /^(.+?):(\d+): (.*)$/;
  const both = `${stdout}\n${stderr}`;
  for (const raw of both.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    const m = re1.exec(line) ?? re2.exec(line);
    if (!m) continue;
    diags.push({
      absPath: path.resolve(cwd, m[1]),
      line: Number(m[2]),
      col: m.length > 4 ? Number(m[3]) : 0,
      severity: "error",
      msg: m[m.length - 1],
      rule: "vet",
    });
  }
  if (diags.length === 0 && exitCode !== undefined && exitCode !== 0) {
    return { diags: [], parseError: (both.trim() || `go vet exit ${exitCode}`).slice(0, 200) };
  }
  return { diags };
}

/** gofmt -l: строки файлов, требующих форматирования (аналог prettier). */
export function parseGofmtList(stdout: string, stderr = "", cwd = process.cwd()): ParseResult {
  const lines = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0 && stderr.trim()) {
    return { diags: [], parseError: stderr.trim().slice(0, 200) };
  }
  return {
    diags: lines.map((p) => ({
      absPath: path.resolve(cwd, p),
      line: 0,
      col: 0,
      severity: "warning",
      msg: "gofmt: файл не отформатирован",
      rule: "gofmt",
    })),
  };
}

/** yamllint -f parsable: "file:line:col: [error|warning] msg (rule)". */
const YAMLLINT_RE = /^(.+?):(\d+):(\d+): \[(error|warning)\] (.*)$/;
export function parseYamllint(stdout: string, stderr = "", cwd = process.cwd()): ParseResult {
  const diags: Diag[] = [];
  for (const raw of stdout.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    const m = YAMLLINT_RE.exec(line);
    if (!m) continue;
    const tail = m[5];
    const ruleMatch = /\(([^)]+)\)\s*$/.exec(tail);
    diags.push({
      absPath: path.resolve(cwd, m[1]),
      line: Number(m[2]),
      col: Number(m[3]),
      severity: m[4] === "warning" ? "warning" : "error",
      msg: ruleMatch ? `${tail.slice(0, ruleMatch.index).trim()} (${ruleMatch[1]})` : tail,
      rule: ruleMatch?.[1],
    });
  }
  if (diags.length === 0 && stderr.trim()) {
    return { diags: [], parseError: stderr.trim().slice(0, 200) };
  }
  return { diags };
}

/** sqlfluff lint --format json: массив [{filepath, violations:[...]}] (v4.x) ИЛИ {"files":[...]} (старые). */
export function parseSqlfluffJson(stdout: string, stderr = ""): ParseResult {
  const diags: Diag[] = [];
  try {
    const parsed = JSON.parse(stdout) as
      | { filepath?: string; violations?: { start_line_no?: number; start_line_pos?: number; line_no?: number; line_pos?: number; code?: string; description?: string; warning?: boolean }[] }[]
      | { files?: { filepath?: string; violations?: { start_line_no?: number; start_line_pos?: number; line_no?: number; line_pos?: number; code?: string; description?: string; warning?: boolean }[] }[] };
    const files = Array.isArray(parsed) ? parsed : parsed?.files ?? [];
    for (const f of files) {
      if (typeof f?.filepath !== "string") continue;
      for (const v of f.violations ?? []) {
        diags.push({
          absPath: path.resolve(f.filepath),
          line: Number(v?.start_line_no ?? v?.line_no ?? 0),
          col: Number(v?.start_line_pos ?? v?.line_pos ?? 0),
          severity: v?.warning ? "warning" : "error",
          msg: v?.description ?? "sqlfluff violation",
          rule: v?.code ?? undefined,
        });
      }
    }
  } catch {
    return { diags: [], parseError: (stderr || stdout).trim().slice(0, 200) };
  }
  return { diags };
}

/** taplo lint: miette-формат ("error: title" + "┌─ file:line:col") с fallback на file:line:col.
 *  taplo пишет ВСЁ (логи + диагностику) в stderr — парсим оба канала. */
export function parseTaploText(stdout: string, stderr = ""): ParseResult {
  const diags: Diag[] = [];
  const re1 = /^(.+?):(\d+):(\d+)\s*\[(error|warning)\]\s*(.*)$/;
  const re2 = /^(.+?):(\d+):(\d+): (.*)$/;
  const miettePointer = /^\s*┌─\s+(.+?):(\d+):(\d+)/;
  const titleRe = /^(error|warning):\s*(.*)$/;
  let lastTitle = "";
  let lastSeverity: "error" | "warning" = "error";
  const both = `${stdout}\n${stderr}`;
  for (const raw of both.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    if (line.startsWith("INFO ") || line.startsWith("ERROR taplo") || line.startsWith("DEBUG ")) continue; // env_logger-шум
    const t = titleRe.exec(line);
    if (t) {
      lastTitle = t[2];
      lastSeverity = t[1] as "error" | "warning";
      continue;
    }
    const mp = miettePointer.exec(line);
    if (mp) {
      diags.push({
        absPath: path.resolve(mp[1]),
        line: Number(mp[2]),
        col: Number(mp[3]),
        severity: lastSeverity,
        msg: lastTitle || "taplo: semantic error",
        rule: "taplo",
      });
      continue;
    }
    const m = re1.exec(line) ?? re2.exec(line);
    if (m) {
      diags.push({
        absPath: path.resolve(m[1]),
        line: Number(m[2]),
        col: Number(m[3]),
        severity: m[4] === "warning" ? "warning" : "error",
        msg: m[5] ?? m[4] ?? line,
        rule: "taplo",
      });
    }
  }
  if (diags.length === 0 && both.trim()) {
    return { diags: [], parseError: both.trim().slice(0, 200) };
  }
  return { diags };
}

/** hadolint --format json: [{"line","column","code","message","level","file"}]. */
export function parseHadolintJson(stdout: string, stderr = ""): ParseResult {
  const diags: Diag[] = [];
  try {
    const arr = JSON.parse(stdout) as { line?: number; column?: number; code?: string; message?: string; level?: string; file?: string; filename?: string }[];
    if (!Array.isArray(arr)) throw new Error("not array");
    for (const item of arr) {
      if (!item) continue;
      diags.push({
        absPath: path.resolve(item.file ?? item.filename ?? "."),
        line: Number(item.line ?? 0),
        col: Number(item.column ?? 0),
        severity: item.level === "error" ? "error" : "warning", // warning/info/style → warning
        msg: item.message ?? "hadolint",
        rule: item.code ?? undefined,
      });
    }
  } catch {
    return { diags: [], parseError: (stderr || stdout).trim().slice(0, 200) };
  }
  return { diags };
}

export type Roots = { binRoot?: string; tsRoot?: string };

/* --- Configless-синтакс-парсеры (bash -n / py_compile / jq / rustfmt --check) --- */

/** bash -n (LC_ALL=C): "file: line N: msg" (имя может содержать двоеточия — жадный split)
 *  или голое "line N: msg" (без имени — absPath из files[0]). Эхо-строка исходника
 *  начинается с backtick — пропускается (одна ошибка = один diag). */
const BASH_SYNTAX_RE = /^(.*): line (\d+): (.*)$/;
const BASH_SYNTAX_NONAME_RE = /^line (\d+): (.*)$/;
export function parseBashSyntax(
  stdout: string,
  stderr = "",
  cwd = process.cwd(),
  exitCode?: number,
  files?: string[],
): ParseResult {
  const both = `${stdout}\n${stderr}`;
  if (exitCode === 0) return { diags: [] };
  const diags: Diag[] = [];
  for (const raw of both.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    let absPath: string | undefined;
    let ln = 0;
    let msg = "";
    const m = BASH_SYNTAX_RE.exec(line);
    if (m) {
      absPath = path.resolve(cwd, m[1]);
      ln = Number(m[2]);
      msg = m[3];
    } else {
      const m2 = BASH_SYNTAX_NONAME_RE.exec(line);
      if (!m2) continue;
      absPath = files?.[0] ?? cwd;
      ln = Number(m2[1]);
      msg = m2[2];
    }
    if (msg.startsWith("`")) continue; // эхо исходника, не ошибка
    diags.push({ absPath, line: ln, col: 0, severity: "error", msg, rule: "bash" });
  }
  if (diags.length === 0 && exitCode !== undefined && exitCode !== 0) {
    return { diags: [], parseError: (both.trim() || `bash -n exit ${exitCode}`).slice(0, 200) };
  }
  return { diags };
}

/** python -m py_compile: traceback `File "f", line N` + snippet/caret + `XxxError: msg`.
 *  diag — от ПОСЛЕДНЕЙ File-строки до ближайшего следующего ^\w+Error (сквозь snippet). */
const PY_FILE_RE = /^\s*File "(.+)", line (\d+)/;
const PY_ERROR_RE = /^(\w+Error): (.*)$/;
export function parsePyCompile(stdout: string, stderr = "", cwd = process.cwd(), exitCode?: number): ParseResult {
  const both = `${stdout}\n${stderr}`;
  if (exitCode === 0) return { diags: [] };
  const diags: Diag[] = [];
  let pending: { file: string; line: number } | undefined;
  for (const raw of both.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    const fm = PY_FILE_RE.exec(line);
    if (fm) {
      pending = { file: fm[1], line: Number(fm[2]) };
      continue;
    }
    const em = PY_ERROR_RE.exec(line);
    if (em && pending) {
      diags.push({
        absPath: path.resolve(cwd, pending.file),
        line: pending.line,
        col: 0,
        severity: "error",
        msg: em[2],
        rule: "pycompile",
      });
      pending = undefined;
    }
  }
  if (diags.length === 0 && exitCode !== undefined && exitCode !== 0) {
    return { diags: [], parseError: (both.trim() || `py_compile exit ${exitCode}`).slice(0, 200) };
  }
  return { diags };
}

/** jq empty: `jq: parse error: <msg> at line N, column M` (stderr, без имени файла — absPath=files[0]).
 *  "jq: error: Could not open file" (exit 2) — файл удалён, тихий no-op (как PHP_MISSING). */
const JQ_RE = /^jq: (?:parse error|error): (.+?) at line (\d+), column (\d+)$/;
const JQ_MISSING = "jq: error: Could not open file";
export function parseJqEmpty(
  stdout: string,
  stderr = "",
  cwd = process.cwd(),
  exitCode?: number,
  files?: string[],
): ParseResult {
  const both = `${stdout}\n${stderr}`;
  if (exitCode === 0) return { diags: [] };
  if (both.includes(JQ_MISSING)) return { diags: [] };
  const diags: Diag[] = [];
  for (const raw of both.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    const m = JQ_RE.exec(line);
    if (!m) continue;
    diags.push({
      absPath: files?.[0] ?? cwd,
      line: Number(m[2]),
      col: Number(m[3]),
      severity: "error",
      msg: m[1],
      rule: "jq",
    });
  }
  if (diags.length === 0 && exitCode !== undefined && exitCode !== 0) {
    return { diags: [], parseError: (both.trim() || `jq exit ${exitCode}`).slice(0, 200) };
  }
  return { diags };
}

/** rustfmt --check: `Diff in <path>:N:` или `Diff in <path> at line N:` → warning «не отформатирован».
 *  exit≠0 без «Diff in» (miette-синтакс-ошибка .rs) → parseError — не молчим. */
const RUSTFMT_DIFF_RE = /^Diff in (.+?)(?: at line |:)(\d+):/;
export function parseRustfmtCheck(
  stdout: string,
  stderr = "",
  cwd = process.cwd(),
  exitCode?: number,
): ParseResult {
  const both = `${stdout}\n${stderr}`;
  if (exitCode === 0) return { diags: [] };
  const diags: Diag[] = [];
  for (const raw of both.split("\n")) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    const m = RUSTFMT_DIFF_RE.exec(line);
    if (!m) continue;
    diags.push({
      absPath: path.resolve(cwd, m[1]),
      line: Number(m[2]),
      col: 0,
      severity: "warning",
      msg: "rustfmt: файл не отформатирован",
      rule: "rustfmt",
    });
  }
  if (diags.length === 0) {
    return { diags: [], parseError: (both.trim() || `rustfmt exit ${exitCode}`).slice(0, 200) };
  }
  return { diags };
}

export type Context = { binPath?: string; binCwd?: string; tsRoot?: string; gitRoot?: string };

function findInPath(bin: string): string | undefined {
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(d, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // следующая директория PATH
    }
  }
  return undefined;
}

/**
 * Единый walker: от файла вверх до .git — node_modules/.bin/<bin>, tsconfig.json, gitRoot.
 * БЕЗ кэша (паттерн A1): ~20 existsSync на вызов, появление бинаря/конфига в сессии подхватывается.
 * pathFallback (только cold-линтеры): системный бинарь из PATH с cwd = gitRoot.
 */
export function resolveContext(fileAbs: string, bin: string, opts: { pathFallback?: boolean } = {}): Context {
  const out: Context = {};
  let dir = path.dirname(fileAbs);
  for (;;) {
    if (!out.binPath && fs.existsSync(path.join(dir, "node_modules", ".bin", bin))) {
      out.binPath = path.join(dir, "node_modules", ".bin", bin);
      out.binCwd = dir;
    }
    if (!out.tsRoot && fs.existsSync(path.join(dir, "tsconfig.json"))) out.tsRoot = dir;
    const isGitRoot = fs.existsSync(path.join(dir, ".git"));
    if (isGitRoot) out.gitRoot = dir;
    const parent = path.dirname(dir);
    if (isGitRoot || parent === dir) break;
    dir = parent;
  }
  if (!out.binPath && opts.pathFallback) {
    const p = findInPath(bin);
    if (p) {
      out.binPath = p;
      out.binCwd = out.gitRoot; // /usr/bin как cwd → линтер без конфига → parseError → backoff-poison
    }
  }
  return out;
}

/** Враппер над resolveContext без PATH (binRoot = только node_modules) — совместимость теста 6. */
export function resolveRoots(fileAbs: string, bin: string): Roots {
  const ctx = resolveContext(fileAbs, bin, { pathFallback: false });
  return { binRoot: ctx.binCwd, tsRoot: ctx.tsRoot };
}

export function countErrors(diags: Diag[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of diags) {
    if (d.severity !== "error") continue;
    counts.set(d.absPath, (counts.get(d.absPath) ?? 0) + 1);
  }
  return counts;
}

export type ReportInput = {
  editedAbs: string;
  rootAbs: string;
  diags: Diag[];
  /** Снимок, уже показанный агенту. Пустой = baseline, уровень 2 не эмитится. */
  prevCounts: Map<string, number>;
  /** Файлы, отредактированные в этом же батче: исключаются из уровней 2 и 3 (double-report). */
  batchEdited?: Set<string>;
};

export type Report = { text?: string; counts: Map<string, number> };

/** Уровень 1: собственные ошибки файла, сгруппированные по rule ?? msg (порядок первого появления). */
function ownGroupedLines(diags: Diag[], editedAbs: string, rel: (p: string) => string): string[] {
  const own = diags.filter((d) => d.absPath === editedAbs);
  const groups: { rule?: string; items: Diag[] }[] = [];
  for (const d of own) {
    const key = d.rule ?? d.msg;
    const g = groups.find((x) => (x.rule ?? x.items[0].msg) === key);
    if (g) g.items.push(d);
    else groups.push({ rule: d.rule, items: [d] });
  }
  const lines: string[] = [];
  for (const g of groups) {
    const first = g.items[0];
    lines.push(`${rel(first.absPath)}:${first.line}:${first.col}: ${first.msg}`);
    if (g.items.length > 1) {
      const n = g.items.length - 1;
      lines.push(g.rule ? `${g.rule}: ещё ${n} раз в этом файле` : `ещё ${n} раз в этом файле`);
    }
  }
  return lines;
}

/** Только уровень 1 (read-триггер): без prevCounts и уровней 2/3. */
export function buildOwnReport({ editedAbs, rootAbs, diags }: { editedAbs: string; rootAbs: string; diags: Diag[] }): string | undefined {
  const rel = (p: string) => path.relative(rootAbs, p) || path.basename(p);
  const lines = ownGroupedLines(diags, editedAbs, rel);
  if (lines.length === 0) return undefined;
  const out = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) out.push(`… +${lines.length - MAX_LINES} more`);
  return out.join("\n");
}

/** Три уровня: правленый файл целиком (сгруппирован по rule) → задетые правкой → счётчик остального. */
export function buildReport({ editedAbs, rootAbs, diags, prevCounts, batchEdited }: ReportInput): Report {
  const counts = countErrors(diags);
  const rel = (p: string) => path.relative(rootAbs, p) || path.basename(p);
  const out: string[] = [];

  // Уровень 1: собственные ошибки файла, сгруппированные по rule ?? msg (порядок первого появления).
  const ownLines = ownGroupedLines(diags, editedAbs, rel);
  if (ownLines.length > 0) {
    out.push(...ownLines.slice(0, MAX_LINES));
    if (ownLines.length > MAX_LINES) out.push(`… +${ownLines.length - MAX_LINES} more`);
  }

  const isBatch = (p: string) => batchEdited?.has(p) ?? false;

  const affected: string[] = [];
  if (prevCounts.size > 0) {
    for (const [p, n] of counts) {
      if (p === editedAbs || isBatch(p)) continue;
      if (n > (prevCounts.get(p) ?? 0)) affected.push(p);
    }
  }
  if (affected.length > 0) {
    const shown = affected
      .slice(0, MAX_AFFECTED_FILES)
      .map((p) => `${rel(p)} (${counts.get(p)})`)
      .join(", ");
    const more = affected.length > MAX_AFFECTED_FILES ? ", …" : "";
    out.push(`правка задела: ${shown}${more}`);
  }

  const affectedSet = new Set(affected);
  let restErrors = 0;
  let restFiles = 0;
  for (const [p, n] of counts) {
    if (p === editedAbs || affectedSet.has(p) || isBatch(p)) continue;
    restErrors += n;
    restFiles += 1;
  }
  if (restErrors > 0) {
    // топ-3 rest-файлов по счётчику (tie — по rel path): агенту видно, куда смотреть
    const top = [...counts.entries()]
      .filter(([p]) => p !== editedAbs && !affectedSet.has(p) && !isBatch(p))
      .sort((a, b) => b[1] - a[1] || rel(a[0]).localeCompare(rel(b[0])))
      .slice(0, 3)
      .map(([p, n]) => `${rel(p)} (${n})`);
    const more = restFiles > 3 ? `, ещё ${restFiles - 3} файлов` : "";
    out.push(`в проекте ${restErrors} ошибок в ${restFiles} файлах (не мои правки)${top.length > 0 ? `: ${top.join(", ")}${more}` : ""}`);
  }

  return { text: out.length > 0 ? out.join("\n") : undefined, counts };
}
