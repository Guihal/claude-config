import { defineLinter } from "./constructor.ts";
import { parsePhpLint } from "../parse.ts";

/** php -l: по одному файлу за вызов (perFile), системный бинарь (PATH-ветка), configless. */
export const php = defineLinter({
  name: "php",
  exts: [".php"],
  cold: [{ bin: "php", args: (files) => ["-l", ...files], parse: parsePhpLint, perFile: true, configless: true }],
});
