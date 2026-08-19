import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AUTO_MARKER, resolveAutoConfigContent, type AutoConfig } from "./auto-config-definitions.ts";
import { ensureOwnedExclude, removeOwnedExclude } from "./git-exclude.ts";
import {
  addOwner, hasOwners, ownersDirectory, pruneDeadOwners,
  removeEmptyOwnersDirectory, removeOwner, withRootLock,
} from "./lease-lock.ts";

export type AutoConfigLease = { rootAbs: string; configPath: string; ownerPath: string };
export type AutoConfigUse = { isAvailable: boolean; lease?: AutoConfigLease };

export function hasAutoMarker(configPath: string): boolean {
  try { return fs.readFileSync(configPath, "utf8").slice(0, 500).includes(AUTO_MARKER); }
  catch { return false; }
}

export function findUserConfig(rootAbs: string, config: AutoConfig): string | undefined {
  const home = os.homedir();
  let directory = rootAbs;
  for (;;) {
    for (const name of config.configNames) {
      const candidate = path.join(directory, name);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep walking */ }
    }
    if (config.pkgKeys?.length) {
      try {
        const pkg = path.join(directory, "package.json");
        const raw = JSON.parse(fs.readFileSync(pkg, "utf8")) as Record<string, unknown>;
        if (config.pkgKeys.some((name) => raw[name] !== undefined)) return pkg;
      } catch { /* missing or malformed metadata */ }
    }
    if (directory === home) return undefined;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

type ConfigWriter = (descriptor: number, content: string) => void;

export function writeExclusiveConfig(
  configPath: string,
  content: string,
  write: ConfigWriter = (descriptor, value) => fs.writeFileSync(descriptor, value),
): boolean {
  let descriptor: number | undefined;
  let identity: fs.Stats | undefined;
  try {
    descriptor = fs.openSync(configPath, "wx", 0o600);
    identity = fs.fstatSync(descriptor);
    write(descriptor, content);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    if (identity) {
      try {
        const current = fs.statSync(configPath);
        if (current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(configPath);
      } catch { /* partial file gone or replaced */ }
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function registerGeneratedOwner(rootAbs: string, configPath: string): AutoConfigUse {
  const directory = ownersDirectory(configPath);
  pruneDeadOwners(directory);
  const ownerPath = addOwner(directory);
  return { isAvailable: true, lease: { rootAbs, configPath, ownerPath } };
}

function canonicalRoot(rootAbs: string): string {
  try { return fs.realpathSync(rootAbs); } catch { return rootAbs; }
}

export async function acquireAutoConfig(rootAbs: string, config: AutoConfig, timeoutMs = 3_000): Promise<AutoConfigUse> {
  const physicalRoot = canonicalRoot(rootAbs);
  const deadline = Date.now() + timeoutMs;
  try {
    return await withRootLock(physicalRoot, () => {
      const found = findUserConfig(physicalRoot, config);
      if (found && !hasAutoMarker(found)) return { isAvailable: true };
      const configPath = found ?? path.join(physicalRoot, config.file);
      let created = false;
      if (!fs.existsSync(configPath)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { isAvailable: false };
        created = writeExclusiveConfig(configPath, resolveAutoConfigContent(config, remaining));
        if (created) ensureOwnedExclude(physicalRoot, configPath);
      }
      if (!hasAutoMarker(configPath)) return { isAvailable: true };
      try { return registerGeneratedOwner(physicalRoot, configPath); }
      catch (error) {
        if (created) {
          try { if (hasAutoMarker(configPath)) fs.unlinkSync(configPath); } catch { /* ownership lost */ }
          removeOwnedExclude(physicalRoot, configPath);
        }
        throw error;
      }
    }, timeoutMs);
  } catch { return { isAvailable: false }; }
}

export async function releaseAutoConfig(lease: AutoConfigLease): Promise<void> {
  try {
    await withRootLock(lease.rootAbs, () => {
      const directory = ownersDirectory(lease.configPath);
      removeOwner(lease.ownerPath);
      pruneDeadOwners(directory);
      if (hasOwners(directory)) return;
      try { if (hasAutoMarker(lease.configPath)) fs.unlinkSync(lease.configPath); } catch { /* user replacement */ }
      removeOwnedExclude(lease.rootAbs, lease.configPath);
      removeEmptyOwnersDirectory(directory);
    });
  } catch { /* later stale-owner adoption can retry cleanup */ }
}
