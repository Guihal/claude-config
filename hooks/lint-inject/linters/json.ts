import { defineLinter } from "./constructor.ts";
import { parseJqEmpty, parsePrettierList } from "../parse.ts";

/**
 * JSON: jq empty (валидация синтаксиса, configless; jq не пишет имя файла — perFile,
 * absPath из files[0]) + prettier configless (формат).
 */
export const json = defineLinter({
  name: "json",
  exts: [".json"],
  cold: [
    { bin: "jq", args: (files) => ["empty", files[0]], parse: parseJqEmpty, perFile: true, configless: true },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
});
