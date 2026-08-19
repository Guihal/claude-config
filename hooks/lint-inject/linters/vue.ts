import { defineLinter } from "./constructor.ts";
import { parseEslintJson, parseTscOutput } from "../parse.ts";
import { TS_CONFIG_DEFAULT } from "../configs.ts";

/** Vue: eslint cold без авто-конфига (нужен vue-плагин/парсер); vue-tsc — тот же авто-tsconfig (include .vue). */
export const vue = defineLinter({
  name: "vue",
  exts: [".vue"],
  cold: [{ bin: "eslint", args: (files) => ["--format", "json", ...files], parse: parseEslintJson }],
  daemon: { bin: "vue-tsc", parse: parseTscOutput, autoConfig: TS_CONFIG_DEFAULT },
});
