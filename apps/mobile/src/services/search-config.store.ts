/**
 * 搜索引擎配置：薄封装 `runtime.searchConfig`（core `createSearchConfigStore`
 * 工厂在 create-mobile-runtime 装配，闭包注入 kkv + secretStore）。
 *
 * 凭证安全口径与 core 侧一致：API key 明文只经 SKSP（ref
 * `search/{engineId}/apiKey`）写入，本模块与 UI 全程只消费
 * `configured: boolean` 状态，不读取、不回显明文——形态照
 * cloud-sync-config.store 的 secretKeySet 先例。
 *
 * @module services/search-config.store
 */
import type {
  EngineId,
  KeyEngineId,
  SearchConfigPublic,
  SearchConfigStore,
} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

export type {EngineId, KeyEngineId, SearchConfigPublic, SearchConfigStore};

/**
 * 需要 API key 的引擎（searxng 走自托管 baseUrl，无 key）。
 * 清单真源是 core 的 `KEY_ENGINE_IDS`（ui/C-1 收敛），此处仅重导出
 * 供 UI 使用，不再维护本地副本。
 */
export {KEY_ENGINE_IDS} from '@novel-master/core';

/** 取 runtime 装配好的搜索配置存储（读写入口统一收口到本模块）。 */
export function getSearchConfigStore(
  runtime: MobileNovelMasterRuntime,
): SearchConfigStore {
  return runtime.searchConfig;
}

/** 读取对外搜索配置（便捷入口；语义同 store.readConfig）。 */
export async function readSearchEngineConfig(
  runtime: MobileNovelMasterRuntime,
): Promise<SearchConfigPublic> {
  return getSearchConfigStore(runtime).readConfig();
}
