/**
 * 引擎分发：按 `ResolvedEngineConfig.engine` 路由——`duckduckgo` 走保留的
 * 代码适配器（HTML 解析），其余引擎一律走模板执行器（模板由链解析一次性
 * 携带在 `resolved.template`，dispatch 不做二次查找）。
 *
 * 并集中持有「链空」提示文案（search 工具 run 在解析链返回空数组时
 * 以该文案作为成功输出回流，非错误）。
 *
 * @module domain/tool/builtin/search/engines/dispatch
 */

import { engineFailed, type ResolvedEngineConfig, type SearchResponse, type SearchToolOptions } from "../types.js";
import { searchWithDuckduckgo } from "./duckduckgo.js";
import { runTemplateEngine } from "./template-engine.js";

/**
 * 链空（无可用已启用引擎）时的提示（工具成功输出）。
 *
 * 中性口径：同时覆盖「全关」与「显式指定不可用引擎且截尾后链空」两种到达
 * 路径，不谎报「未启用任何」、不枚举引擎 id。
 */
export const SEARCH_NOT_CONFIGURED_MESSAGE = "当前没有可用的已启用搜索引擎，请在 设置 → 搜索配置 开启或配置引擎";

/**
 * 按解析结果分发到代码适配器 / 模板执行器（单引擎请求，串行降级循环在
 * search 工具 run 内）。抛出的错误由调用方逐引擎收集、全链失败 / 预算
 * 耗尽时聚合为一条 `toolFailed("search", …)` 返回。
 *
 * `params` 是工具层自由 JSON（Step 4 接线透传），原样交给模板执行器；
 * DDG 无模板、忽略 params。函数标 `async`：template 缺失分支同样以
 * rejected promise 回流（不走同步 throw，与 fetch 路径同时序）。
 *
 * nm-style: keep-public — spec §4 引擎分发唯一入口（search 工具 run 消费）。
 */
export async function dispatchSearch(resolved: ResolvedEngineConfig, query: string, options: SearchToolOptions, params: Readonly<Record<string, unknown>> = {}, fetchFn: typeof globalThis.fetch): Promise<SearchResponse> {
  if (resolved.engine === "duckduckgo") return searchWithDuckduckgo(resolved, query, options, fetchFn);
  const template = resolved.template;
  if (template == null) throw engineFailed(`unknown search engine: ${resolved.engine} (no template resolved)`);
  return runTemplateEngine(template, resolved, query, options, params, fetchFn);
}
