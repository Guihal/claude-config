import { defineLinter } from "./constructor.ts";
import { parseSqlfluffJson } from "../parse.ts";

/**
 * SQL: sqlfluff lint --format json (--dialect ansi: v4+ требует dialect; configless —
 * работает с дефолтами без конфига). Зависимость: `uv tool install sqlfluff`.
 */
export const sql = defineLinter({
  name: "sql",
  exts: [".sql"],
  cold: [{ bin: "sqlfluff", args: (files) => ["lint", "--format", "json", "--dialect", "ansi", ...files], parse: parseSqlfluffJson, configless: true }],
});
