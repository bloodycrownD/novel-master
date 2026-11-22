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

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { SearchEngine, type FetchFn, type ResolvedEngineConfig, type SearchResponse, type SearchToolOptions, type ToolParams } from "../types.js";
import { Duckduckgo } from "./duckduckgo.js";
import { TemplateEngine } from "./template-engine.js";

/**
 * 链空（无可用已启用引擎）时的提示（工具成功输出）。
 *
 * 中性口径：同时覆盖「全关」与「显式指定不可用引擎且截尾后链空」两种到达
 * 路径，不谎报「未启用任何」、不枚举引擎 id。
 */
export const SEARCH_NOT_CONFIGURED_MESSAGE = "当前没有可用的已启用搜索引擎，请在 设置 → 搜索配置 开启或配置引擎";

export const SearchDispatch = {
    /**
   * 按解析结果分发到代码适配器 / 模板执行器（单引擎请求，串行降级循环在
   * search 工具 run 内）。已知引擎失败与未知引擎（模板缺失）均收 `Result.err`
   * 由调用方逐引擎收集（该引擎计一次失败、降级到链中下一员）；全链失败 /
   * 预算耗尽时聚合为一条 `toolFailed("search", …)` 返回。未知异常（非 abort
   * 的 fetch 错误）仍抛，调用方 catch 同口收编。
   *
   * `params` 是工具层自由 JSON（Step 4 接线透传），原样交给模板执行器；
   * DDG 无模板、忽略 params。
   *
   * nm-style: keep-public — spec §4 引擎分发唯一入口（search 工具 run 消费）。
   */
    async dispatch(resolved: ResolvedEngineConfig, query: string, options: SearchToolOptions, params: ToolParams, fetch: FetchFn, signal?: AbortSignal): Promise<Result<SearchResponse, AppError>> {
        if (resolved.engine === "duckduckgo") return Duckduckgo.search(resolved, query, options, fetch, signal);
        const template = resolved.template;
        if (template == null) return Result.err(SearchEngine.failed(`unknown search engine: ${resolved.engine} (no template resolved)`));
        return TemplateEngine.run(template, resolved, query, options, params, fetch, signal);
    },
} as const;
