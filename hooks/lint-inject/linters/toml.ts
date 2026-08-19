import { defineLinter } from "./constructor.ts";
import { parseTaploText } from "../parse.ts";

/**
 * TOML: taplo lint (configless — дефолтные правила, конфиг не обязателен).
 * Установлен: `cargo install --root ~/.local taplo-cli` (taplo 0.10.0, ~/.local/bin в PATH).
 * Вывод — miette-формат (parseTaploText).
 */
export const toml = defineLinter({
  name: "toml",
  exts: [".toml"],
  cold: [{ bin: "taplo", args: (files) => ["lint", ...files], parse: parseTaploText, configless: true }],
});
