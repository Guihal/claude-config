import { defineLinter } from "./constructor.ts";
import { parseGofmtList, parseGoVet } from "../parse.ts";

/**
 * Go: go vet (project-level, slow — как clippy) + gofmt -l (быстрый, configless).
 * Зависимость: нужен Go toolchain (Arch: `sudo pacman -S go`).
 * go vet без go.mod в gitRoot молча падает (exit 1) → parseError → backoff.
 */
export const go = defineLinter({
  name: "go",
  exts: [".go"],
  cold: [
    { bin: "go", args: () => ["vet", "./..."], parse: parseGoVet, slow: true },
    { bin: "gofmt", args: (files) => ["-l", ...files], parse: parseGofmtList, configless: true },
  ],
});
