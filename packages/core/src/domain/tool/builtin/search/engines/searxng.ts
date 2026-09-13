/**
 * SearXNG 适配器（参考 `.reference/pi-web-access/searxng.ts` 字段映射，
 * 三处偏离：AbortController+setTimeout 超时、无 SSRF、baseUrl 经参数注入
 * ——规范化在 search-config 侧完成，适配器只消费 ResolvedEngineConfig）。
 *
 * 请求：GET `{baseUrl}/search?q=...&format=json[&time_range=...]`、无鉴权
 * （自托管实例）；域名过滤经 `q` 拼 `site:` / `-site:` 查询词 + 客户端
 * `matchesDomainFilters` 兜底；不传 language（由实例配置决定，避免覆写
 * 自托管者的中文聚合偏好）。响应：`results[]{title,url,content}`。
 * answer 省略（实例的 `answers[]` 即答区不透传，保持「仅 tavily 有
 * answer」的统一口径）。
 *
 * @module domain/tool/builtin/search/engines/searxng
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

/** 超时（毫秒）：30s（自托管聚合通常快于付费 API）。 */
export const SEARXNG_TIMEOUT_MS = 30_000;

/** 域名过滤 → `q` 附加的 site: / -site: 查询词（searxng 语法）。 */
function buildSearxngQuery(query: string, filters: DomainFilters): string {
  const parts: string[] = [query];
  if (filters.include.length === 1) {
    parts.push(`site:${filters.include[0]}`);
  } else if (filters.include.length > 1) {
    parts.push(
      filters.include.map((domain) => `site:${domain}`).join(" OR ")
    );
  }
  for (const domain of filters.exclude) {
    parts.push(`-site:${domain}`);
  }
  return parts.join(" ");
}

/** searxng 响应形状（json format）。 */
interface SearxngResponse {
  readonly results?: readonly {
    readonly title?: string;
    readonly url?: string;
    readonly content?: string;
  }[];
  readonly answers?: readonly unknown[];
}

/**
 * SearXNG 搜索适配器：`resolved.baseUrl` 缺失时抛可读错误（解析链只
 * 路由到已配置实例，此为防御兜底）；超时 30s；无任何鉴权头。
 */
export async function searchWithSearxng(
  resolved: ResolvedEngineConfig,
  query: string,
  options: SearchToolOptions,
  fetchFn: typeof globalThis.fetch
): Promise<SearchResponse> {
  const baseUrl = resolved.baseUrl;
  if (baseUrl == null || baseUrl.length === 0) {
    throw new Error("SearXNG base URL missing: engine not configured");
  }
  const numResults = normalizeMaxResults(options.maxResults);
  const filters = parseDomainFilters(options.domainFilter);

  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", buildSearxngQuery(query, filters));
  url.searchParams.set("format", "json");
  if (options.recencyFilter != null) {
    url.searchParams.set("time_range", options.recencyFilter);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARXNG_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (e) {
      throw engineTimeoutError(
        e,
        controller.signal.aborted,
        "SearXNG",
        SEARXNG_TIMEOUT_MS
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        engineApiErrorMessage("SearXNG", response.status, body)
      );
    }

    let data: SearxngResponse;
    try {
      data = (await response.json()) as SearxngResponse;
    } catch (e) {
      throw new Error(
        `SearXNG returned invalid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    const results: SearchResult[] = [];
    for (const item of data.results ?? []) {
      if (item?.url == null || item.url.length === 0) continue;
      if (!matchesDomainFilters(item.url, filters)) continue;
      results.push({
        title: item.title && item.title.length > 0 ? item.title : item.url,
        url: item.url,
        snippet: item.content ?? "",
      });
      if (results.length >= numResults) break;
    }
    return { engine: "searxng", results };
  } finally {
    clearTimeout(timer);
  }
}
