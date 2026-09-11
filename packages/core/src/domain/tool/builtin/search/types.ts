/**
 * `search` 工具统一内部接口：五引擎适配器（bocha / tavily / brave /
 * searxng / duckduckgo）与工具本体共用的类型和小型纯函数。
 *
 * 设计口径（SPEC web-search-tool Step 1）：
 * - 搜索引擎 API 无通用协议，各引擎适配器把请求/响应映射到本模块的
 *   `SearchResponse` 统一形状；answer 仅 tavily 原生透传，其余引擎省略。
 * - 默认条数 5、clamp 1..20（0 或非法值回落 5——「未给有效值」与「缺省」同义，
 *   大于 20 收敛到 20）。
 * - 域名过滤条目以 `-` 前缀表示排除（如 `["example.com", "-ads.com"]`）；
 *   引擎侧按各自能力选择服务端过滤（tavily 参数 / brave 与 searxng 的
 *   `site:` 查询词）或客户端兜底过滤（`matchesDomainFilters`）。
 * - 适配器不持有任何配置读取逻辑：凭据经 `ResolvedEngineConfig` 参数注入
 *   （明文 key 只在 resolveEngineChain 内现读、不驻留），HTTP 超时统一
 *   `AbortController + setTimeout`（RN/Hermes 兼容，不用 AbortSignal.timeout/any），
 *   无 SSRF 拦截层（照 curl 工具拍板：简单搞）。
 *
 * @module domain/tool/builtin/search/types
 */

/** 支持的搜索引擎标识（注册顺序即「第一个已配置引擎」回落的优先顺序；duckduckgo 内置免费兜底固定队尾）。 */
export const ENGINE_IDS = [
  "bocha",
  "tavily",
  "brave",
  "searxng",
  "duckduckgo",
] as const;

/** 搜索引擎标识。 */
export type EngineId = (typeof ENGINE_IDS)[number];

/** 需要填 API key 的引擎（searxng 走自托管 baseUrl、duckduckgo 内置免费，均无 key）。 */
export const KEY_ENGINE_IDS = ["bocha", "tavily", "brave"] as const;

/** 需要 API key 的引擎标识。 */
export type KeyEngineId = (typeof KEY_ENGINE_IDS)[number];

/** 单条搜索结果（五引擎统一形状）。 */
export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/**
 * 搜索响应：`engine` 回填实际使用的引擎（模型可见），`answer` 仅 tavily
 * 原生透传（其余引擎省略该字段，不从 results 拼装）。
 */
export interface SearchResponse {
  readonly engine: EngineId;
  readonly answer?: string;
  readonly results: readonly SearchResult[];
}

/**
 * 落盘形态输出（超 50KB 保险丝触发后）：正文已写入会话工作区 `/tmp/`，
 * 工具结果只回路径与说明（overflow-sink Step 5/6 接线后出现）。
 */
export interface SearchOversizeOutput {
  readonly engine: EngineId;
  readonly savedPath: string;
  readonly message: string;
}

/**
 * 工具层串行链成功输出：`SearchResponse` 叠加尝试轨迹 `attempts`
 * （如「bocha 失败(401) → tavily 成功」；链首首发成功时省略该字段，
 * 零降级无轨迹可记）。适配器层不感知该字段。
 */
export type SearchChainOutput = SearchResponse & {
  readonly attempts?: string;
};

/** 时间范围过滤（各引擎映射为自家 freshness/time_range 参数）。 */
export type SearchRecency = "day" | "week" | "month" | "year";

/** 单引擎配置状态（对外展示面，不含 key 明文；定义于 types 供闭包/配置两侧共用）。 */
export interface SearchEngineStatus {
  readonly configured: boolean;
}

/** 引擎适配器入参选项（工具 schema 本期只开放 query/maxResults/engine）。 */
export interface SearchToolOptions {
  readonly maxResults?: number;
  readonly recencyFilter?: SearchRecency;
  readonly domainFilter?: readonly string[];
}

/**
 * 引擎解析结果：凭据随参数注入适配器（明文 key 只在 resolveEngineChain 内
 * 经 secretStore 现读，不落在任何缓存 / 日志 / KKV）。
 */
export interface ResolvedEngineConfig {
  readonly engine: EngineId;
  /** bocha/tavily/brave 的明文 API key；searxng 恒缺省。 */
  readonly apiKey?: string;
  /** searxng 规范化后的 baseUrl（http/https、无 userinfo、无尾斜杠）。 */
  readonly baseUrl?: string;
}

/** 默认结果条数（maxResults 缺省 / 非法 / 小于 1 时回落此值）。 */
export const DEFAULT_MAX_RESULTS = 5;

/** 结果条数上限（超过时收敛到该值，不报错）。 */
export const MAX_RESULTS_LIMIT = 20;

/**
 * 归一化结果条数：缺省 / 非有限数 / 小于 1 → 5；其余向下取整并 clamp 到
 * 1..20（0→5、99→20，T-A5 锁定该口径）。五引擎适配器共用。
 */
export function normalizeMaxResults(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
}

/** 域名过滤解析结果：include 白名单 / exclude 黑名单（均为主机名小写）。 */
export interface DomainFilters {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

/**
 * 单条域名过滤条目归一化为主机名：支持裸域名 / 带协议 URL 两种写法；
 * `-` 前缀已由 parseDomainFilters 剥离；非法（非域名形状）返回 null。
 */
function normalizeDomain(raw: string): string | null {
  let input = raw.trim().toLowerCase();
  if (input.length === 0) return null;
  if (input.startsWith("-")) input = input.slice(1).trim();
  if (input.length === 0) return null;
  try {
    const parsed = input.includes("://")
      ? new URL(input)
      : new URL(`https://${input}`);
    input = parsed.hostname;
  } catch {
    input = input.split("/")[0]?.split(":")[0] ?? "";
  }
  input = input.replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

/**
 * 解析域名过滤条目列表：`-` 前缀进 exclude，其余进 include；
 * 非法条目跳过、重复条目去重。
 */
export function parseDomainFilters(
  domainFilter?: readonly string[]
): DomainFilters {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of domainFilter ?? []) {
    const domain = normalizeDomain(raw);
    if (domain == null) continue;
    const target = raw.trim().startsWith("-") ? exclude : include;
    if (!target.includes(domain)) target.push(domain);
  }
  return { include, exclude };
}

/** 主机名是否命中单个域（精确相等或为其子域）。 */
function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * 客户端域名过滤兜底：include 非空时要求命中其一，exclude 命中即排除；
 * URL 解析失败按不命中处理。brave / searxng / bocha / duckduckgo 共用。
 */
export function matchesDomainFilters(
  url: string,
  filters: DomainFilters
): boolean {
  if (filters.include.length === 0 && filters.exclude.length === 0) {
    return true;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (
    filters.include.length > 0 &&
    !filters.include.some((domain) => hostMatchesDomain(hostname, domain))
  ) {
    return false;
  }
  return !filters.exclude.some((domain) =>
    hostMatchesDomain(hostname, domain)
  );
}

/**
 * 引擎错误消息脱敏：把明文 key 从文本中替换为 `***`——个别引擎 401 响应体
 * 会回显鉴权头，脱敏保证 key 明文绝不进错误信息 / 日志 / 工具输出。
 */
export function redactSecret(text: string, secret?: string): string {
  if (secret == null || secret.length === 0) return text;
  return text.split(secret).join("***");
}

/**
 * 统一引擎 HTTP 错误范式：`` `${Engine} API error ${status}: ${body.slice(0,300)}` ``。
 * body 先经 redactSecret 脱敏再截断。
 */
export function engineApiErrorMessage(
  engine: string,
  status: number,
  body: string,
  apiKey?: string
): string {
  return `${engine} API error ${status}: ${redactSecret(body, apiKey).slice(
    0,
    300
  )}`;
}

/**
 * 引擎适配器超时错误的统一映射：signal 已 abort（计时器触发）给可读超时
 * 文案，其余错误原样透传（照 curl-tool 的 curlPhaseError 模式）。
 */
export function engineTimeoutError(
  e: unknown,
  aborted: boolean,
  engine: string,
  timeoutMs: number
): unknown {
  if (aborted) {
    return new Error(`${engine} search timed out after ${timeoutMs}ms`);
  }
  return e;
}
