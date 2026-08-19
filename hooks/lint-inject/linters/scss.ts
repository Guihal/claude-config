import { defineLinter } from "./constructor.ts";
import { parsePrettierList } from "../parse.ts";

/**
 * SCSS: только prettier (configless). stylelint-авто-конфиг для SCSS НЕ создаём —
 * дефолтный синтаксис stylelint не парсит SCSS без postcss-scss (CssSyntaxError-шум).
 * В проектах с юзерским stylelint-конфигом линтер возьмёт его из node_modules пути.
 */
export const scss = defineLinter({
  name: "scss",
  exts: [".scss"],
  cold: [{ bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true }],
});
