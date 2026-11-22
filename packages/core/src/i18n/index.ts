/**
 * `@novel-master/core/i18n` 子入口：key 契约、catalog 解析与错误→descriptor 映射。
 *
 * catalog 数据文件在包根 `resources/i18n/` 下（与 sql 同居 resources：非 TS 源统一管理），
 * 经 gen-i18n-catalog.mjs 生成 generated-catalog 内嵌进包；YAML 本体不进包、不进公开面。
 * core 运行时不读盘、不建全局 translator、不持 locale——加载与 translator
 * 创建由各宿主完成（spec docs/Iterations/i18n-normalization §2.4）；core 侧
 * 的默认接线在 `test/helpers/core-i18n.ts`（tCore）。
 *
 * @module i18n
 */

export { createTranslator, type MessageCatalog, type MessageDescriptor, type MessageLike, type MessageParams } from "@/common/i18n.js";
export { CORE_MESSAGE_KEY_PATTERN, ERROR_KEY_DOMAINS, LABEL_KEY_DOMAINS, UI_KEY_DOMAINS, CORE_MESSAGE_KEYS, type CoreMessageKey, type CoreMessageDescriptor } from "./keys.js";
export { CORE_CATALOGS } from "./generated-catalog.js";
export { LocalizedMessage } from "./localized-message.js";
export { ErrorMessage } from "./error-message.js";
