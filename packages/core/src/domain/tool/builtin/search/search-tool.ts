/**
 * `search` 工具实现：经当前配置的搜索引擎（模板引擎 / DuckDuckGo 内置
 * 适配器，id 动态）检索网页，回流统一形状的结果列表（title / url /
 * snippet），让 agent 具备联网检索能力（写作考据、事实核验、资料收集）。
 *
 * 设计口径（SPEC web-search-curl §6/§7）：
 * - 引擎链经 `ctx.search` 闭包解析（engineOrderV2 顺序，只含 enabled ∩
 *   配置完整的引擎；显式 input.engine 时先钉链首、该引擎不可用则沿序
 *   顺位回落；未知 id 由链解析抛错）；链空 → 返回中性配置指引提示
 *   （成功输出、非错误）。
 * - 串行执行：从链首起依次请求，单引擎失败（任何错误类型）→ 尝试链中
 *   下一个；显式 input.engine 时钉死链首、失败不降级直接报错。链总预算
 *   120s（每引擎尝试前检查剩余额度，耗尽带已收集错误返回）；全链失败
 *   抛聚合错误（每引擎一行摘要，不泄漏 key）。
 * - `params` 是自由 JSON 对象，原样透传给模板执行器（引擎方言参数，
 *   未知字段由引擎忽略）；DuckDuckGo 忽略 params。
 * - 成功输出携带 `attempts` 尝试轨迹（首发成功省略该字段）。
 * - 网络入口经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch，照 curl）。
 * - 输出预算保险丝：结果序列化超过 `TOOL_OUTPUT_MAX_BYTES`（50KB）时
 *   全文落盘会话工作区 `/tmp/` 并返回 `{savedPath, message}`
 *   （overflow-sink 公共机制，curl 同机制）；落盘失败回落完整结果。
 * - description 由装配期快照（`ctx.search.engineSnapshot`，口径与串行链
 *   同款）拼装：引擎无关通用段 + 逐引擎参数说明段；回合内改配置下回合
 *   生效（照 skills 快照语义）。
 * - 不在任何 registry 摘除分支内，主/子/孙 agent 全深度可用（照 curl）。
 *
 * @module domain/tool/builtin/search/search-tool
 */

import { utf8ByteLength } from "@/common/encoding.js";
import { z } from "zod";

import { toolFailed } from "@/errors/tool-errors.js";
import { TOOL_OUTPUT_MAX_BYTES } from "@/domain/tool/logic/tool-output-limits.js";
import type { Tool } from "../../model/tool.js";
import type { BuiltinToolContext } from "../builtin-tool-context.js";
import { sinkOversizedOutput } from "../overflow-sink.js";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT, normalizeMaxResults, redactSecret, type ResolvedEngineConfig, type SearchChainOutput, type SearchOversizeOutput } from "./types.js";
import { dispatchSearch, SEARCH_NOT_CONFIGURED_MESSAGE } from "./engines/dispatch.js";
import { createLogger } from "@/infra/log/logger.js";

const log = createLogger("tool.search");

/** 工具名（注册表 / catalog / policy 共用）。 */
export const SEARCH_TOOL_NAME = "search";

/** 串行链总预算（毫秒）：多引擎依次降级的全链时间上限（引擎自身超时另算）。 */
export const SEARCH_CHAIN_BUDGET_MS = 120_000;

/** 聚合错误 / attempts 轨迹里单引擎错误摘要的截断长度。 */
const ENGINE_ERROR_SUMMARY_LIMIT = 300;

/** `search` 工具输入（schema 开放 query / maxResults / engine / params）。 */
export interface SearchToolInput {
  /** 搜索关键词。 */
  readonly query: string;
  /** 结果条数：缺省 5；小于 1 回落 5、超过 20 收敛到 20（不报错）。 */
  readonly maxResults?: number;
  /**
   * 可选：指定引擎 id（动态全集，见描述里的可用引擎清单）；缺省按
   * engineOrderV2 优先级串行尝试，前一个失败自动降级到下一个；显式指定
   * 时钉死该引擎（不可用则沿序顺位回落），失败不降级直接报错。
   */
  readonly engine?: string;
  /** 可选：自由 JSON，原样透传引擎方言参数（模板引擎忽略未知字段；DDG 忽略）。 */
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * `search` 工具输出三形态：
 * - `SearchChainOutput`：正常结果（engine + 可选 answer + results +
 *   可选 attempts 轨迹）；
 * - `SearchOversizeOutput`：超 50KB 落盘形态；
 * - `string`：链空（无可用已启用引擎）时的配置指引提示。
 */
export type SearchToolOutput = SearchChainOutput | SearchOversizeOutput | string;

/**
 * 聚合链错误消息：每引擎一行摘要 + 预算耗尽说明（如有）。
 * `untried` 为因预算耗尽未尝试的引擎数（自然链尽时为 0）。
 */
function buildChainErrorMessage(failureLines: readonly string[], untried: number): string {
  const parts = ["串行搜索链全部尝试失败：", ...failureLines];
  if (untried > 0) {
    parts.push(`链总预算 ${SEARCH_CHAIN_BUDGET_MS / 1000}s 已耗尽，剩余 ${untried} 个引擎未尝试。`);
  }
  return parts.join("\n");
}

/**
 * 静态 `search` 工具实例。
 *
 * description 是静态 lambda：通用段就地拼装，逐引擎段消费装配期
 * `engineSnapshot`（`ctx.search` 注入，回合内改配置下回合生效）；
 * 链解析与凭证明文读取仍在 run 内进行。是否对 LLM 可见由
 * `resolveAgentToolRegistry` 的 tools.allow/deny 控制。
 */
export const searchTool: Tool<SearchToolInput, SearchToolOutput, BuiltinToolContext> = {
  name: SEARCH_TOOL_NAME,
  description: (ctx) => {
    // 空快照三路径语义：未注入闭包（CLI/旧 mock）→ 中性「未装配」文案
    //（run 必抛，不承诺任何 run 行为）；已注入但快照为空 → 保留配置指引
    //（软化为不承诺 run 返回——实际行为以 run 内链解析为准）。逐引擎段
    // 来自装配期快照（口径同串行链：enabled ∩ 配置完整，按 engineOrderV2 序）。
    const engineList = ctx.search?.engineSnapshot;
    const engineSection = engineList == null ? "当前运行时未装配搜索能力，调用将不可用。" : engineList.length === 0 ? "当前没有可用的已启用引擎；如需联网检索，请到 设置 → 搜索配置 开启或配置引擎。" : engineList.map((engine) => `- ${engine.id}（${engine.name}）：${engine.paramHint}`).join("\n");
    return `联网搜索：按当前配置的搜索引擎串行检索网页，返回结果列表（标题 / 链接 / 摘要），适用于写作资料查找、事实核验与背景考据。

入参：
- query：搜索关键词（必填）
- engine：可选，指定搜索引擎 id（见下方可用引擎清单）；缺省按配置顺序串行尝试，前一个失败自动降级到下一个；显式指定时钉死该引擎，失败不降级直接报错
- maxResults：结果条数，默认 ${DEFAULT_MAX_RESULTS}，范围 1..${MAX_RESULTS_LIMIT}（超出范围自动收敛，不报错）
- params：可选，自由 JSON 对象，原样透传给引擎方言参数（如时间范围、结果深度、域名过滤等）；同名参数覆盖模板默认值，引擎忽略未知字段

可用引擎（按串行链顺序）：
${engineSection}

结果格式：可读文本，非 JSON——首行为「search 引擎 · N 条结果」，发生过降级时下一行展示尝试轨迹（「引擎 失败(原因) → 引擎 成功」），引擎返回的原生回答（如有）紧随其后，其后为「- 标题 — 链接 — 摘要」紧凑列表；结果超过 50KB 时全文自动保存到会话工作区 /tmp/（可用 read 读取）并显示落盘路径。

串行链总预算 ${SEARCH_CHAIN_BUDGET_MS / 1000}s；全链失败返回逐引擎聚合错误。引擎配置在 设置 → 搜索配置 中管理，当回合内改配置下回合生效。`;
  },
  inputSchema: z.object({
    query: z.string().min(1).describe("搜索关键词"),
    maxResults: z.number().int().min(0).optional().describe(`结果条数，默认 ${DEFAULT_MAX_RESULTS}，范围 1..${MAX_RESULTS_LIMIT}（超出范围自动收敛，不报错）`),
    engine: z.string().min(1).optional().describe("可选：指定搜索引擎 id（当前启用且配置完整的引擎，见描述「可用引擎」）；缺省按配置顺序串行尝试（失败自动降级），显式指定时钉死该引擎、失败不降级"),
    params: z.record(z.string(), z.unknown()).optional().describe("可选：自由 JSON 对象，原样透传引擎方言参数（时间范围 / 结果深度 / 域名过滤等）；同名参数覆盖模板默认值，引擎忽略未知字段"),
  }),
  outputSchema: z.union([
    z.string(),
    z.object({
      engine: z.string(),
      answer: z.string().optional(),
      attempts: z.string().optional(),
      results: z.array(z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        })),
    }),
    z.object({
      engine: z.string(),
      savedPath: z.string(),
      message: z.string(),
    }),
  ]),
  async run(input, ctx) {
    const search = ctx.search;
    if (search == null) {
      // 未装配闭包（CLI 无 kkv / 旧测试 mock）：可读错误而非崩溃。
      throw toolFailed(SEARCH_TOOL_NAME, new Error("search 工具未装配搜索上下文（当前运行时未注入搜索配置）"));
    }

    // 引擎链解析：engineOrderV2 优先级序（显式 input.engine 时先钉该引擎，
    // 不可用则沿序顺位回落）；链空是合法常态（全关）→ 中性配置指引提示
    //（成功输出、非错误）。
    const chain = await search.resolveEngineChain(input.engine);
    if (chain.length === 0) {
      return SEARCH_NOT_CONFIGURED_MESSAGE;
    }

    // 显式 engine 钉死：只尝试链首（含顺位回落后的链首），失败不降级
    // 直接报错；缺省调用才沿链降级。
    const candidates: readonly ResolvedEngineConfig[] = input.engine != null ? chain.slice(0, 1) : chain;
    const fetchFn = ctx.fetchFn ?? globalThis.fetch;
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
        throw toolFailed(SEARCH_TOOL_NAME, new Error(buildChainErrorMessage(failureLines, candidates.length - i)));
      }
      try {
        const response = await dispatchSearch(entry, input.query, { maxResults: normalizeMaxResults(input.maxResults) }, input.params ?? {}, fetchFn);
        // 降级后成功：输出携带 attempts 轨迹；链首首发成功省略该字段。
        const attempts = attemptParts.length === 0 ? undefined : `${attemptParts.join(" → ")} → ${response.engine} 成功`;
        success = attempts == null ? response : { ...response, attempts };
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const safe = redactSecret(msg, entry.apiKey).slice(0, ENGINE_ERROR_SUMMARY_LIMIT);
        const code = msg.match(/error (\d{3})/i)?.[1];
        const timeout = msg.match(/timed out after (\d+)ms/);
        const brief = code ?? (timeout?.[1] ? `超时 ${timeout[1]}ms` : msg.slice(0, 40) || "未知错误");
        failureLines.push(`${entry.engine}: ${safe}`);
        attemptParts.push(`${entry.engine} 失败(${brief})`);
        // 循环继续：尝试链中下一个引擎（钉死时仅一员，自然止）。
      }
    }

    if (success == null) {
      // 全链失败：聚合错误（每引擎一行摘要，不泄漏 key）。
      throw toolFailed(SEARCH_TOOL_NAME, new Error(buildChainErrorMessage(failureLines, 0)));
    }

    // —— 超 50KB 落盘保险丝（overflow-sink，curl 同机制）——
    // 序列化后按 UTF-8 字节计预算，超预算时全文落盘会话工作区 /tmp/
    // （子代理经装配链落父会话工作区），改回 {engine, savedPath,
    // message}；落盘失败（如 vfs 不可用）回落完整结果，不因落盘
    // 故障丢搜索所得。
    const serialized = JSON.stringify(success);
    if (utf8ByteLength(serialized) > TOOL_OUTPUT_MAX_BYTES) {
      try {
        const sinkOptions = { tool: SEARCH_TOOL_NAME, content: serialized, contentType: "application/json" };
        const sink = await sinkOversizedOutput(ctx, sinkOptions);
        return {
          engine: success.engine,
          savedPath: sink.savedPath,
          message: sink.message,
        };
      } catch (error) {
        log.debug("超预算落盘失败，回落完整输出", { error });
      }
    }
    return success;
  },
};
