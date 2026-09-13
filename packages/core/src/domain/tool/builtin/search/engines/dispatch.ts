/**
 * 引擎分发：按 `ResolvedEngineConfig.engine` 路由到对应适配器，
 * 并集中持有「未配置」提示文案（search 工具 run 在解析链返回空数组时
 * 以该文案作为成功输出回流，非错误）。
 *
 * @module domain/tool/builtin/search/engines/dispatch
 */

import type {
  ResolvedEngineConfig,
  SearchResponse,
  SearchToolOptions,
} from "../types.js";
import { searchWithBocha } from "./bocha.js";
import { searchWithTavily } from "./tavily.js";
import { searchWithBrave } from "./brave.js";
import { searchWithSearxng } from "./searxng.js";
import { searchWithDuckduckgo } from "./duckduckgo.js";

/**
 * 未配置任何搜索引擎时的提示（工具成功输出，含双端配置入口指引）。
 *
 * 常规不可达（第三轮修订后）：duckduckgo 恒 configured 使解析链非空；
 * 仅作为链空的防御路径保留（如未来引擎清单变更 / 装配异常）。
 */
export const SEARCH_NOT_CONFIGURED_MESSAGE =
  "未配置任何搜索引擎。请先完成配置后重试：桌面端「设置 → AI → 搜索配置」、移动端「我的 → 配置 → 搜索配置」；可为 bocha / tavily / brave 填写 API key，或为自托管的 searxng 填写 baseUrl。";

/**
 * 按解析结果分发到引擎适配器（单引擎请求，串行降级循环在
 * search 工具 run 内）。适配器抛出的错误由调用方逐引擎收集、
 * 全链失败 / 预算耗尽时聚合为一条 `toolFailed("search", …)` 返回。
 */
export function dispatchSearch(
  resolved: ResolvedEngineConfig,
  query: string,
  options: SearchToolOptions,
  fetchFn: typeof globalThis.fetch
): Promise<SearchResponse> {
  switch (resolved.engine) {
    case "bocha":
      return searchWithBocha(resolved, query, options, fetchFn);
    case "tavily":
      return searchWithTavily(resolved, query, options, fetchFn);
    case "brave":
      return searchWithBrave(resolved, query, options, fetchFn);
    case "searxng":
      return searchWithSearxng(resolved, query, options, fetchFn);
    case "duckduckgo":
      return searchWithDuckduckgo(resolved, query, options, fetchFn);
  }
}
