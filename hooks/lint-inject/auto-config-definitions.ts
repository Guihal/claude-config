import { execFileSync } from "node:child_process";
import * as path from "node:path";

export const AUTO_MARKER = "AUTO-GENERATED-BY-LINT-INJECT";

export type AutoConfig = {
  file: string;
  content: string | ((timeoutMs?: number) => string);
  configNames: string[];
  pkgKeys?: string[];
};

export function resolveAutoConfigContent(config: AutoConfig, timeoutMs?: number): string {
  return typeof config.content === "function" ? config.content(timeoutMs) : config.content;
}

export const TS_CONFIG_DEFAULT: AutoConfig = {
  file: "tsconfig.json",
  content: `// ${AUTO_MARKER}
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "types": []
  },
  "include": ["**/*.ts", "**/*.vue"]
}
`,
  configNames: ["tsconfig.json"],
};

let globalNodeModules: string | undefined;

function npmGlobalRoot(timeoutMs = 1_000): string {
  if (globalNodeModules) return globalNodeModules;
  try {
    globalNodeModules = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      timeout: Math.max(1, Math.min(1_000, timeoutMs)),
    }).trim();
  } catch {
    globalNodeModules = "/usr/lib/node_modules";
  }
  return globalNodeModules;
}

export const ESLINT_CONFIG_DEFAULT: AutoConfig = {
  file: "eslint.config.mjs",
  content: (timeoutMs) => `// ${AUTO_MARKER}
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tsParser = require(${JSON.stringify(path.join(npmGlobalRoot(timeoutMs), "@typescript-eslint", "parser", "dist", "index.js"))});
export default [
  {
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-console": "warn"
    }
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tsParser },
    rules: { "no-console": "warn" }
  }
];
`,
  configNames: [
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
    "eslint.config.ts", "eslint.config.mts", "eslint.config.cts",
  ],
};

export const STYLELINT_CONFIG_DEFAULT: AutoConfig = {
  file: "stylelint.config.mjs",
  content: `// ${AUTO_MARKER}
export default { rules: {
  "block-no-empty": true,
  "color-no-invalid-hex": true,
  "declaration-block-no-duplicate-properties": true,
  "no-duplicate-selectors": true
} };
`,
  configNames: [
    "stylelint.config.js", "stylelint.config.cjs", "stylelint.config.mjs",
    "stylelint.config.json", "stylelint.config.yaml", "stylelint.config.yml",
    ".stylelintrc", ".stylelintrc.json", ".stylelintrc.yaml", ".stylelintrc.yml",
    ".stylelintrc.js", ".stylelintrc.cjs",
  ],
  pkgKeys: ["stylelint"],
};

export const MARKDOWNLINT_CONFIG_DEFAULT: AutoConfig = {
  file: ".markdownlintrc",
  content: `{
  // ${AUTO_MARKER}
  "MD013": false,
  "MD024": false,
  "MD033": false,
  "MD041": false
}
`,
  configNames: [
    ".markdownlintrc", ".markdownlint.json", ".markdownlint.jsonc",
    ".markdownlint.yaml", ".markdownlint.yml", ".markdownlint.js", ".markdownlint.cjs",
  ],
};
