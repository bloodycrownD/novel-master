/**
 * `search` 工具实现：经当前配置的搜索引擎（模板引擎 / DuckDuckGo 内置
 * 适配器，id 动态）检索网页，结果以 JSON 文本回流（模板引擎提取引擎响应
 * 中最长的对象数组，字段原样保留；DDG 仍为结构化列表），让 agent 具备
 * 联网检索能力（写作考据、事实核验、资料收集）。
 *
 * 设计口径（SPEC web-search-curl §6/§7）：
 * - v3 口径（CR 拍板追认 params-only）：工具入参为 `search(engine?, params)`
 *   两参（T-S1 锁定）——query / maxResults 不再是 schema 顶层参数，由 params
 *   承载：搜索词按 q / query / search_query 顺序取第一个非空 string，条数按
 *   count / max_results / maxResults 三键归一（clamp 1..20）。
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
import { normalizeMaxResults, redactSecret, type ResolvedEngineConfig, type SearchChainOutput, type SearchOversizeOutput } from "./types.js";
import { dispatchSearch, SEARCH_NOT_CONFIGURED_MESSAGE } from "./engines/dispatch.js";
import { createLogger } from "@/infra/log/logger.js";

const log = createLogger("tool.search");

/** 工具名（注册表 / catalog / policy 共用；测试直引）。 */
export const SEARCH_TOOL_NAME = "search";

/** 串行链总预算（毫秒）：多引擎依次降级的全链时间上限（引擎自身超时另算）。 */
const SEARCH_CHAIN_BUDGET_MS = 120_000;

/** 聚合错误 / attempts 轨迹里单引擎错误摘要的截断长度。 */
const ENGINE_ERROR_SUMMARY_LIMIT = 300;

/** 入参 params 字段描述·用法半句（整句宽度超打印宽，拆两段常量拼接）。 */
const SEARCH_PARAMS_HINT_USAGE = "引擎参数对象（自由 JSON）：搜索词 + 引擎方言参数（时间范围 / 结果深度 / 域名过滤 / count 等）都放这里；";
/** 入参 params 字段描述·字段约定半句。 */
const SEARCH_PARAMS_HINT_FIELDS = "搜索词字段名随引擎（q / query / search_query），见描述里的逐引擎参数说明；同名参数覆盖模板默认值，引擎忽略未知字段";
/** 入参 params 字段描述（schema describe 用单标识符，保链单行）。 */
const SEARCH_PARAMS_HINT = SEARCH_PARAMS_HINT_USAGE + SEARCH_PARAMS_HINT_FIELDS;

/** `search` 工具输入（schema 只有 engine / params：搜索词与引擎方言参数全在 params）。 */
interface SearchToolInput {
  /**
   * 可选：指定引擎 id（动态全集，见描述里的可用引擎清单）；缺省按
   * engineOrderV2 优先级串行尝试，前一个失败自动降级到下一个；显式指定
   * 时钉死该引擎（不可用则沿序顺位回落），失败不降级直接报错。
   */
  readonly engine?: string;
  /**
   * 可选：自由 JSON，原样透传引擎方言参数；搜索词也在这里（字段名随引擎，
   * 如 Brave 用 q、博查用 query、智谱用 search_query），见描述里的逐引擎说明。
   */
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * `search` 工具输出三形态：
 * - `SearchChainOutput`：正常结果（engine + results + 可选 attempts 轨迹；
 *   results 为模板引擎的 JSON 文本或 DDG 的结构化列表）；
 * - `SearchOversizeOutput`：超 50KB 落盘形态；
 * - `string`：链空（无可用已启用引擎）时的配置指引提示。
 */
type SearchToolOutput = SearchChainOutput | SearchOversizeOutput | string;

/**
 * 聚合链错误消息：每引擎一行摘要 + 预算耗尽说明（如有）。
 * `untried` 为因预算耗尽未尝试的引擎数（自然链尽时为 0）。
 */
function buildChainErrorMessage(failureLines: readonly string[], untried: number): string {
  const parts = ["串行搜索链全部尝试失败：", ...failureLines];
  if (untried > 0) parts.push(`链总预算 ${SEARCH_CHAIN_BUDGET_MS / 1000}s 已耗尽，剩余 ${untried} 个引擎未尝试。`);
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
    let engineSection: string;
    if (engineList == null) engineSection = "当前运行时未装配搜索能力，调用将不可用。";
    else if (engineList.length === 0) engineSection = "当前没有可用的已启用引擎；如需联网检索，请到 设置 → 搜索配置 开启或配置引擎。";
    else engineSection = engineList.map((engine) => `- ${engine.id}（${engine.name}）：${engine.paramHint}`).join("\n");
    return `联网搜索：按当前配置的搜索引擎串行检索网页，结果以 JSON 文本返回（提取引擎响应中的结果数组，字段原样保留），适用于写作资料查找、事实核验与背景考据。

入参：
- engine：可选，指定搜索引擎 id（见下方可用引擎清单）；缺省按配置顺序串行尝试，前一个失败自动降级到下一个；显式指定时钉死该引擎，失败不降级直接报错
- params：引擎参数对象（自由 JSON）。搜索词也放在这里，字段名随引擎不同（如 Brave 用 q、博查用 query、智谱用 search_query），具体见下方逐引擎说明；同名参数覆盖模板默认值，引擎忽略未知字段

可用引擎（按串行链顺序）：
${engineSection}

结果格式：结果以 JSON 文本返回——模板引擎提取引擎响应中最长的对象数组（引擎原始字段原样保留，自行读取所需字段；超 50KB 预算截断并标注），DuckDuckGo 为「标题 — 链接 — 摘要」紧凑列表；发生过降级时附尝试轨迹；全文序列化超 50KB 时自动保存到会话工作区 /tmp/（可用 read 读取）并返回落盘路径。

串行链总预算 ${SEARCH_CHAIN_BUDGET_MS / 1000}s；全链失败返回逐引擎聚合错误。引擎配置在 设置 → 搜索配置 中管理，当回合内改配置下回合生效。`;
  },
  inputSchema: z.object({
    engine: z.string().min(1).optional().describe("可选：指定搜索引擎 id（当前启用且配置完整的引擎，见描述「可用引擎」）；缺省按配置顺序串行尝试（失败自动降级），显式指定时钉死该引擎、失败不降级"),
    params: z.record(z.string(), z.unknown()).optional().describe(SEARCH_PARAMS_HINT),
  }),
  outputSchema: z.union([
    z.string(),
    z.object({
      engine: z.string(),
      attempts: z.string().optional(),
      results: z.union([z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })), z.string()]),
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
    if (chain.length === 0) return SEARCH_NOT_CONFIGURED_MESSAGE;

    // 搜索词在 params 里（各家字段名不同：q / query / search_query）；模板占位符
    // 替换与 DuckDuckGo 兜底共用该值。条数同理：count / max_results 归一后只喂
    // DuckDuckGo（模板引擎的条数随 params 原样透传，不再收敛）。
    const params = input.params ?? {};
    let query = "";
    for (const termKey of ["q", "query", "search_query"]) {
      const termValue = params[termKey];
      if (typeof termValue === "string" && termValue.trim().length > 0) {
        query = termValue;
        break;
      }
    }
    if (query.length === 0) throw toolFailed(SEARCH_TOOL_NAME, new Error("params 缺少搜索词：请传 q / query / search_query 之一（字段名随引擎，见描述里的逐引擎参数说明）"));
    const rawCount = params.count ?? params.max_results ?? params.maxResults;
    const maxResults = normalizeMaxResults(typeof rawCount === "number" ? rawCount : undefined);

    // 显式 engine 钉死：只尝试链首（含顺位回落后的链首），失败不降级
    // 直接报错；缺省调用才沿链降级。
    const candidates: readonly ResolvedEngineConfig[] = input.engine != null ? chain.slice(0, 1) : chain;
    const fetchFn = ctx.fetchFn ?? globalThis.fetch;
    // 回合取消信号：传给模板执行器 / DDG 适配器，让在途 fetch 同步 abort。
    const signal = ctx.signal;
    const startedAt = Date.now();
    // 每引擎一行聚合摘要（全链失败 / 预算耗尽时随错误返回）。
    const failureLines: string[] = [];
    // attempts 轨迹分段（「bocha 失败(401)」…，成功引擎由返回处拼接）。
    const attemptParts: string[] = [];
    let success: SearchChainOutput | null = null;

    for (const [i, entry] of candidates.entries()) {
      // 用户取消（点停止 / 回合中断）：在途 fetch 已被 signal abort，这里再兜底
      // 拦一道，避免取消后仍去尝试链上剩余引擎。
      if (signal?.aborted === true) throw toolFailed(SEARCH_TOOL_NAME, new Error("搜索已取消"));
      // 链总预算：每引擎尝试前检查剩余额度，耗尽即带已收集错误返回
      //（首引擎前 elapsed 为 0，不会误拦）。
      if (Date.now() - startedAt >= SEARCH_CHAIN_BUDGET_MS) throw toolFailed(SEARCH_TOOL_NAME, new Error(buildChainErrorMessage(failureLines, candidates.length - i)));
      try {
        const response = await dispatchSearch(entry, query, { maxResults }, params, fetchFn, signal);
        // 降级后成功：输出携带 attempts 轨迹；链首首发成功省略该字段。
        const attempts = attemptParts.length === 0 ? undefined : `${attemptParts.join(" → ")} → ${response.engine} 成功`;
        success = attempts == null ? response : { ...response, attempts };
        break;
      } catch (e) {
        // 用户取消：不是引擎失败，立即终止、不走降级链（重读 ctx.signal：局部 signal 已被上面的检查收窄）。
        if (ctx.signal?.aborted === true) throw toolFailed(SEARCH_TOOL_NAME, new Error("搜索已取消"));
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
        const sink = await sinkOversizedOutput(ctx, { tool: SEARCH_TOOL_NAME, content: serialized, contentType: "application/json" });
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
