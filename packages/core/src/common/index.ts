/**
 * 跨端通用纯工具函数 barrel。
 *
 * 这些函数原本在 desktop / mobile 各自的 utils 里抄了一份，现在统一收敛到这里，
 * 通过 `@novel-master/core/common` 子路径暴露给三端（desktop main、desktop
 * renderer、mobile）共享。
 */
export { compareAppVersions } from "./compare-app-versions.js";
export {
  excerptReleaseNotes,
  type ReleaseNotesFocus,
} from "./excerpt-release-notes.js";
export {
  formatTokenCount,
  formatPromptTokenUsageLabel,
} from "./format-token-count.js";
export { normalizeYamlError } from "./normalize-yaml-error.js";
export {
  formatDurationMs,
  formatRequestTime,
  pageWindowItems,
} from "./usage-stats-format.js";
