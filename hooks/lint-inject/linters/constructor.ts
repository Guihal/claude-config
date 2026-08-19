import type { Diag, ParseResult } from "../parse.ts";
import type { AutoConfig } from "../configs.ts";

export type ColdLinter = {
  bin: string;
  args: (files: string[]) => string[];
  /** 5-й параметр files — для perFile-линтеров, чей вывод не содержит имени файла (jq и т.п.). */
  parse: (stdout: string, stderr: string, cwd: string, exitCode?: number, files?: string[]) => ParseResult;
  /** php -l и т.п. принимают ОДИН файл за вызов: прогон per-file, результаты мёржатся */
  perFile?: boolean;
  /** Тяжёлый project-level линтер (clippy, go vet): таймаут = бюджет батча, read не гоняется,
   *  таймаут НЕ считается мёртвым (первая компиляция может не успеть). */
  slow?: boolean;
  /** Работает из PATH без конфига в проекте (gofmt, yamllint, bash -n, py_compile, jq...):
   *  разрешает PATH-fallback даже вне git-каталога; read вне git — только такие. */
  configless?: boolean;
  /** env для spawn (bash -n → LC_ALL=C, py_compile → PYTHONPYCACHEPREFIX). Мержится с process.env. */
  env?: Record<string, string>;
  /** Авто-конфиг: если файла нет в корне проекта — создать с маркером (см. configs.ts). */
  autoConfig?: AutoConfig;
};

export type DaemonDef = {
  bin: string;
  /** Дефолт: ["--noEmit","--watch","--pretty","false","--preserveWatchOutput"]. */
  args?: string[];
  /** Дефолт: parseTscOutput. Демоны — tsc-семейство (маркеры циклов tsc-специфичны). */
  parse?: (output: string, cwd: string) => Diag[];
  /** Авто-конфиг (tsconfig.json): создаётся при найденном бинаре и отсутствии tsconfig. */
  autoConfig?: AutoConfig;
};

export type LinterDef = {
  name: string;
  /** Матчинг по расширению (path.extname, lowercase) — стабильный тип, не regexp. */
  exts: string[];
  /** Basename-матч (точный регистр): Dockerfile и т.п. без расширения. */
  names?: string[];
  cold?: ColdLinter[];
  daemon?: DaemonDef;
};

export type ResolvedPlan = { cold: ColdLinter[]; daemon?: DaemonDef };

/** Конструктор лантера: декларативный модуль языка. */
export function defineLinter(def: LinterDef): LinterDef {
  return def;
}
