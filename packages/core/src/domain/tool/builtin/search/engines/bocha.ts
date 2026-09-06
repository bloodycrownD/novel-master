/**
 * Bocha 搜索适配器（参考 `.reference/pi-web-access/bocha.ts` 字段映射，
 * 三处偏离：AbortController+setTimeout 超时、无 SSRF、凭据经参数注入）。
 *
 * 请求：POST `https://api.bochaai.com/v1/web-search`、Bearer 鉴权、
 * `{query, count, freshness, summary:true}`；freshness 按时间范围映射
 * oneDay/oneWeek/oneMonth/oneYear/noLimit。
 * 响应：`data.webPages.value[]`，url 字段容错 url/link/href，title 容错
 * title/name（缺省回填 url），snippet 容错 summary/snippet/description/
 * content；业务码 `code !== 200` 抛错（HTTP 层非 2xx 同样抛错）。
 * 域名过滤不支持服务端参数：客户端 `matchesDomainFilters` 兜底后再截断。
 * answer 省略（仅 tavily 透传原生 answer）。
 *
 * @module domain/tool/builtin/search/engines/bocha
 */

import {
  engineApiErrorMessage,
  engineTimeoutError,
  matchesDomainFilters,
  normalizeMaxResults,
  parseDomainFilters,
  type ResolvedEngineConfig,
  type SearchResponse,
  type SearchToolOptions,
} from "../types.js";

/** Bocha 端点（硬编码，无自定义 baseUrl 口径）。 */
export const BOCHA_SEARCH_URL = "https://api.bochaai.com/v1/web-search";

/** 超时（毫秒）：bocha 聚合检索较慢，60s（brave/searxng 为 30s）。 */
export const BOCHA_TIMEOUT_MS = 60_000;

/** 时间范围 → bocha freshness 参数映射。 */
function mapFreshness(
  recency: SearchToolOptions["recencyFilter"]
): string {
  switch (recency) {
    case "day":
      return "oneDay";
    case "week":
      return "oneWeek";
    case "month":
      return "oneMonth";
    case "year":
      return "oneYear";
    default:
      return "noLimit";
  }
}

/** 依次取第一个非空字符串（bocha 响应字段容错抽取用）。 */
function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/** 解析 bocha 响应信封：业务码校验 + webPages.value 抽取与字段容错。 */
function parseBochaResults(raw: unknown): {
  readonly results: { readonly title: string; readonly url: string; readonly snippet: string }[];
} {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Bocha API returned invalid response: expected an object envelope");
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.code !== undefined && Number(envelope.code) !== 200) {
    throw new Error(
      `Bocha API error ${String(envelope.code)}: ${
        firstString(envelope.msg, envelope.message) ?? "unknown error"
      }`
    );
  }
  const data = envelope.data;
  const pages =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>).webPages
      : undefined;
  const items =
    typeof pages === "object" && pages !== null && !Array.isArray(pages)
      ? (pages as Record<string, unknown>).value
      : undefined;
  if (!Array.isArray(items)) {
    throw new Error(
      "Bocha API returned invalid response: missing data.webPages.value array"
    );
  }
  const results: {
    title: string;
    url: string;
    snippet: string;
  }[] = [];
  for (const item of items) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const url = firstString(entry.url, entry.link, entry.href);
    if (url == null) continue;
    const title = firstString(entry.title, entry.name) ?? url;
    const snippet =
      firstString(entry.summary, entry.snippet, entry.description, entry.content) ?? "";
    results.push({ title, url, snippet });
  }
  return { results };
}

/**
 * Bocha 搜索适配器：`resolved.apiKey` 缺失时抛可读错误（解析链只路由到
 * 已配置引擎，此为防御兜底）；超时 60s，错误消息绝不携带 key 明文。
 */
export async function searchWithBocha(
  resolved: ResolvedEngineConfig,
  query: string,
  options: SearchToolOptions,
  fetchFn: typeof globalThis.fetch
): Promise<SearchResponse> {
  const apiKey = resolved.apiKey;
  if (apiKey == null || apiKey.length === 0) {
    throw new Error("Bocha API key missing: engine not configured");
  }
  const numResults = normalizeMaxResults(options.maxResults);
  const filters = parseDomainFilters(options.domainFilter);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOCHA_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchFn(BOCHA_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query,
          count: numResults,
          freshness: mapFreshness(options.recencyFilter),
          summary: true,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      throw engineTimeoutError(
        e,
        controller.signal.aborted,
        "Bocha",
        BOCHA_TIMEOUT_MS
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        engineApiErrorMessage("Bocha", response.status, body, apiKey)
      );
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (e) {
      throw new Error(
        `Bocha API returned invalid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    const { results } = parseBochaResults(raw);
    return {
      engine: "bocha",
      results: results
        .filter((result) => matchesDomainFilters(result.url, filters))
        .slice(0, numResults),
    };
  } finally {
    clearTimeout(timer);
  }
}
