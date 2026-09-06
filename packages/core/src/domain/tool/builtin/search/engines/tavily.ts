/**
 * Tavily 搜索适配器（参考 `.reference/pi-web-access/tavily.ts` 字段映射，
 * 三处偏离：AbortController+setTimeout 超时、无 SSRF、凭据经参数注入）。
 *
 * 请求：POST `https://api.tavily.com/search`、Bearer 鉴权、
 * `{query, search_depth:"basic", max_results, include_answer:"basic",
 * include_raw_content:false, time_range?, include_domains?, exclude_domains?}`；
 * 域名过滤走服务端参数（include_domains/exclude_domains），不做客户端兜底。
 * 响应：`results[]{title,url,content}`（content 折叠空白为 snippet）、
 * 原生 `answer` 透传（非字符串或缺省时省略）——四引擎中仅 tavily 有 answer。
 *
 * @module domain/tool/builtin/search/engines/tavily
 */

import {
  engineApiErrorMessage,
  engineTimeoutError,
  normalizeMaxResults,
  parseDomainFilters,
  type ResolvedEngineConfig,
  type SearchResponse,
  type SearchResult,
  type SearchToolOptions,
} from "../types.js";

/** Tavily 端点（硬编码，无自定义 baseUrl 口径）。 */
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** 超时（毫秒）：60s（同 bocha）。 */
export const TAVILY_TIMEOUT_MS = 60_000;

/** 域名过滤条目 → tavily include_domains / exclude_domains 参数。 */
function mapDomainFilter(
  domainFilter: readonly string[] | undefined
): {
  readonly include_domains?: readonly string[];
  readonly exclude_domains?: readonly string[];
} {
  const filters = parseDomainFilters(domainFilter);
  return {
    ...(filters.include.length > 0
      ? { include_domains: filters.include }
      : {}),
    ...(filters.exclude.length > 0
      ? { exclude_domains: filters.exclude }
      : {}),
  };
}

/** tavily 响应条目形状。 */
interface TavilyResult {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
}

/** tavily 响应形状。 */
interface TavilyResponse {
  readonly answer?: string;
  readonly results?: readonly TavilyResult[];
}

/** results 字段抽取：缺 url 跳过、content 折叠空白、截断到条数上限。 */
function mapResults(
  results: readonly TavilyResult[] | undefined,
  numResults: number
): readonly SearchResult[] {
  if (!Array.isArray(results)) return [];
  const mapped: SearchResult[] = [];
  for (const item of results) {
    if (item?.url == null || item.url.length === 0) continue;
    mapped.push({
      title:
        item.title && item.title.length > 0
          ? item.title
          : `Source ${mapped.length + 1}`,
      url: item.url,
      snippet:
        typeof item.content === "string"
          ? item.content.replace(/\s+/g, " ").trim()
          : "",
    });
    if (mapped.length >= numResults) break;
  }
  return mapped;
}

/**
 * Tavily 搜索适配器：`resolved.apiKey` 缺失时抛可读错误；超时 60s；
 * 唯一透传原生 answer 的引擎。
 */
export async function searchWithTavily(
  resolved: ResolvedEngineConfig,
  query: string,
  options: SearchToolOptions,
  fetchFn: typeof globalThis.fetch
): Promise<SearchResponse> {
  const apiKey = resolved.apiKey;
  if (apiKey == null || apiKey.length === 0) {
    throw new Error("Tavily API key missing: engine not configured");
  }
  const numResults = normalizeMaxResults(options.maxResults);

  const body: Record<string, unknown> = {
    query,
    search_depth: "basic",
    max_results: numResults,
    include_answer: "basic",
    include_raw_content: false,
    ...(options.recencyFilter != null
      ? { time_range: options.recencyFilter }
      : {}),
    ...mapDomainFilter(options.domainFilter),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchFn(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw engineTimeoutError(
        e,
        controller.signal.aborted,
        "Tavily",
        TAVILY_TIMEOUT_MS
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        engineApiErrorMessage("Tavily", response.status, errorBody, apiKey)
      );
    }

    let data: TavilyResponse;
    try {
      data = (await response.json()) as TavilyResponse;
    } catch (e) {
      throw new Error(
        `Tavily API returned invalid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    const answer =
      typeof data.answer === "string" && data.answer.trim().length > 0
        ? data.answer
        : undefined;
    return {
      engine: "tavily",
      ...(answer != null ? { answer } : {}),
      results: mapResults(data.results, numResults),
    };
  } finally {
    clearTimeout(timer);
  }
}
