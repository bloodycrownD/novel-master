/**
 * 引擎分发：按 `ResolvedEngineConfig.engine` 路由到对应适配器，
 * 并集中持有「未配置」提示文案（search 工具 run 在解析链返回 null 时
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

/**
 * 未配置任何搜索引擎时的提示（工具成功输出，含双端配置入口指引）。
 */
export const SEARCH_NOT_CONFIGURED_MESSAGE =
  "未配置任何搜索引擎。请先完成配置后重试：桌面端「设置 → AI 搜索」、移动端「我的 → 配置 → AI 搜索」；可为 bocha / tavily / brave 填写 API key，或为自托管的 searxng 填写 baseUrl。";

/**
 * 按解析结果分发到引擎适配器。适配器抛出的错误由调用方（search 工具
 * run）统一 `toolFailed("search", cause)` 包装。
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
  }
}
