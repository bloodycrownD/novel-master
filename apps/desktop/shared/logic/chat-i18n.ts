/**
 * Desktop chat 文案 catalogs 的落点：renderer 不得直连 `@novel-master/core`，
 * 这里只做具名再导出（禁止 `export *`，也禁止普通 import——X1 护栏要求 shared/logic 只作转发层）。
 * catalog 走 core 构建期内嵌 TS（YAML 唯一真源经 gen-i18n-catalog.mjs 生成）。
 */

export { CHAT_CATALOGS } from "@novel-master/core/i18n/catalog/chat";
export { createTranslator, type MessageCatalog } from "@novel-master/core/common";
export type { ChatMessageKey } from "@novel-master/core/chat";
