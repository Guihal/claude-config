import { defineLinter } from "./constructor.ts";
import { parseEslintJson, parsePrettierList } from "../parse.ts";
import { ESLINT_CONFIG_DEFAULT } from "../configs.ts";

/**
 * JS (чистый, без TS-синтаксиса): eslint с авто-flat-конфигом (только eslint 9+;
 * .eslintrc* — legacy, eslint 9 их игнорирует) + prettier (configless, глобальный).
 * TS-файлы — в typescript.ts (tsc-демон; espree не парсит TS).
 */
export const js = defineLinter({
  name: "js",
  exts: [".js", ".mjs", ".cjs", ".jsx"],
  cold: [
    { bin: "eslint", args: (files) => ["--format", "json", ...files], parse: parseEslintJson, autoConfig: ESLINT_CONFIG_DEFAULT },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
});
