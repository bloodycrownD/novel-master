/**
 * DuckDuckGo 适配器（内置免费兜底引擎，参考 `.reference/pi-web-access/
 * duckduckgo.ts` 请求/解析/过滤逻辑；环境偏离同其它引擎：AbortController
 * + setTimeout 超时、无 SSRF、无 activityMonitor；DOM 解析（参考用
 * linkedom）换正则——RN/Hermes 无 DOM 实现，正则是唯一可移植解）。
 *
 * 请求：GET `https://html.duckduckgo.com/html/?q=...`、无 key 无 baseUrl
 * （内置兜底，解析链恒可用）；headers 只有 `Accept: text/html` 与自报
 * 轻客户端 UA（不伪装浏览器）。HTML 端点无条数/时间范围参数：maxResults
 * 客户端截断（照 searxng 模式）、recencyFilter 忽略（PRD R1.2 口径）。
 *
 * 解析（正则模拟 DOM 查询，class 一律 token 精确匹配——`result__url`
 * 等近形类名不得误伤）：按 `.result` 块分块（`result--ad` 广告块跳过）
 * → 块内 `result__a` 锚（标题 + href）与 `result__snippet` 锚（摘要，
 * 去内嵌标签 + 实体解码 + 折叠空白）→ href 为 `//duckduckgo.com/l/
 * ?uddg=<encoded>` 重定向时解码 uddg 取真实 URL（仅接受 http/https）。
 * 解析 0 个可解析结果（有块但全无有效 title/url，或无块——页面改版 /
 * 反爬拦截页）抛 invalid response 错误，供串行链感知降级。
 * answer 省略（仅 tavily 透传原生 answer 的统一口径）。
 *
 * @module domain/tool/builtin/search/engines/duckduckgo
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

/** DuckDuckGo HTML 端点（硬编码，内置引擎无自定义 baseUrl）。 */
export const DUCKDUCKGO_SEARCH_URL = "https://html.duckduckgo.com/html/";

/** 超时（毫秒）：30s（轻量 HTML 端点，照参考实现）。 */
export const DUCKDUCKGO_TIMEOUT_MS = 30_000;

/** 自报轻客户端 UA（照参考实现格式，novel-master 风格；不伪装浏览器）。 */
export const DUCKDUCKGO_USER_AGENT =
  "Mozilla/5.0 (compatible; novel-master/1.0; +https://github.com/bloodycrownD/novel-master)";

/**
 * HTML 实体解码：只处理标题/摘要/href 中常见的五个命名实体
 * （`&amp;` 必须最后替换，避免 `&amp;lt;` 被二次解成 `<`）；
 * `&#NN;` 一般数字实体不做（真实页面罕用，简化口径）。
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * 锚文本清洗：去内嵌标签（snippet 内的 `<b>` 高亮等）→ 实体解码 →
 * 折叠空白（HTML 折行缩进折成单空格）→ trim。对应 DOM 的
 * `textContent.trim()` 加浏览器渲染的空白折叠语义。
 */
function cleanAnchorText(innerHtml: string): string {
  return decodeHtmlEntities(innerHtml.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 锚 href 解码（对应 DOM `getAttribute("href")` 的实体解码语义）：
 * 原始属性值里的 `&amp;` 先解码成 `&`，再进重定向解析。
 */
function decodeResultUrl(href: string): string | null {
  try {
    const link = new URL(decodeHtmlEntities(href), DUCKDUCKGO_SEARCH_URL);
    const destination = link.searchParams.get("uddg") ?? link.href;
    const url = new URL(destination);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** 锚标签解析结果：属性串 + innerHTML。 */
interface AnchorMatch {
  readonly attrs: string;
  readonly innerHtml: string;
}

/** 块内取第一个 class token 精确等于 `className` 的锚（querySelector 语义）。 */
function findAnchorByClass(
  blockHtml: string,
  className: string
): AnchorMatch | null {
  for (const match of blockHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = match[1] ?? "";
    const classAttr = attrs.match(/\bclass\s*=\s*"([^"]*)"/);
    const tokens = (classAttr?.[1] ?? "").split(/\s+/);
    if (tokens.includes(className)) {
      return { attrs, innerHtml: match[2] ?? "" };
    }
  }
  return null;
}

/** 从锚属性串提取 href 原始值（无 href 返回空串）。 */
function anchorHref(anchor: AnchorMatch): string {
  return anchor.attrs.match(/\bhref\s*=\s*"([^"]*)"/)?.[1] ?? "";
}

/** 分块结果：块内 HTML + 是否广告块。 */
interface ResultBlock {
  readonly html: string;
  readonly isAd: boolean;
}

/**
 * 按 `.result` 块分块（DOM `querySelectorAll(".result")` 的正则等价）：
 * class token 列表含裸 `result` 的 `<div>` 开标签为块界，块内容延伸到
 * 下一块起点；class token 含 `result--ad` 标记广告块（调用方跳过）。
 */
function splitResultBlocks(html: string): ResultBlock[] {
  const blockStarts: Array<{ index: number; end: number; tokens: string[] }> =
    [];
  for (const match of html.matchAll(/<div\b[^>]*>/g)) {
    const tag = match[0];
    const classAttr = tag.match(/\bclass\s*=\s*"([^"]*)"/);
    const tokens = (classAttr?.[1] ?? "").split(/\s+/);
    if (tokens.includes("result")) {
      blockStarts.push({
        index: match.index ?? 0,
        end: (match.index ?? 0) + tag.length,
        tokens,
      });
    }
  }
  const blocks: ResultBlock[] = [];
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i]!.end;
    const end =
      i + 1 < blockStarts.length ? blockStarts[i + 1]!.index : html.length;
    blocks.push({
      html: html.slice(start, end),
      isAd: blockStarts[i]!.tokens.includes("result--ad"),
    });
  }
  return blocks;
}

/**
 * DuckDuckGo 搜索适配器：无任何凭据依赖（`_resolved` 仅保持与其它适配器
 * 统一的签名，dispatch 统一路由）；超时 30s；域名过滤纯客户端
 * （HTML 端点无 `site:` 服务端过滤能力，不拼查询词——与 brave/searxng
 * 的双保险模式不同，参考实现同口径）。
 */
export async function searchWithDuckduckgo(
  _resolved: ResolvedEngineConfig,
  query: string,
  options: SearchToolOptions,
  fetchFn: typeof globalThis.fetch
): Promise<SearchResponse> {
  const numResults = normalizeMaxResults(options.maxResults);
  const filters: DomainFilters = parseDomainFilters(options.domainFilter);

  const url = new URL(DUCKDUCKGO_SEARCH_URL);
  url.searchParams.set("q", query);
  // recencyFilter 忽略：HTML 端点无时间范围参数（PRD R1.2 拍板口径）。

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DUCKDUCKGO_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchFn(url.toString(), {
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": DUCKDUCKGO_USER_AGENT,
        },
        signal: controller.signal,
      });
    } catch (e) {
      throw engineTimeoutError(
        e,
        controller.signal.aborted,
        "DuckDuckGo",
        DUCKDUCKGO_TIMEOUT_MS
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        engineApiErrorMessage("DuckDuckGo", response.status, body)
      );
    }

    const html = await response.text();
    const results: SearchResult[] = [];
    let parseableResults = 0;
    for (const block of splitResultBlocks(html)) {
      if (block.isAd) continue;
      const anchor = findAnchorByClass(block.html, "result__a");
      const title = anchor != null ? cleanAnchorText(anchor.innerHtml) : "";
      const href = anchor != null ? anchorHref(anchor) : "";
      const resultUrl = href.length > 0 ? decodeResultUrl(href) : null;
      if (!title || resultUrl == null) continue;
      // parseable 计数在域名过滤之前：改版/反爬页判 invalid，
      // 「有结果但全被 domainFilter 滤掉」是正常空结果（参考实现同口径）。
      parseableResults++;
      if (!matchesDomainFilters(resultUrl, filters)) continue;
      const snippetAnchor = findAnchorByClass(block.html, "result__snippet");
      results.push({
        title,
        url: resultUrl,
        snippet:
          snippetAnchor != null ? cleanAnchorText(snippetAnchor.innerHtml) : "",
      });
      if (results.length >= numResults) break;
    }
    if (parseableResults === 0) {
      throw new Error(
        "DuckDuckGo returned no parseable results (invalid response)"
      );
    }
    return { engine: "duckduckgo", results };
  } finally {
    clearTimeout(timer);
  }
}
