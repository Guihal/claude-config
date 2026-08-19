import { defineLinter } from "./constructor.ts";
import { parseHadolintJson } from "../parse.ts";

/**
 * Dockerfile: hadolint --format json (configless — дефолтные правила).
 * Установлен: бинарь hadolint 2.15.1 с GitHub releases (~/.local/bin).
 * names: basename-матч — Dockerfile без расширения (точный регистр).
 */
export const dockerfile = defineLinter({
  name: "dockerfile",
  exts: [".dockerfile"],
  names: ["Dockerfile"],
  cold: [{ bin: "hadolint", args: (files) => ["--format", "json", ...files], parse: parseHadolintJson, configless: true }],
});
