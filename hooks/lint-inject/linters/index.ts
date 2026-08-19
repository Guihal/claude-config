import type { LinterDef, ResolvedPlan } from "./constructor.ts";
import { typescript } from "./typescript.ts";
import { js } from "./js.ts";
import { vue } from "./vue.ts";
import { css } from "./css.ts";
import { scss } from "./scss.ts";
import { python } from "./python.ts";
import { shell } from "./shell.ts";
import { markdown } from "./markdown.ts";
import { json } from "./json.ts";
import { php } from "./php.ts";
import { rust } from "./rust.ts";
import { go } from "./go.ts";
import { yaml } from "./yaml.ts";
import { html } from "./html.ts";
import { sql } from "./sql.ts";
import { toml } from "./toml.ts";
import { dockerfile } from "./dockerfile.ts";

export type { LinterDef, ResolvedPlan } from "./constructor.ts";

/** Реестр языковых модулей: добавление языка = новый файл в linters/ + строка здесь. */
export const registry: LinterDef[] = [typescript, js, vue, css, scss, python, shell, markdown, json, php, rust, go, yaml, html, sql, toml, dockerfile];

/** Синхронный дефолтный план (без хука): матч по расширению ИЛИ по basename (names). */
export function planFor(fileAbs: string): ResolvedPlan {
  const ext = fileAbs.slice(fileAbs.lastIndexOf(".")).toLowerCase();
  const base = fileAbs.slice(fileAbs.lastIndexOf("/") + 1);
  const matches = registry.filter((def) => def.exts.includes(ext) || (def.names ?? []).includes(base));
  return {
    cold: matches.flatMap((m) => m.cold ?? []),
    daemon: matches.find((m) => m.daemon)?.daemon,
  };
}
