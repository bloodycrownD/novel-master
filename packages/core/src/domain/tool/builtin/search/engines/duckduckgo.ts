/**
 * DuckDuckGo 适配器（内置免费引擎，唯一保留的代码适配器；bocha / tavily /
 * brave / searxng / deepseek / zhipu 与自定义实例均走模板执行器。参考
 * `.reference/pi-web-access/duckduckgo.ts` 请求/解析逻辑；环境偏离同其它
 * 引擎：AbortController + setTimeout 超时、无 SSRF、无 activityMonitor；
 * DOM 解析（参考用 linkedom）换正则——RN/Hermes 无 DOM 实现，正则是唯一
 * 可移植解）。
 *
 * 请求：GET `https://html.duckduckgo.com/html/?q=...`、无 key 无 baseUrl
 * （DDG 无模板，凭据面为空）；headers 只有 `Accept: text/html` 与自报
 * 轻客户端 UA（不伪装浏览器）。HTML 端点无条数参数：maxResults 由适配器
 * 客户端截断（模板执行器 v2 透传改造后已不客户端截断，口径不再相同）。
 *
 * 解析（正则模拟 DOM 查询，class 一律 token 精确匹配——`result__url`
 * 等近形类名不得误伤）：按 `.result` 块分块（`result--ad` 广告块跳过）
 * → 块内 `result__a` 锚（标题 + href）与 `result__snippet` 锚（摘要，
 * 去内嵌标签 + 实体解码 + 折叠空白）→ href 为 `//duckduckgo.com/l/
 * ?uddg=<encoded>` 重定向时解码 uddg 取真实 URL（仅接受 http/https）。
 * 解析 0 个可解析结果（有块但全无有效 title/url，或无块——页面改版 /
 * 反爬拦截页）抛 invalid response 错误，供串行链感知降级。
 * 不产生 answer 字段（v2 已废除 answerPath 机制，SearchResponse 无该字段；
 * DDG 保留解析数组的结构化回流，是 HTML 解析的本仓唯一消费者）。
 *
 * @module domain/tool/builtin/search/engines/duckduckgo
 */

import {
  engineApiErrorMessage,
  engineFailed,
  engineTimeoutError,
  normalizeMaxResults,
  type FetchFn,
  type ResolvedEngineConfig,
  type SearchResponse,
  type SearchResult,
  type SearchToolOptions,
} from "../types.js";

/** DuckDuckGo HTML 端点（硬编码，内置引擎无自定义 baseUrl）。 */
const DUCKDUCKGO_SEARCH_URL = "https://html.duckduckgo.com/html/";

/** 超时（毫秒）：30s（轻量 HTML 端点，照参考实现）。 */
const DUCKDUCKGO_TIMEOUT_MS = 30_000;

/** 自报轻客户端 UA（照参考实现格式，novel-master 风格；不伪装浏览器）。 */
const DUCKDUCKGO_USER_AGENT = "Mozilla/5.0 (compatible; novel-master/1.0; +https://github.com/bloodycrownD/novel-master)";

/**
 * HTML 实体解码：只处理标题/摘要/href 中常见的五个命名实体
 * （`&amp;` 必须最后替换，避免 `&amp;lt;` 被二次解成 `<`）；
 * `&#NN;` 一般数字实体不做（真实页面罕用，简化口径）。
 */
const HTML_ENTITY_DECODES: readonly (readonly [RegExp, string])[] = [
  [/&quot;/g, '"'],
  [/&#x27;/g, "'"],
  [/&#39;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&amp;/g, "&"],
];

function decodeHtmlEntities(text: string): string {
  let decoded = text;
  for (const [pattern, replacement] of HTML_ENTITY_DECODES) decoded = decoded.replace(pattern, replacement);
  return decoded;
}

/**
 * 锚文本清洗：去内嵌标签（snippet 内的 `<b>` 高亮等）→ 实体解码 →
 * 折叠空白（HTML 折行缩进折成单空格）→ trim。对应 DOM 的
 * `textContent.trim()` 加浏览器渲染的空白折叠语义。
 */
function cleanAnchorText(innerHtml: string): string {
  const stripped = decodeHtmlEntities(innerHtml.replace(/<[^>]*>/g, ""));
  return stripped.replace(/\s+/g, " ").trim();
}

/** 锚标签解析结果：属性串 + innerHTML。 */
interface AnchorMatch {
  readonly attrs: string;
  readonly innerHtml: string;
}

/** 块内取第一个 class token 精确等于 `className` 的锚（querySelector 语义）。 */
function findAnchorByClass(blockHtml: string, className: string): AnchorMatch | null {
  for (const match of blockHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = match[1] ?? "";
    const classAttr = attrs.match(/\bclass\s*=\s*"([^"]*)"/);
    const tokens = (classAttr?.[1] ?? "").split(/\s+/);
    if (tokens.includes(className)) return { attrs, innerHtml: match[2] ?? "" };
  }
  return null;
}

/**
 * DuckDuckGo 搜索适配器：无任何凭据依赖（`_resolved` 仅保持与模板执行器
 * 统一的签名，dispatch 统一按 id 路由）；超时 30s；maxResults 客户端截断。
 */
export async function searchWithDuckduckgo(_resolved: ResolvedEngineConfig, query: string, options: SearchToolOptions, fetch: FetchFn, signal?: AbortSignal): Promise<SearchResponse> {
  const numResults = normalizeMaxResults(options.maxResults);

  const url = new URL(DUCKDUCKGO_SEARCH_URL);
  url.searchParams.set("q", query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DUCKDUCKGO_TIMEOUT_MS);
  // nm-style: keep-local — add/removeEventListener 必须同一 listener 引用（生命周期不变量），内联会丢移除句柄。
  const onParentAbort = () => controller.abort();
  // 父级取消（用户点停止 / 回合中断）立即 aborts 在途请求，别让 fetch 挂满超时。
  signal?.addEventListener("abort", onParentAbort, { once: true });
  try {
    let response: Response;
    try {
      const requestInit = {
        method: "GET",
        headers: { Accept: "text/html", "User-Agent": DUCKDUCKGO_USER_AGENT },
        signal: controller.signal,
      };
      response = await fetch(url.toString(), requestInit);
    } catch (e) {
      throw engineTimeoutError(e, controller.signal.aborted, "DuckDuckGo", DUCKDUCKGO_TIMEOUT_MS);
    }

    if (!response.ok) throw engineFailed(engineApiErrorMessage("DuckDuckGo", response.status, await response.text()));

    const html = await response.text();
    // 按 `.result` 块分块（DOM `querySelectorAll(".result")` 的正则等价）：class token 含裸
    // `result` 的 <div> 开标签为块界，块内容延伸到下一块起点；`result--ad` 标记广告块（下方跳过）。
    const blocks: Array<{
      readonly contentStart: number;
      readonly tagStart: number;
      readonly isAd: boolean;
    }> = [];
    for (const match of html.matchAll(/<div\b[^>]*>/g)) {
      const classAttr = match[0].match(/\bclass\s*=\s*"([^"]*)"/);
      const tokens = (classAttr?.[1] ?? "").split(/\s+/);
      const tagStart = match.index ?? 0;
      if (tokens.includes("result"))
        blocks.push({
          contentStart: tagStart + match[0].length,
          tagStart,
          isAd: tokens.includes("result--ad"),
        });
    }

    const results: SearchResult[] = [];
    let parseableResults = 0;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex]!;
      if (block.isAd) continue;
      const blockHtml = html.slice(block.contentStart, blockIndex + 1 < blocks.length ? blocks[blockIndex + 1]!.tagStart : html.length);
      const anchor = findAnchorByClass(blockHtml, "result__a");
      const title = anchor == null ? "" : cleanAnchorText(anchor.innerHtml);
      const href = anchor?.attrs.match(/\bhref\s*=\s*"([^"]*)"/)?.[1] ?? "";
      // href 解码（对应 DOM `getAttribute("href")` 的实体解码语义）：`&amp;` 先解成 `&`，
      // 再按 uddg 重定向参数取真实 URL（仅接受 http/https；非法值按不可解析跳过该块）。
      let resultUrl: string | null = null;
      if (href.length > 0) {
        try {
          const link = new URL(decodeHtmlEntities(href), DUCKDUCKGO_SEARCH_URL);
          const target = new URL(link.searchParams.get("uddg") ?? link.href);
          if (target.protocol === "http:" || target.protocol === "https:") resultUrl = target.href;
        } catch {
          resultUrl = null;
        }
      }
      if (title.length === 0 || resultUrl == null) continue;
      // parseable 计数不受 maxResults 截断影响：改版 / 反爬拦截页（零可解析结果）判 invalid。
      parseableResults++;
      const snippetAnchor = findAnchorByClass(blockHtml, "result__snippet");
      results.push({
        title,
        url: resultUrl,
        snippet: snippetAnchor == null ? "" : cleanAnchorText(snippetAnchor.innerHtml),
      });
      if (results.length >= numResults) break;
    }
    if (parseableResults === 0) throw engineFailed("DuckDuckGo returned no parseable results (invalid response)");
    return { engine: "duckduckgo", results };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}
