/**
 * Desktop settings 文案 catalogs 的落点：renderer 不得直连 `@novel-master/core`，
 * 这里只做具名再导出（禁止 `export *`，也禁止普通 import——X1 护栏要求 shared/logic 只作转发层）。
 * JSON 走 import attribute：desktop 主 tsconfig 是 NodeNext，纯 `import x from "*.json"` 会报 TS1543。
 */

export { default as settingsEnUSCatalogs } from "@novel-master/core/locales/settings.en-US.json" with { type: "json" };
export { default as settingsZhCNCatalogs } from "@novel-master/core/locales/settings.zh-CN.json" with { type: "json" };
export { createTranslator, type MessageCatalog } from "@novel-master/core/common";
export type { SettingsMessageKey } from "@novel-master/core/settings";
