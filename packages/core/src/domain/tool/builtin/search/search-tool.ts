/**
 * `search` 工具实现：经已配置的搜索引擎（bocha / tavily / brave /
 * searxng / duckduckgo）检索网页，回流统一形状的结果列表（title /
 * url / snippet），让 agent 具备联网检索能力（写作考据、事实核验、
 * 资料收集）；未配置付费引擎时由内置 DuckDuckGo 免费搜索兜底（PRD
 * R1.2，搜索开箱即用）。
 *
 * 设计口径（SPEC web-search-tool Step 4，修订轮串行链）：
 * - 引擎链经 `ctx.search` 闭包解析（engineOrder 优先级序；显式
 *   input.engine 时从该引擎起截取、未配置顺位回落链中下一个
 *   configured）；全无 → 返回含配置入口指引的提示（成功输出、非错误）。
 * - 串行执行：从链首起依次请求已配置引擎，请求失败（任何错误类型）
 *   → 尝试链中下一个；显式 input.engine 时钉死链首、失败不降级直接
 *   报错。链总预算 120s（每引擎尝试前检查剩余额度，耗尽带已收集
 *   错误返回）；全链失败抛聚合错误（每引擎一行摘要，不泄漏 key）。
 * - 成功输出携带 `attempts` 尝试轨迹（如「bocha 失败(401) → tavily
 *   成功」；首发成功省略该字段）。
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
  redactSecret,
  type ResolvedEngineConfig,
  type SearchChainOutput,
  type SearchOversizeOutput,
} from "./types.js";
import {
  dispatchSearch,
  SEARCH_NOT_CONFIGURED_MESSAGE,
} from "./engines/dispatch.js";

/** 工具名（注册表 / catalog / policy 共用）。 */
export const SEARCH_TOOL_NAME = "search";

/** 串行链总预算（毫秒）：多引擎依次降级的全链时间上限（引擎自身超时另算）。 */
export const SEARCH_CHAIN_BUDGET_MS = 120_000;

/** 聚合错误 / attempts 轨迹里单引擎错误摘要的截断长度。 */
const ENGINE_ERROR_SUMMARY_LIMIT = 300;

/** `search` 工具输入（schema 本期只开放 query / maxResults / engine）。 */
export interface SearchToolInput {
  /** 搜索关键词。 */
  readonly query: string;
  /** 结果条数：缺省 5；小于 1 回落 5、超过 20 收敛到 20（不报错）。 */
  readonly maxResults?: number;
  /**
   * 可选：指定引擎；缺省按 engineOrder 优先级串行尝试已配置引擎，
   * 前一个失败自动降级到下一个；显式指定时钉死该引擎（未配置顺位
   * 回落），失败不降级直接报错。
   */
  readonly engine?: (typeof ENGINE_IDS)[number];
}

/**
 * `search` 工具输出三形态：
 * - `SearchChainOutput`：正常结果（engine + 可选 answer + results +
 *   可选 attempts 轨迹）；
 * - `SearchOversizeOutput`：超 50KB 落盘形态（Step 6 接线后出现）；
 * - `string`：未配置任何引擎时的配置指引提示。
 */
export type SearchToolOutput =
  | SearchChainOutput
  | SearchOversizeOutput
  | string;

/**
 * 聚合链错误消息：每引擎一行摘要 + 预算耗尽说明（如有）。
 * `untried` 为因预算耗尽未尝试的引擎数（自然链尽时为 0）。
 */
function buildChainErrorMessage(
  failureLines: readonly string[],
  untried: number
): string {
  const parts = [
    "串行搜索链全部尝试失败：",
    ...failureLines,
  ];
  if (untried > 0) {
    parts.push(
      `链总预算 ${SEARCH_CHAIN_BUDGET_MS / 1000}s 已耗尽，剩余 ${untried} 个引擎未尝试。`
    );
  }
  return parts.join("\n");
}

/** 单引擎错误完整摘要（脱敏 + 截断）：聚合错误每引擎一行用。 */
function engineErrorSummary(e: unknown, entry: ResolvedEngineConfig): string {
  const message = e instanceof Error ? e.message : String(e);
  return redactSecret(message, entry.apiKey).slice(0, ENGINE_ERROR_SUMMARY_LIMIT);
}

/** 单引擎错误短摘要：attempts 轨迹括号内用（状态码 / 超时时长 / 消息头）。 */
function engineErrorBrief(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = message.match(/error (\d{3})/i);
  if (status != null) return status[1];
  const timeout = message.match(/timed out after (\d+)ms/);
  if (timeout != null) return `超时 ${timeout[1]}ms`;
  return message.slice(0, 40) || "未知错误";
}

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
    `联网搜索：经已配置的搜索引擎（bocha / tavily / brave / searxng / duckduckgo）检索网页，返回结果列表（标题 / 链接 / 摘要），适用于写作资料查找、事实核验与背景考据；未配置付费引擎时自动使用内置 DuckDuckGo 免费搜索（无需密钥）。

入参：
- query：搜索关键词（必填）
- maxResults：结果条数，默认 5，范围 1..20（超出范围自动收敛）
- engine：可选，指定引擎 bocha/tavily/brave/searxng/duckduckgo；缺省按配置顺序（engineOrder）串行尝试已配置引擎，前一个失败自动降级到下一个；显式指定时钉死该引擎，失败不降级直接报错

结果格式：可读文本，非 JSON——首行为「search 引擎 · N 条结果」，发生过降级时下一行展示尝试轨迹（如「bocha 失败(401) → tavily 成功」），tavily 的原生回答（如有）紧随其后，其后为「- 标题 — 链接 — 摘要」紧凑列表；结果超过 50KB 时全文自动保存到会话工作区 /tmp/（可用 read 读取）并显示落盘路径。

注意：未配置付费引擎（bocha/tavily/brave 的 API key、自托管 searxng 的 baseUrl）时使用内置 DuckDuckGo 免费搜索，无需任何配置即可用；可在设置中配置付费引擎获得更稳定的质量；串行链总预算 120s，全链失败返回逐引擎聚合错误。`,
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
        "可选：指定搜索引擎；缺省按配置顺序串行尝试已配置引擎（失败自动降级），显式指定时钉死该引擎、失败不降级"
      ),
  }),
  outputSchema: z.union([
    z.string(),
    z.object({
      engine: z.enum(ENGINE_IDS),
      answer: z.string().optional(),
      attempts: z.string().optional(),
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

    // 引擎链解析：engineOrder 优先级序（显式 input.engine 时从该引擎起
    // 截取，未配置顺位回落截取链中下一个 configured）；链常规非空
    //（duckduckgo 恒 configured 队尾兜底），空链仅防御路径可达 →
    // 未配置提示（成功输出，含双端配置入口指引，非错误）。
    const chain = await search.resolveEngineChain(input.engine);
    if (chain.length === 0) {
      return SEARCH_NOT_CONFIGURED_MESSAGE;
    }

    // 显式 engine 钉死：只尝试链首（含顺位回落后的链首），失败不降级
    // 直接报错；缺省调用才沿链降级。
    const candidates: readonly ResolvedEngineConfig[] =
      input.engine != null ? chain.slice(0, 1) : chain;
    const fetchFn = ctx.fetchFn ?? globalThis.fetch;
    const options = { maxResults: normalizeMaxResults(input.maxResults) };
    const startedAt = Date.now();
    // 每引擎一行聚合摘要（全链失败 / 预算耗尽时随错误返回）。
    const failureLines: string[] = [];
    // attempts 轨迹分段（「bocha 失败(401)」…，成功引擎由返回处拼接）。
    const attemptParts: string[] = [];
    let success: SearchChainOutput | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i];
      // 链总预算：每引擎尝试前检查剩余额度，耗尽即带已收集错误返回
      //（首引擎前 elapsed 为 0，不会误拦）。
      if (Date.now() - startedAt >= SEARCH_CHAIN_BUDGET_MS) {
        throw toolFailed(
          SEARCH_TOOL_NAME,
          new Error(
            buildChainErrorMessage(failureLines, candidates.length - i)
          )
        );
      }
      try {
        const response = await dispatchSearch(
          entry,
          input.query,
          options,
          fetchFn
        );
        // 降级后成功：输出携带 attempts 轨迹；链首首发成功省略该字段。
        success =
          attemptParts.length === 0
            ? response
            : {
                ...response,
                attempts: `${attemptParts.join(" → ")} → ${response.engine} 成功`,
              };
        break;
      } catch (e) {
        failureLines.push(`${entry.engine}: ${engineErrorSummary(e, entry)}`);
        attemptParts.push(`${entry.engine} 失败(${engineErrorBrief(e)})`);
        // 循环继续：尝试链中下一个 configured 引擎（钉死时仅一员，自然止）。
      }
    }

    if (success == null) {
      // 全链失败：聚合错误（每引擎一行摘要，不泄漏 key）。
      throw toolFailed(
        SEARCH_TOOL_NAME,
        new Error(buildChainErrorMessage(failureLines, 0))
      );
    }

    // —— 超 50KB 落盘保险丝（overflow-sink，curl 同机制）——
    // 序列化后按 UTF-8 字节计预算，超预算时全文落盘会话工作区 /tmp/
    // （子代理经装配链落父会话工作区），改回 {engine, savedPath,
    // message}；落盘失败（如 vfs 不可用）回落完整结果，不因落盘
    // 故障丢搜索所得。
    const serialized = JSON.stringify(success);
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
          engine: success.engine,
          savedPath: sink.savedPath,
          message: sink.message,
        };
      } catch (error) {
        console.debug("[search] 超预算落盘失败，回落完整输出:", error);
      }
    }
    return success;
  },
};
