import { defineLinter } from "./constructor.ts";
import { parsePrettierList, parseYamllint } from "../parse.ts";

/**
 * YAML: yamllint (parsable, configless — работает без конфига) + prettier
 * (configless, глобальный). Зависимость: yamllint (Arch: `sudo pacman -S yamllint`).
 */
export const yaml = defineLinter({
  name: "yaml",
  exts: [".yaml", ".yml"],
  cold: [
    { bin: "yamllint", args: (files) => ["-f", "parsable", ...files], parse: parseYamllint, configless: true },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
});
