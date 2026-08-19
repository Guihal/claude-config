import { defineLinter } from "./constructor.ts";
import { parseBashSyntax, parseShellcheckJson } from "../parse.ts";

/**
 * Shell: bash -n (синтаксис, configless, LC_ALL=C — англ. сообщения) + shellcheck
 * (спит: бинарь не установлен). bash -n принимает один файл за вызов — perFile.
 */
export const shell = defineLinter({
  name: "shell",
  exts: [".sh"],
  cold: [
    {
      bin: "bash",
      args: (files) => ["-n", files[0]],
      parse: parseBashSyntax,
      perFile: true,
      configless: true,
      env: { LC_ALL: "C" },
    },
    { bin: "shellcheck", args: (files) => ["--format=json", ...files], parse: parseShellcheckJson, configless: true },
  ],
});
