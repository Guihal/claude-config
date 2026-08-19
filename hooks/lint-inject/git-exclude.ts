import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

type MarkerMode = "absent" | "plain" | "joined";

function resolveGitDir(rootAbs: string): string | undefined {
  const gitPath = path.join(rootAbs, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    if (!stat.isFile()) return undefined;
    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitPath, "utf8"));
    return match ? path.resolve(rootAbs, match[1].trim()) : undefined;
  } catch { return undefined; }
}

function resolveCommonGitDir(gitDir: string): string {
  try {
    const common = fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
    return common ? path.resolve(gitDir, common) : gitDir;
  } catch { return gitDir; }
}

function relativeConfig(rootAbs: string, configPath: string): string {
  return path.relative(rootAbs, configPath).split(path.sep).join("/");
}

function marker(relPath: string, mode: MarkerMode): string {
  const id = createHash("sha256").update(relPath).digest("hex").slice(0, 12);
  return `# lint-inject-auto:${id}:${mode}`;
}

function excludePath(rootAbs: string): string | undefined {
  const gitDir = resolveGitDir(rootAbs);
  return gitDir ? path.join(resolveCommonGitDir(gitDir), "info", "exclude") : undefined;
}

export function ensureOwnedExclude(rootAbs: string, configPath: string): void {
  const target = excludePath(rootAbs);
  if (!target) return;
  try {
    const existed = fs.existsSync(target);
    const content = existed ? fs.readFileSync(target, "utf8") : "";
    const relPath = relativeConfig(rootAbs, configPath);
    if (content.split("\n").some((line) => line.trim() === relPath)) return;
    const mode: MarkerMode = !existed ? "absent" : content.length > 0 && !content.endsWith("\n") ? "joined" : "plain";
    const prefix = mode === "joined" ? "\n" : "";
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${prefix}${marker(relPath, mode)}\n${relPath}\n`);
  } catch { /* Git metadata is advisory */ }
}

export function removeOwnedExclude(rootAbs: string, configPath: string): void {
  const target = excludePath(rootAbs);
  if (!target) return;
  try {
    const content = fs.readFileSync(target, "utf8");
    const relPath = relativeConfig(rootAbs, configPath);
    for (const mode of ["joined", "absent", "plain"] as const) {
      const block = `${marker(relPath, mode)}\n${relPath}\n`;
      const markerStart = content.indexOf(block);
      if (markerStart < 0 || (markerStart > 0 && content[markerStart - 1] !== "\n")) continue;
      const removeStart = mode === "joined" && markerStart > 0 ? markerStart - 1 : markerStart;
      const next = content.slice(0, removeStart) + content.slice(markerStart + block.length);
      if (mode === "absent" && next.length === 0) fs.unlinkSync(target);
      else fs.writeFileSync(target, next);
      return;
    }
  } catch { /* missing or changed metadata */ }
}
