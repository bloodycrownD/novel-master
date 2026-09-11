import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DUCKDUCKGO_SEARCH_URL,
  DUCKDUCKGO_USER_AGENT,
  searchWithDuckduckgo,
} from "../../src/domain/tool/builtin/search/engines/duckduckgo.js";
import type {
  ResolvedEngineConfig,
  SearchToolOptions,
} from "../../src/domain/tool/builtin/search/types.js";

/** 构造记录调用参数的 mock fetchFn：回放单个 Response。 */
function makeFetch(
  respond: (url: string) => Response,
): typeof globalThis.fetch & {
  readonly calls: ReadonlyArray<{
    readonly url: string;
    readonly init: RequestInit;
  }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url));
  }) as typeof globalThis.fetch & {
    calls: ReadonlyArray<{ url: string; init: RequestInit }>;
  };
  Object.assign(fn, { calls });
  return fn;
}

/** HTML Response 快捷构造。 */
function htmlOk(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

/**
 * 构造 DDG HTML 结果页 fixture：2 个正常块 + 1 个 result--ad 广告块 +
 * 1 个 uddg 重定向链接（含嵌套 %26 查询参数）+ snippet 实体 +
 * result__url 近形类名干扰项。
 */
function ddgResultsHtml(): string {
  return `
<html><body>
<div class="links_wrapper">
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://direct.example.com/guide?a=1&amp;b=2">直链标题甲</a>
  </h2>
  <a class="result__url" href="https://direct.example.com/guide">direct.example.com</a>
  <a class="result__snippet" href="https://direct.example.com/guide">摘要甲含 &amp; 符号与 &quot;引号&quot;</a>
</div>
<div class="result result--ad result--ad--small">
  <a class="result__a" href="https://ads.example.net/buy">广告标题应被跳过</a>
  <a class="result__snippet" href="https://ads.example.net/buy">广告摘要</a>
</div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftarget.example.org%2Fdocs%3Fq%3D1%26lang%3Dzh&amp;rut=hs123">重定向&lt;标题&gt;乙</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftarget.example.org%2Fdocs">重定向摘要 &#x27;乙&#x27; 与 &amp;</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://blocked.example.net/spam">应被域名过滤排除</a>
  <a class="result__snippet">垃圾摘要</a>
</div>
</div>
</body></html>`;
}

function ddgResolved(): ResolvedEngineConfig {
  return { engine: "duckduckgo" };
}

describe("search 引擎适配器：duckduckgo（T-A6，内置免费兜底）", () => {
  it("请求形状：GET html 端点 + q 参数 + Accept: text/html + 自报轻客户端 UA，无任何鉴权头", async () => {
    const fetchFn = makeFetch(() => htmlOk(ddgResultsHtml()));
    await searchWithDuckduckgo(ddgResolved(), "唐代科举", {}, fetchFn);

    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0]!;
    const url = new URL(call.url);
    assert.equal(url.origin + url.pathname, DUCKDUCKGO_SEARCH_URL);
    assert.equal(url.searchParams.get("q"), "唐代科举");
    assert.equal(call.init.method, "GET");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Accept"), "text/html");
    assert.equal(headers.get("User-Agent"), DUCKDUCKGO_USER_AGENT);
    assert.match(DUCKDUCKGO_USER_AGENT, /^Mozilla\/5\.0 \(compatible; novel-master\//);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Subscription-Token"), null);
  });

  it("解析：标题/直链 href 实体解码/uddg 重定向解码（嵌套 %26）/snippet 实体解码/广告块跳过/近形类名不误伤", async () => {
    const fetchFn = makeFetch(() => htmlOk(ddgResultsHtml()));
    const out = await searchWithDuckduckgo(
      ddgResolved(),
      "q",
      { domainFilter: ["-blocked.example.net"] },
      fetchFn
    );

    assert.equal(out.engine, "duckduckgo");
    // answer 省略（仅 tavily 透传原生 answer 的统一口径）。
    assert.equal("answer" in out, false);
    assert.deepEqual(out.results, [
      {
        // 直链 href 的 &amp; 实体解码后为 &；snippet 实体解码。
        title: "直链标题甲",
        url: "https://direct.example.com/guide?a=1&b=2",
        snippet: '摘要甲含 & 符号与 "引号"',
      },
      {
        // uddg 解码：嵌套 %26 解回 &（lang 参数归属真实 URL，rut 是重定向外层参数）；
        // 标题 &lt;/&gt;、snippet &#x27;/&amp; 实体解码。
        title: "重定向<标题>乙",
        url: "https://target.example.org/docs?q=1&lang=zh",
        snippet: "重定向摘要 '乙' 与 &",
      },
    ]);
  });

  it("maxResults 客户端截断（HTML 端点无条数参数，照 searxng 模式）：0→默认 5、99→20、2→截 2", async () => {
    const blocks = Array.from(
      { length: 6 },
      (_, i) => `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://x${i}.example.com/p${i}">标题${i}</a>
  <a class="result__snippet">摘要${i}</a>
</div>`
    ).join("");
    const fetchFn = makeFetch(() => htmlOk(`<body>${blocks}</body>`));

    const out2 = await searchWithDuckduckgo(
      ddgResolved(),
      "q",
      { maxResults: 2 },
      fetchFn
    );
    assert.equal(out2.results.length, 2);
    assert.deepEqual(
      out2.results.map((r) => r.url),
      ["https://x0.example.com/p0", "https://x1.example.com/p1"]
    );

    // 0 → 默认 5（normalizeMaxResults 共用 clamp）；6 块全量可解析。
    const out5 = await searchWithDuckduckgo(
      ddgResolved(),
      "q",
      { maxResults: 0 },
      fetchFn
    );
    assert.equal(out5.results.length, 5);
  });

  it("domainFilter include 白名单：非白名单域全滤后为正常空结果（非 invalid）", async () => {
    const fetchFn = makeFetch(() => htmlOk(ddgResultsHtml()));
    const out = await searchWithDuckduckgo(
      ddgResolved(),
      "q",
      { domainFilter: ["target.example.org"] },
      fetchFn
    );
    assert.deepEqual(
      out.results.map((r) => r.url),
      ["https://target.example.org/docs?q=1&lang=zh"]
    );
  });

  it("解析 0 个可解析结果抛 invalid（无块——反爬/改版页，供串行链感知降级）", async () => {
    const fetchFn = makeFetch(
      () => htmlOk("<html><body>no results here</body></html>")
    );
    await assert.rejects(
      searchWithDuckduckgo(ddgResolved(), "q", {}, fetchFn),
      /DuckDuckGo returned no parseable results \(invalid response\)/
    );
  });

  it("有块但全无有效 title/url（如 uddg 指向非 http 协议）同样抛 invalid", async () => {
    const html = `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=javascript%3Aalert%3A1">无效协议标题</a>
  <a class="result__snippet">摘要</a>
</div>`;
    const fetchFn = makeFetch(() => htmlOk(html));
    await assert.rejects(
      searchWithDuckduckgo(ddgResolved(), "q", {}, fetchFn),
      /no parseable results/
    );
  });

  it("非 2xx 抛错且文案含 status（统一 engineApiErrorMessage 范式）", async () => {
    const fetchFn = makeFetch(
      () => new Response("anomaly detected", { status: 403 })
    );
    await assert.rejects(
      searchWithDuckduckgo(ddgResolved(), "q", {}, fetchFn),
      /DuckDuckGo API error 403: anomaly detected/
    );
  });

  it("recencyFilter 忽略：请求不携带任何时间范围参数", async () => {
    const fetchFn = makeFetch(() => htmlOk(ddgResultsHtml()));
    const options: SearchToolOptions = { recencyFilter: "day" };
    await searchWithDuckduckgo(ddgResolved(), "q", options, fetchFn);
    const url = new URL(fetchFn.calls[0]!.url);
    assert.equal(
      [...url.searchParams.keys()].sort().toString(),
      "q",
      "HTML 端点只应有 q 参数"
    );
  });
});
