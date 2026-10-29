/**
 * 跨端通用纯工具函数 barrel。
 *
 * 这些函数原本在 desktop / mobile 各自的 utils 里抄了一份，现在统一收敛到这里，
 * 通过 `@novel-master/core/common` 子路径暴露给三端（desktop main、desktop
 * renderer、mobile）共享。文件按类别组织（encoding / error / json / release…），
 * 新工具优先并进已有类别文件。
 */
export {base64ToBytes, bytesToBase64, utf8ByteLength} from "./encoding.js";
export {parseJsonText, applyMergePatch} from "./json.js";
export {truncateText} from "./text.js";
export {isBinaryFilePath, isImageFilePath} from "./file.js";
export {integerAtLeast, nullableText, stringOrEmpty} from "./coerce.js";
export {errorText, normalizeYamlError, normalizeSmartSortImportError} from "./error.js";
export {isRecord} from "./guards.js";
export {compareAppVersions, excerptReleaseNotes} from "./release.js";
export {
    formatTokenCount,
    // token-source-label：badge 与完整占用标签的单源（infra/tokenizer 与
    // public/provider 经 logic 文件再导出同一份实现）。
    formatTokenSourceBadge,
    formatContextUsageLabel,
    type TokenSourceBadge,
} from "./format-token-count.js";
export {
    formatDurationMs,
    formatRequestTime,
    pageWindowItems,
} from "./usage-stats-format.js";

export {
    createTranslator,
    type MessageCatalog,
    type MessageDescriptor,
    type MessageLike,
} from "./i18n.js";
