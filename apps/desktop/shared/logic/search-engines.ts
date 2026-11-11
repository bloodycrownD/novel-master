/**
 * Desktop renderer 对 `@novel-master/core` 搜索引擎模板 / 草稿解析能力的
 * 具名薄再导出（X1 门禁：renderer 不得直连 core）。禁止 `export *`。
 *
 * 引擎实例 id 已动态化（六预置 ∪ `duckduckgo` ∪ customEngines 现存 id）：
 * 旧静态清单 `ENGINE_IDS` / `KEY_ENGINE_IDS` 与 `EngineId` / `KeyEngineId`
 * 收窄类型已退役——需要清单 / 顺序 / needsKey 时读配置 DTO（core
 * `readConfig()` 的同构形状），不再从本模块取常量。
 */

export type {
  CurlCommandDraft,
  CurlParseError,
  CustomEngineDef,
  SearchEngineTemplate,
} from "@novel-master/core";

export {
  PRESET_ENGINE_TEMPLATES,
  parseCurlCommand,
  validateSearchEngineTemplate,
} from "@novel-master/core";
