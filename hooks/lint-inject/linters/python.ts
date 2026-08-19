import { defineLinter } from "./constructor.ts";
import { parsePyCompile, parseRuffJson } from "../parse.ts";

/**
 * Python: python -m py_compile (синтаксис, configless; PYTHONPYCACHEPREFIX уводит .pyc
 * из проекта) + ruff (спит: бинарь не установлен). perFile: CLI выходит на первой ошибке.
 */
export const python = defineLinter({
  name: "python",
  exts: [".py"],
  cold: [
    {
      bin: "python",
      args: (files) => ["-m", "py_compile", files[0]],
      parse: parsePyCompile,
      perFile: true,
      configless: true,
      env: { PYTHONPYCACHEPREFIX: "/tmp" },
    },
    { bin: "ruff", args: (files) => ["check", "--output-format", "json", ...files], parse: parseRuffJson, configless: true },
  ],
});
