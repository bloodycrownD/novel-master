/**
 * Desktop chat 文案 catalogs 的落点：renderer 不得直连 `@novel-master/core`，
 * 这里只做具名再导出（禁止 `export *`，也禁止普通 import——X1 护栏要求 shared/logic 只作转发层）。
 * JSON 走 import attribute：desktop 主 tsconfig 是 NodeNext，纯 `import x from "*.json"` 会报 TS1543。
 */

export { default as chatEnUSCatalogs } from "@novel-master/core/locales/chat.en-US.json" with { type: "json" };
export { default as chatZhCNCatalogs } from "@novel-master/core/locales/chat.zh-CN.json" with { type: "json" };
export { createTranslator, type MessageCatalog } from "@novel-master/core/common";
export type { ChatMessageKey } from "@novel-master/core/chat";
