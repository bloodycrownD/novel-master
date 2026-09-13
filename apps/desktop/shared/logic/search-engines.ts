/**
 * Desktop renderer 对 `@novel-master/core` root 的搜索引擎清单薄再导出
 * （ui/C-1 单一真源：`ENGINE_IDS` / `KEY_ENGINE_IDS` 定义于 core
 * search types，双端配置页的清单/顺序一律由此派生，不再手工副本）。
 * 禁止 `export *`。
 */

export { ENGINE_IDS, KEY_ENGINE_IDS } from "@novel-master/core";

export type { EngineId, KeyEngineId } from "@novel-master/core";
