import { defineLinter } from "./constructor.ts";
import { parseClippyJson, parseRustfmtCheck } from "../parse.ts";

/**
 * Rust: rustfmt --check (формат, configless; --edition 2024 — rustfmt ≥1.8, на машине 1.9.0;
 * перекрывает Cargo.toml edition — осознанно для standalone .rs) + cargo clippy
 * (project-level, slow, требует Cargo.toml).
 */
export const rust = defineLinter({
  name: "rust",
  exts: [".rs"],
  cold: [
    {
      bin: "rustfmt",
      args: (files) => ["--check", "--color", "never", "--edition", "2024", ...files],
      parse: parseRustfmtCheck,
      configless: true,
    },
    {
      bin: "cargo",
      args: () => ["clippy", "--message-format=json", "--quiet", "--no-deps"],
      parse: parseClippyJson,
      slow: true,
    },
  ],
});
