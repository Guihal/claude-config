import { defineLinter } from "./constructor.ts";
import { parseMarkdownlintJson } from "../parse.ts";
import { MARKDOWNLINT_CONFIG_DEFAULT } from "../configs.ts";

/**
 * Markdown: markdownlint с авто-конфигом (.markdownlintrc, JSONC — ищется вверх от cwd;
 * rc-JSONC-снайф не проверен на реальном бинаре: markdownlint не установлен — спит).
 */
export const markdown = defineLinter({
  name: "markdown",
  exts: [".md"],
  cold: [{ bin: "markdownlint", args: (files) => ["--json", ...files], parse: parseMarkdownlintJson, autoConfig: MARKDOWNLINT_CONFIG_DEFAULT }],
});
