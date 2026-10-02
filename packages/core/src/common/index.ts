/**
 * 跨端通用纯工具函数 barrel。
 *
 * 这些函数原本在 desktop / mobile 各自的 utils 里抄了一份，现在统一收敛到这里，
 * 通过 `@novel-master/core/common` 子路径暴露给三端（desktop main、desktop
 * renderer、mobile）共享。
 */
export { compareAppVersions } from "./compare-app-versions.js";
export { errorText } from "./error-text.js";
export {
  excerptReleaseNotes,
  type ReleaseNotesFocus,
} from "./excerpt-release-notes.js";
export {
  formatTokenCount,
  formatPromptTokenUsageLabel,
  // token-source-label：badge 与完整占用标签的单源（infra/tokenizer 与
  // public/provider 经 logic 文件再导出同一份实现）。
  formatTokenSourceBadge,
  formatContextUsageLabel,
  type TokenSourceBadge,
} from "./format-token-count.js";
export { normalizeYamlError } from "./normalize-yaml-error.js";
// 存储类故障判据（YAML 导入通道的「反转让 TdbcError 绕过 normalizeYamlError」）。
export { isStorageFailure } from "./is-storage-failure.js";
// 智能排序规则 YAML 导入通道的错误标签单源（把 desktop + mobile 两份字面量三元
// 收敛成一处，测试直接测它 ⇒ 顺带把「测试只重演、不守接线」的缺口闭上）。
export {
  normalizeSmartSortImportError,
  SMART_SORT_IMPORT_YAML_INVALID_LABEL,
} from "./normalize-smart-sort-import-error.js";
export {
  formatDurationMs,
  formatRequestTime,
  pageWindowItems,
} from "./usage-stats-format.js";
