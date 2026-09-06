/**
 * `search` 工具实现：经已配置的搜索引擎（bocha / tavily / brave /
 * searxng）检索网页，回流统一形状的结果列表（title / url / snippet），
 * 让 agent 具备联网检索能力（写作考据、事实核验、资料收集）。
 *
 * 设计口径（SPEC web-search-tool Step 4）：
 * - 引擎选择经 `ctx.search` 闭包（装配点注入）解析：input.engine →
 *   defaultEngine → 第一个 configured 引擎；全无 → 返回含配置入口指引
 *   的提示（成功输出、非错误）。
 * - 网络入口经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch，照 curl）；
 *   适配器错误统一 `toolFailed("search", cause)` 包装。
 * - 输出预算保险丝：结果序列化超过 `TOOL_OUTPUT_MAX_BYTES`（50KB）时
 *   全文落盘会话工作区 `/tmp/` 并返回 `{savedPath, message}`
 *   （overflow-sink 公共机制，curl 同机制）；落盘失败回落完整结果
 *   （正常搜索结果约 15KB 封顶，超预算与落盘失败双罕见）。
 * - 不在任何 registry 摘除分支内，主/子/孙 agent 全深度可用（照 curl）。
 *
 * @module domain/tool/builtin/search/search-tool
 */

import { z } from "zod";

import { toolFailed } from "@/errors/tool-errors.js";
import { TOOL_OUTPUT_MAX_BYTES } from "@/domain/tool/logic/tool-output-limits.js";
import type { Tool } from "../../model/tool.js";
import type { BuiltinToolContext } from "../builtin-tool-context.js";
import { sinkOversizedOutput } from "../overflow-sink.js";
import {
  DEFAULT_MAX_RESULTS,
  ENGINE_IDS,
  MAX_RESULTS_LIMIT,
  normalizeMaxResults,
  type SearchOversizeOutput,
  type SearchResponse,
} from "./types.js";
import {
  dispatchSearch,
  SEARCH_NOT_CONFIGURED_MESSAGE,
} from "./engines/dispatch.js";

/** 工具名（注册表 / catalog / policy 共用）。 */
export const SEARCH_TOOL_NAME = "search";

/** `search` 工具输入（schema 本期只开放 query / maxResults / engine）。 */
export interface SearchToolInput {
  /** 搜索关键词。 */
  readonly query: string;
  /** 结果条数：缺省 5；小于 1 回落 5、超过 20 收敛到 20（不报错）。 */
  readonly maxResults?: number;
  /** 可选：指定引擎；缺省按解析链（defaultEngine → 第一个已配置）。 */
  readonly engine?: (typeof ENGINE_IDS)[number];
}

/**
 * `search` 工具输出三形态：
 * - `SearchResponse`：正常结果（engine + 可选 answer + results）；
 * - `SearchOversizeOutput`：超 50KB 落盘形态（Step 6 接线后出现）；
 * - `string`：未配置任何引擎时的配置指引提示。
 */
export type SearchToolOutput = SearchResponse | SearchOversizeOutput | string;

/**
 * 静态 `search` 工具实例。
 *
 * description 是静态 lambda（引擎配置在 run 内解析，装配期不取数）；
 * 是否对 LLM 可见由 `resolveAgentToolRegistry` 的 tools.allow/deny 控制。
 */
export const searchTool: Tool<
  SearchToolInput,
  SearchToolOutput,
  BuiltinToolContext
> = {
  name: SEARCH_TOOL_NAME,
  description: () =>
    `联网搜索：经已配置的搜索引擎（bocha / tavily / brave / searxng）检索网页，返回结果列表（标题 / 链接 / 摘要），适用于写作资料查找、事实核验与背景考据。

入参：
- query：搜索关键词（必填）
- maxResults：结果条数，默认 5，范围 1..20（超出范围自动收敛）
- engine：可选，指定引擎 bocha/tavily/brave/searxng；缺省按「默认引擎 → 第一个已配置引擎」解析，指定的引擎未配置时顺位回落

结果格式：可读文本，非 JSON——首行为「search 引擎 · N 条结果」，tavily 的原生回答（如有）紧随其后，其后为「- 标题 — 链接 — 摘要」紧凑列表；结果超过 50KB 时全文自动保存到会话工作区 /tmp/（可用 read 读取）并显示落盘路径。

注意：需先在设置中配置至少一个搜索引擎（bocha/tavily/brave 的 API key 或自托管 searxng 的 baseUrl），未配置时调用返回配置指引；引擎调用失败（key 无效 / 超时）返回可读错误。`,
  inputSchema: z.object({
    query: z.string().min(1).describe("搜索关键词"),
    maxResults: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        `结果条数，默认 ${DEFAULT_MAX_RESULTS}，范围 1..${MAX_RESULTS_LIMIT}（超出范围自动收敛，不报错）`
      ),
    engine: z
      .enum(ENGINE_IDS)
      .optional()
      .describe(
        "可选：指定搜索引擎；缺省按「默认引擎 → 第一个已配置引擎」解析"
      ),
  }),
  outputSchema: z.union([
    z.string(),
    z.object({
      engine: z.enum(ENGINE_IDS),
      answer: z.string().optional(),
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        })
      ),
    }),
    z.object({
      engine: z.enum(ENGINE_IDS),
      savedPath: z.string(),
      message: z.string(),
    }),
  ]),
  async run(input, ctx) {
    const search = ctx.search;
    if (search == null) {
      // 未装配闭包（CLI 无 kkv / 旧测试 mock）：可读错误而非崩溃。
      throw toolFailed(
        SEARCH_TOOL_NAME,
        new Error(
          "search 工具未装配搜索上下文（当前运行时未注入搜索配置）"
        )
      );
    }

    // 引擎解析链：input.engine → defaultEngine → 第一个 configured；
    // 全无 → 未配置提示（成功输出，含双端配置入口指引，非错误）。
    const resolved = await search.resolveActiveEngine(input.engine);
    if (resolved == null) {
      return SEARCH_NOT_CONFIGURED_MESSAGE;
    }

    try {
      const response = await dispatchSearch(
        resolved,
        input.query,
        { maxResults: normalizeMaxResults(input.maxResults) },
        ctx.fetchFn ?? globalThis.fetch
      );

      // —— 超 50KB 落盘保险丝（overflow-sink，curl 同机制）——
      // 序列化后按 UTF-8 字节计预算，超预算时全文落盘会话工作区 /tmp/
      // （子代理经装配链落父会话工作区），改回 {engine, savedPath,
      // message}；落盘失败（如 vfs 不可用）回落完整结果，不因落盘
      // 故障丢搜索所得。
      const serialized = JSON.stringify(response);
      if (
        new TextEncoder().encode(serialized).byteLength > TOOL_OUTPUT_MAX_BYTES
      ) {
        try {
          const sink = await sinkOversizedOutput(ctx, {
            tool: SEARCH_TOOL_NAME,
            content: serialized,
            contentType: "application/json",
          });
          return {
            engine: response.engine,
            savedPath: sink.savedPath,
            message: sink.message,
          };
        } catch (error) {
          console.debug("[search] 超预算落盘失败，回落完整输出:", error);
        }
      }
      return response;
    } catch (e) {
      throw toolFailed(SEARCH_TOOL_NAME, e);
    }
  },
};
