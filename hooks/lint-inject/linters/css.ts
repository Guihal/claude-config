import { defineLinter } from "./constructor.ts";
import { parsePrettierList, parseStylelintJson } from "../parse.ts";
import { STYLELINT_CONFIG_DEFAULT } from "../configs.ts";

/**
 * CSS: stylelint с авто-конфигом (базовые правила, без плагинов; создаётся при
 * отсутствии юзерского конфига) + prettier configless. SCSS — в scss.ts (только prettier).
 */
export const css = defineLinter({
  name: "css",
  exts: [".css"],
  cold: [
    { bin: "stylelint", args: (files) => ["--formatter", "json", ...files], parse: parseStylelintJson, autoConfig: STYLELINT_CONFIG_DEFAULT },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
});
