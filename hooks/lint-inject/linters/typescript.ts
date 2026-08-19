import { defineLinter } from "./constructor.ts";
import { parseEslintJson, parsePrettierList, parseTscOutput } from "../parse.ts";
import { ESLINT_CONFIG_DEFAULT, TS_CONFIG_DEFAULT } from "../configs.ts";

/**
 * TypeScript: tsc-демон с авто-tsconfig (создаётся при найденном бинаре и отсутствии
 * tsconfig.json в корне проекта; .tsx вне авто-покрытия — см. configs.ts).
 * eslint cold с авто-flat-конфигом: js-блок — espree, ts-блок — @typescript-eslint/parser
 * (глобально, импортируется из npm root -g). prettier — configless.
 */
export const typescript = defineLinter({
  name: "typescript",
  exts: [".ts", ".tsx", ".mts", ".cts"],
  cold: [
    { bin: "eslint", args: (files) => ["--format", "json", ...files], parse: parseEslintJson, autoConfig: ESLINT_CONFIG_DEFAULT },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
  daemon: { bin: "tsc", parse: parseTscOutput, autoConfig: TS_CONFIG_DEFAULT },
});
