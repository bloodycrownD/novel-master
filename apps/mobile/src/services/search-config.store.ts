/**
 * 搜索引擎配置入口：`getSearchConfigStore(runtime)` 取 core
 * `createSearchConfigStore` 工厂在 create-mobile-runtime 装配好的存储
 * （闭包注入 kkv + secretStore），UI 直接调 store 方法
 * （`readConfig` / `setEnabled` / `setEngineOrder` / `createCustomEngine` /
 * `testEngine` 等），不再在本模块造转手便捷函数。
 *
 * 凭证安全口径与 core 侧一致：API key 明文只经 SKSP（ref
 * `search/{engineId}/apiKey`）写入，本模块与 UI 全程只消费读模型里的
 * `hasKey` 状态，不读取、不回显明文——形态照 cloud-sync-config.store 的
 * secretKeySet 先例。
 *
 * @module services/search-config.store
 */
import type {SearchConfigStore} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * 取 runtime 装配好的搜索配置存储。
 * nm-style: keep-public — spec §7/§8 双端 UI 访问搜索配置 store 的唯一入口
 * （kkv + secretStore 在 runtime 装配处注入，UI 不感知依赖装配）。
 */
// prettier-ignore
export function getSearchConfigStore(runtime: MobileNovelMasterRuntime): SearchConfigStore {
  return runtime.searchConfig;
}
