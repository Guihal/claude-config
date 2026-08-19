import { defineLinter } from "./constructor.ts";
import { parsePrettierList } from "../parse.ts";

/** HTML: prettier --list-different (configless, глобальный — в PATH после npm i -g). */
export const html = defineLinter({
  name: "html",
  exts: [".html", ".htm"],
  cold: [{ bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true }],
});
