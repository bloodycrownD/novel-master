import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOCHA_SEARCH_URL,
  searchWithBocha,
} from "../../src/domain/tool/builtin/search/engines/bocha.js";
import {
  TAVILY_SEARCH_URL,
  searchWithTavily,
} from "../../src/domain/tool/builtin/search/engines/tavily.js";
import {
  BRAVE_SEARCH_URL,
  searchWithBrave,
} from "../../src/domain/tool/builtin/search/engines/brave.js";
import { searchWithSearxng } from "../../src/domain/tool/builtin/search/engines/searxng.js";
import type {
  ResolvedEngineConfig,
  SearchToolOptions,
} from "../../src/domain/tool/builtin/search/types.js";

/** 构造记录调用参数的 mock fetchFn：按序回放预设 Response。 */
function makeFetch(
  responses: readonly Response[],
): typeof globalThis.fetch & {
  readonly calls: ReadonlyArray<{
    readonly url: string;
    readonly init: RequestInit;
  }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const item = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return typeof item === "function" ? item() : item;
  }) as typeof globalThis.fetch & {
    calls: ReadonlyArray<{ url: string; init: RequestInit }>;
  };
  Object.assign(fn, { calls });
  return fn;
}

/** JSON Response 快捷构造（成功路径）。 */
function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 文本错误 Response 快捷构造（HTTP 非 2xx 路径）。 */
function httpError(status: number, body: string): Response {
  return new Response(body, { status });
}

const BOCHA_KEY = "sk-bocha-plain-key";

function bochaResolved(): ResolvedEngineConfig {
  return { engine: "bocha", apiKey: BOCHA_KEY };
}

describe("search 引擎适配器：bocha（T-A1）", () => {
  it("端点 / POST / Bearer / 请求字段映射（freshness oneDay、summary:true）", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        code: 200,
        data: {
          webPages: {
            value: [
              {
                url: "https://a.example.com/1",
                title: "标题甲",
                summary: "摘要甲",
              },
            ],
          },
        },
      }),
    ]);
    const options: SearchToolOptions = {
      maxResults: 5,
      recencyFilter: "day",
    };
    const out = await searchWithBocha(
      bochaResolved(),
      "唐代科举",
      options,
      fetchFn
    );

    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0]!;
    assert.equal(call.url, BOCHA_SEARCH_URL);
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${BOCHA_KEY}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(call.init.body as string), {
      query: "唐代科举",
      count: 5,
      freshness: "oneDay",
      summary: true,
    });

    assert.equal(out.engine, "bocha");
    // answer 仅 tavily 透传，bocha 省略。
    assert.equal("answer" in out, false);
    assert.deepEqual(out.results, [
      {
        title: "标题甲",
        url: "https://a.example.com/1",
        snippet: "摘要甲",
      },
    ]);
  });

  it("无 recencyFilter 时 freshness 缺省 noLimit；url/title/snippet 字段容错（link/href/name/content）", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        data: {
          webPages: {
            value: [
              {
                link: "https://b.example.com/2",
                name: "标题乙",
                content: "摘要乙",
              },
              {
                href: "https://c.example.com/3",
                description: "摘要丙",
              },
            ],
          },
        },
      }),
    ]);
    const out = await searchWithBocha(
      bochaResolved(),
      "q",
      {},
      fetchFn
    );
    assert.equal(JSON.parse(fetchFn.calls[0]!.init.body as string).freshness, "noLimit");
    assert.deepEqual(out.results, [
      { title: "标题乙", url: "https://b.example.com/2", snippet: "摘要乙" },
      // href 容错命中、title 缺省回填 url。
      { title: "https://c.example.com/3", url: "https://c.example.com/3", snippet: "摘要丙" },
    ]);
  });

  it("业务码 code≠200 抛错且文案含业务码", async () => {
    const fetchFn = makeFetch([jsonOk({ code: 4300, msg: "quota exceeded" })]);
    await assert.rejects(
      searchWithBocha(bochaResolved(), "q", {}, fetchFn),
      /Bocha API error 4300: quota exceeded/
    );
  });

  it("domainFilter 客户端兜底过滤（include 命中 + exclude 排除）后截断", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        data: {
          webPages: {
            value: [
              { url: "https://good.example.com/1", title: "a", summary: "s" },
              { url: "https://bad.example.net/2", title: "b", summary: "s" },
              { url: "https://sub.good.example.com/3", title: "c", summary: "s" },
            ],
          },
        },
      }),
    ]);
    const out = await searchWithBocha(
      bochaResolved(),
      "q",
      { domainFilter: ["good.example.com", "-bad.example.net"] },
      fetchFn
    );
    assert.deepEqual(
      out.results.map((r) => r.url),
      ["https://good.example.com/1", "https://sub.good.example.com/3"]
    );
  });
});

describe("search 引擎适配器：tavily（T-A1）", () => {
  const TAVILY_KEY = "sk-tavily-plain-key";
  function tavilyResolved(): ResolvedEngineConfig {
    return { engine: "tavily", apiKey: TAVILY_KEY };
  }

  it("端点 / POST / Bearer / 请求字段映射（time_range、include_domains、include_answer basic）", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        answer: "是四十二章经。",
        results: [
          { title: "T", url: "https://t.example.com/1", content: "a  b\n c" },
        ],
      }),
    ]);
    const out = await searchWithTavily(
      tavilyResolved(),
      "q",
      {
        maxResults: 5,
        recencyFilter: "week",
        domainFilter: ["inc.example.com", "-exc.example.com"],
      },
      fetchFn
    );

    const call = fetchFn.calls[0]!;
    assert.equal(call.url, TAVILY_SEARCH_URL);
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${TAVILY_KEY}`);
    assert.deepEqual(JSON.parse(call.init.body as string), {
      query: "q",
      search_depth: "basic",
      max_results: 5,
      include_answer: "basic",
      include_raw_content: false,
      time_range: "week",
      include_domains: ["inc.example.com"],
      exclude_domains: ["exc.example.com"],
    });

    // tavily 是唯一透传原生 answer 的引擎；snippet 折叠空白。
    assert.equal(out.engine, "tavily");
    assert.equal(out.answer, "是四十二章经。");
    assert.deepEqual(out.results, [
      { title: "T", url: "https://t.example.com/1", snippet: "a b c" },
    ]);
  });

  it("answer 缺省时省略该字段", async () => {
    const fetchFn = makeFetch([
      jsonOk({ results: [{ url: "https://x.example.com/1", content: "c" }] }),
    ]);
    const out = await searchWithTavily(tavilyResolved(), "q", {}, fetchFn);
    assert.equal("answer" in out, false);
    // title 缺省回填 Source 序号。
    assert.equal(out.results[0]!.title, "Source 1");
  });

  it("HTTP 401 错误文案含 status（T-C2）", async () => {
    const fetchFn = makeFetch([httpError(401, "invalid api key")]);
    await assert.rejects(
      searchWithTavily(tavilyResolved(), "q", {}, fetchFn),
      /Tavily API error 401: invalid api key/
    );
  });
});

describe("search 引擎适配器：brave（T-A1 / T-A5）", () => {
  const BRAVE_KEY = "sk-brave-plain-key";
  function braveResolved(): ResolvedEngineConfig {
    return { engine: "brave", apiKey: BRAVE_KEY };
  }

  it("端点 / GET / X-Subscription-Token / 参数映射（freshness pd、count）", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        web: {
          results: [
            { title: "B1", url: "https://b1.example.com/1", description: "d1" },
            { title: "B2", url: "https://b2.example.com/2", description: "d2" },
          ],
        },
      }),
    ]);
    const out = await searchWithBrave(
      braveResolved(),
      "q",
      { maxResults: 5, recencyFilter: "day" },
      fetchFn
    );

    const call = fetchFn.calls[0]!;
    assert.ok(
      call.url.startsWith(`${BRAVE_SEARCH_URL}?`),
      `端点应落在 brave web-search：${call.url}`
    );
    assert.equal(call.init.method, "GET");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("X-Subscription-Token"), BRAVE_KEY);
    const params = new URL(call.url).searchParams;
    assert.equal(params.get("q"), "q");
    assert.equal(params.get("count"), "5");
    assert.equal(params.get("freshness"), "pd");
    // answer 省略。
    assert.equal("answer" in out, false);
    assert.deepEqual(out.results, [
      { title: "B1", url: "https://b1.example.com/1", snippet: "d1" },
      { title: "B2", url: "https://b2.example.com/2", snippet: "d2" },
    ]);
  });

  it("T-A5：有 domainFilter 时 count 强制 20 + q 拼 site:/NOT site: + 客户端过滤兜底", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        web: {
          results: [
            { title: "keep", url: "https://ok.example.com/1", description: "d" },
            { title: "drop", url: "https://other.example.net/2", description: "d" },
            { title: "sub", url: "https://sub.ok.example.com/3", description: "d" },
          ],
        },
      }),
    ]);
    const out = await searchWithBrave(
      braveResolved(),
      "q",
      { domainFilter: ["ok.example.com", "-other.example.net"] },
      fetchFn
    );

    const params = new URL(fetchFn.calls[0]!.url).searchParams;
    assert.equal(params.get("count"), "20");
    assert.equal(params.get("q"), "q site:ok.example.com NOT site:other.example.net");
    // 服务端 site: 召回不稳，客户端 matchesDomainFilters 兜底后截断到默认 5。
    assert.deepEqual(
      out.results.map((r) => r.url),
      ["https://ok.example.com/1", "https://sub.ok.example.com/3"]
    );
  });

  it("T-C2：key 无效（401）时错误信息含 status 且绝不含 key 明文（含 body 回显脱敏）", async () => {
    const fetchFn = makeFetch([
      httpError(401, `unauthorized: token ${BRAVE_KEY} rejected`),
    ]);
    await assert.rejects(
      searchWithBrave(braveResolved(), "q", {}, fetchFn),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /Brave API error 401/);
        assert.equal(message.includes(BRAVE_KEY), false);
        return true;
      }
    );
  });
});

describe("search 引擎适配器：searxng（T-A1）", () => {
  function searxngResolved(baseUrl = "http://192.168.1.5:8080"): ResolvedEngineConfig {
    return { engine: "searxng", baseUrl };
  }

  it("GET {base}/search 构造（q、format=json、time_range）且无任何鉴权头", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        results: [
          { title: "S1", url: "https://s1.example.com/1", content: "c1" },
        ],
        answers: ["实例即答区，不透传"],
      }),
    ]);
    const out = await searchWithSearxng(
      searxngResolved(),
      "q",
      { recencyFilter: "day" },
      fetchFn
    );

    const call = fetchFn.calls[0]!;
    assert.equal(call.init.method, "GET");
    const url = new URL(call.url);
    assert.equal(url.origin, "http://192.168.1.5:8080");
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("q"), "q");
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.get("time_range"), "day");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Subscription-Token"), null);

    // answers[] 即答区不透传：answer 省略（仅 tavily 有 answer 的统一口径）。
    assert.equal("answer" in out, false);
    assert.deepEqual(out.results, [
      { title: "S1", url: "https://s1.example.com/1", snippet: "c1" },
    ]);
  });

  it("exclude 域名经 q 拼 -site: 且客户端过滤兜底", async () => {
    const fetchFn = makeFetch([
      jsonOk({
        results: [
          { title: "a", url: "https://keep.example.com/1", content: "c" },
          { title: "b", url: "https://spam.example.net/2", content: "c" },
        ],
      }),
    ]);
    const out = await searchWithSearxng(
      searxngResolved(),
      "q",
      { domainFilter: ["-spam.example.net"] },
      fetchFn
    );
    const url = new URL(fetchFn.calls[0]!.url);
    assert.equal(url.searchParams.get("q"), "q -site:spam.example.net");
    assert.deepEqual(out.results.map((r) => r.url), ["https://keep.example.com/1"]);
  });

  it("非 2xx 抛错且文案含 status", async () => {
    const fetchFn = makeFetch([httpError(502, "bad gateway from instance")]);
    await assert.rejects(
      searchWithSearxng(searxngResolved(), "q", {}, fetchFn),
      /SearXNG API error 502: bad gateway from instance/
    );
  });

  it("baseUrl 缺失时抛可读错误（防御兜底）", async () => {
    const fetchFn = makeFetch([jsonOk({})]);
    await assert.rejects(
      searchWithSearxng({ engine: "searxng" }, "q", {}, fetchFn),
      /SearXNG base URL missing/
    );
  });
});

describe("search 适配器：maxResults clamp（T-A5，0→5、99→20）", () => {
  it("bocha：0 归一为默认 5、99 收敛为 20（请求体 count）", async () => {
    const fetchFn = makeFetch([
      () => jsonOk({ data: { webPages: { value: [] } } }),
    ]);
    await searchWithBocha(bochaResolved(), "q", { maxResults: 0 }, fetchFn);
    assert.equal(
      JSON.parse(fetchFn.calls[0]!.init.body as string).count,
      5
    );
    await searchWithBocha(bochaResolved(), "q", { maxResults: 99 }, fetchFn);
    assert.equal(
      JSON.parse(fetchFn.calls[1]!.init.body as string).count,
      20
    );
  });

  it("tavily：0→max_results 5、99→20（请求体）", async () => {
    const fetchFn = makeFetch([() => jsonOk({ results: [] })]);
    const resolved: ResolvedEngineConfig = { engine: "tavily", apiKey: "k" };
    await searchWithTavily(resolved, "q", { maxResults: 0 }, fetchFn);
    assert.equal(
      JSON.parse(fetchFn.calls[0]!.init.body as string).max_results,
      5
    );
    await searchWithTavily(resolved, "q", { maxResults: 99 }, fetchFn);
    assert.equal(
      JSON.parse(fetchFn.calls[1]!.init.body as string).max_results,
      20
    );
  });

  it("brave：无 domainFilter 时 count 直接归一（0→5、99→20）", async () => {
    const fetchFn = makeFetch([() => jsonOk({ web: { results: [] } })]);
    const resolved: ResolvedEngineConfig = { engine: "brave", apiKey: "k" };
    await searchWithBrave(resolved, "q", { maxResults: 0 }, fetchFn);
    assert.equal(new URL(fetchFn.calls[0]!.url).searchParams.get("count"), "5");
    await searchWithBrave(resolved, "q", { maxResults: 99 }, fetchFn);
    assert.equal(new URL(fetchFn.calls[1]!.url).searchParams.get("count"), "20");
  });

  it("searxng：无 count 参数，靠客户端截断归一（0→5）", async () => {
    const results = Array.from({ length: 9 }, (_, i) => ({
      title: `t${i}`,
      url: `https://x.example.com/${i}`,
      content: "c",
    }));
    const fetchFn = makeFetch([jsonOk({ results })]);
    const out = await searchWithSearxng(
      { engine: "searxng", baseUrl: "http://localhost:8888" },
      "q",
      { maxResults: 0 },
      fetchFn
    );
    assert.equal(out.results.length, 5);
  });
});
