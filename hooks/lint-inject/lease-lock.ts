import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOCK_WAIT_MS = 3_000;
const LOCK_STALE_MS = 30_000;
const OWNER_STALE_MS = 120_000;
const POLL_MS = 20;
const STATE_ROOT = path.join(os.tmpdir(), "claude-lint-inject");

function key(value: string): string {
  let canonical = value;
  try { canonical = fs.realpathSync(value); }
  catch {
    try { canonical = path.join(fs.realpathSync(path.dirname(value)), path.basename(value)); } catch { /* absolute input */ }
  }
  return createHash("sha256").update(canonical).digest("hex");
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStaleLock(lockPath: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: number; createdAt?: number };
    const age = Date.now() - (raw.createdAt ?? fs.statSync(lockPath).mtimeMs);
    return age > LOCK_STALE_MS || !raw.pid || !isProcessAlive(raw.pid);
  } catch {
    try { return Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS; }
    catch { return false; }
  }
}

async function acquireLock(rootAbs: string, waitMs: number): Promise<{ path: string; token: string }> {
  fs.mkdirSync(STATE_ROOT, { recursive: true, mode: 0o700 });
  const lockPath = path.join(STATE_ROOT, `${key(rootAbs)}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + Math.max(1, Math.min(LOCK_WAIT_MS, waitMs));
  while (Date.now() < deadline) {
    try {
      const descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      fs.closeSync(descriptor);
      return { path: lockPath, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (isStaleLock(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch { /* another owner won */ }
      } else await delay(POLL_MS);
    }
  }
  throw new Error(`auto-config lock timeout: ${rootAbs}`);
}

function releaseLock(lock: { path: string; token: string }): void {
  try {
    const current = JSON.parse(fs.readFileSync(lock.path, "utf8")) as { token?: string };
    if (current.token === lock.token) fs.unlinkSync(lock.path);
  } catch { /* stale-lock recovery may have removed it */ }
}

export async function withRootLock<T>(rootAbs: string, operation: () => T | Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
  const lock = await acquireLock(rootAbs, waitMs);
  try { return await operation(); } finally { releaseLock(lock); }
}

export function ownersDirectory(configPath: string): string {
  return path.join(STATE_ROOT, `${key(configPath)}.owners`);
}

export function pruneDeadOwners(directory: string): void {
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    const ownerPath = path.join(directory, name);
    try {
      const pid = Number(name.split("-", 1)[0]);
      const age = Date.now() - fs.statSync(ownerPath).mtimeMs;
      if (!Number.isInteger(pid) || age > OWNER_STALE_MS || !isProcessAlive(pid)) fs.unlinkSync(ownerPath);
    } catch { /* concurrent release */ }
  }
}

export function addOwner(directory: string): string {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ownerPath = path.join(directory, `${process.pid}-${randomUUID()}`);
  fs.writeFileSync(ownerPath, String(Date.now()), { mode: 0o600, flag: "wx" });
  return ownerPath;
}

export function removeOwner(ownerPath: string): void {
  try { fs.unlinkSync(ownerPath); } catch { /* idempotent */ }
}

export function hasOwners(directory: string): boolean {
  try { return fs.readdirSync(directory).length > 0; } catch { return false; }
}

export function removeEmptyOwnersDirectory(directory: string): void {
  try { fs.rmdirSync(directory); } catch { /* another owner joined */ }
}
