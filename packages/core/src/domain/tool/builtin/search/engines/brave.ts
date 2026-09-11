/**
 * Brave Search 适配器（参考 `.reference/pi-web-access/brave.ts` 字段映射，
 * 三处偏离：AbortController+setTimeout 超时、无 SSRF、凭据经参数注入；
 * 参考实现的 Accept-Encoding 头亦省去——undici/RN 自动处理压缩）。
 *
 * 请求：GET `https://api.search.brave.com/res/v1/web/search`、
 * `X-Subscription-Token` 鉴权、`q` / `count` / `freshness` 查询参数；
 * 有域名过滤时 count 强制 20（服务端 `site:` 查询词召回不稳，拉宽后由
 * 客户端 `matchesDomainFilters` 兜底过滤再截断），freshness 映射
 * pd/pw/pm/py；域名过滤经 `q` 拼 `site:` / `NOT site:` 查询词。
 * 响应：`web.results[]{title,url,description}`。answer 省略。
 *
 * @module domain/tool/builtin/search/engines/brave
 */

import {
  engineApiErrorMessage,
  engineTimeoutError,
  matchesDomainFilters,
  normalizeMaxResults,
  parseDomainFilters,
  type DomainFilters,
  type ResolvedEngineConfig,
  type SearchResponse,
  type SearchResult,
  type SearchToolOptions,
} from "../types.js";

/** Brave 端点（硬编码，无自定义 baseUrl 口径）。 */
export const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

/** 超时（毫秒）：30s（REST 轻查询，快于 bocha/tavily）。 */
export const BRAVE_TIMEOUT_MS = 30_000;

/** 有域名过滤时强制拉宽的 count（客户端过滤会丢弃部分召回，需冗余）。 */
export const BRAVE_DOMAIN_FILTER_COUNT = 20;

/** 域名过滤 → `q` 附加的 site: / NOT site: 查询词。 */
function buildBraveQuery(query: string, filters: DomainFilters): string {
  const parts: string[] = [query];
  if (filters.include.length === 1) {
    parts.push(`site:${filters.include[0]}`);
  } else if (filters.include.length > 1) {
    parts.push(
      filters.include.map((domain) => `site:${domain}`).join(" OR ")
    );
  }
  for (const domain of filters.exclude) {
    parts.push(`NOT site:${domain}`);
  }
  return parts.join(" ");
}

/** 时间范围 → brave freshness 参数映射（无过滤时不携带该参数）。 */
function mapFreshness(recency: SearchToolOptions["recencyFilter"]): string | null {
  switch (recency) {
    case "day":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
    case "year":
      return "py";
    default:
      return null;
  }
}

/** brave 响应形状（只取 web.results）。 */
interface BraveResponse {
  readonly web?: {
    readonly results?: readonly {
      readonly title?: string;
      readonly url?: string;
      readonly description?: string;
    }[];
  };
}

/**
 * Brave 搜索适配器：`resolved.apiKey` 缺失时抛可读错误；超时 30s；
 * 域名过滤 = 服务端 `site:` 查询词 + 客户端兜底过滤双保险。
 */
export async function searchWithBrave(
  resolved: ResolvedEngineConfig,
  query: string,
  options: SearchToolOptions,
  fetchFn: typeof globalThis.fetch
): Promise<SearchResponse> {
  const apiKey = resolved.apiKey;
  if (apiKey == null || apiKey.length === 0) {
    throw new Error("Brave Search API key missing: engine not configured");
  }
  const numResults = normalizeMaxResults(options.maxResults);
  const hasDomainFilter = (options.domainFilter ?? []).length > 0;
  const filters = parseDomainFilters(options.domainFilter);

  const params = new URLSearchParams({
    q: buildBraveQuery(query, filters),
    count: String(hasDomainFilter ? BRAVE_DOMAIN_FILTER_COUNT : numResults),
  });
  const freshness = mapFreshness(options.recencyFilter);
  if (freshness != null) {
    params.set("freshness", freshness);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchFn(`${BRAVE_SEARCH_URL}?${params.toString()}`, {
        method: "GET",
        headers: {
          "X-Subscription-Token": apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (e) {
      throw engineTimeoutError(
        e,
        controller.signal.aborted,
        "Brave",
        BRAVE_TIMEOUT_MS
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        engineApiErrorMessage("Brave", response.status, body, apiKey)
      );
    }

    let data: BraveResponse;
    try {
      data = (await response.json()) as BraveResponse;
    } catch (e) {
      throw new Error(
        `Brave Search API returned invalid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    const results: SearchResult[] = [];
    for (const item of data.web?.results ?? []) {
      if (item?.url == null || item.url.length === 0) continue;
      if (!matchesDomainFilters(item.url, filters)) continue;
      results.push({
        title: item.title && item.title.length > 0 ? item.title : item.url,
        url: item.url,
        snippet: item.description ?? "",
      });
      if (results.length >= numResults) break;
    }
    return { engine: "brave", results };
  } finally {
    clearTimeout(timer);
  }
}
