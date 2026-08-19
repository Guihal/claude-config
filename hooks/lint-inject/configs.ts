export {
  AUTO_MARKER,
  ESLINT_CONFIG_DEFAULT,
  MARKDOWNLINT_CONFIG_DEFAULT,
  STYLELINT_CONFIG_DEFAULT,
  TS_CONFIG_DEFAULT,
  resolveAutoConfigContent,
  type AutoConfig,
} from "./auto-config-definitions.ts";

export {
  acquireAutoConfig,
  findUserConfig,
  hasAutoMarker,
  releaseAutoConfig,
  writeExclusiveConfig,
  type AutoConfigLease,
  type AutoConfigUse,
} from "./auto-config.ts";
