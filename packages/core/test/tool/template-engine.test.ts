import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { runTemplateEngine } from "../../src/domain/tool/builtin/search/engines/template-engine.js";
import { TOOL_OUTPUT_MAX_BYTES } from "../../src/domain/tool/logic/tool-output-limits.js";
import { utf8ByteLength } from "../../src/common/encoding.js";
import type { ResolvedEngineConfig, SearchEngineTemplate } from "../../src/domain/tool/builtin/search/types.js";

/** 构造记录调用参数的 mock fetchFn：按序回放预设 Response（照 search-engines 旧测试先例）。 */
function makeFetch(responses: readonly Response[]): typeof globalThis.fetch & {
  readonly calls: ReadonlyArray<{ readonly url: string; readonly init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const item = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return item;
  }) as typeof globalThis.fetch & {
    calls: ReadonlyArray<{ url: string; init: RequestInit }>;
  };
  Object.assign(fn, { calls });
  return fn;
}

/** JSON Response 快捷构造（成功路径）。 */
function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

/** 模板工厂：只写与用例相关的字段，其余取最小合法值（name 缺省「测试引擎」= 错误文案断言用的显示名）。 */
function template(patch: Partial<SearchEngineTemplate> & { readonly url: string }): SearchEngineTemplate {
  return { name: "测试引擎", method: "GET", headers: {}, paramHint: "", ...patch };
}

/** 引擎解析结果工厂（凭据按用例注入）。 */
function resolved(engine: string, extra: Partial<ResolvedEngineConfig> = {}): ResolvedEngineConfig {
  return { engine, ...extra };
}

/** 断言引擎回流的 results 为 JSON 文本并解析出来（成功路径恒为数组文本）。 */
function parseResults(out: { readonly results: readonly unknown[] | string }): unknown[] {
  assert.equal(typeof out.results, "string", "模板引擎成功结果应为 JSON 文本");
  const parsed: unknown = JSON.parse(out.results as string);
  assert.ok(Array.isArray(parsed), "提取结果应为数组");
  return parsed;
}

// 超时用例启用了 mock.timers，这里统一重置，避免计时器状态泄漏到后续用例。
afterEach(() => {
  mock.timers.reset();
});

describe("模板执行器：占位符替换与 params 合并（T-E1）", () => {
  it("URL 占位符：仅 query 百分号编码，count 数字串，apiKey/baseUrl 原样；headers 原样内插", async () => {
    const fetchFn = makeFetch([jsonOk([])]);
    const tpl = template({ url: "https://api.example.com/search?q={{query}}&count={{count}}&key={{apiKey}}&base={{baseUrl}}", headers: { Authorization: "Bearer {{apiKey}}" } });
    const query = '唐 诗&x="1"';
    await runTemplateEngine(tpl, resolved("test", { apiKey: "secret-key", baseUrl: "https://base.example.com" }), query, { maxResults: 3 }, {}, fetchFn);

    const call = fetchFn.calls[0]!;
    const url = new URL(call.url);
    assert.equal(url.searchParams.get("q"), query);
    assert.ok(call.url.includes(`q=${encodeURIComponent(query)}`), "只有 query 做百分号编码");
    assert.equal(url.searchParams.get("count"), "3");
    assert.equal(url.searchParams.get("key"), "secret-key");
    assert.equal(url.searchParams.get("base"), "https://base.example.com");
    assert.equal(new Headers(call.init.headers).get("Authorization"), "Bearer secret-key");
  });

  it("占位符缺值（baseUrl / apiKey）→ 抛可读错误（防御兜底）", async () => {
    const baseTpl = template({ url: "{{baseUrl}}/search?q={{query}}" });
    await assert.rejects(runTemplateEngine(baseTpl, resolved("searxng"), "q", {}, {}, makeFetch([jsonOk([])])), /测试引擎 template requires \{\{baseUrl\}\} but no base URL is configured/);

    const keyTpl = template({ url: "https://api.example.com/search", headers: { "X-Key": "{{apiKey}}" } });
    await assert.rejects(runTemplateEngine(keyTpl, resolved("bocha"), "q", {}, {}, makeFetch([jsonOk([])])), /测试引擎 template requires \{\{apiKey\}\} but no key is configured/);
  });

  it("GET params 合并：追加/覆盖同名 query 参数，非字符串值 JSON 序列化，undefined 跳过", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ url: "https://api.example.com/search?q={{query}}&count={{count}}" });
    await runTemplateEngine(tpl, resolved("test"), "q", { maxResults: 5 }, { count: 2, freshness: "day", nested: { a: 1 }, arr: [1, 2], drop: undefined }, fetchFn);

    const params = new URL(fetchFn.calls[0]!.url).searchParams;
    assert.equal(params.get("q"), "q");
    assert.equal(params.get("count"), "2", "params 同名覆盖模板 URL 内的值");
    assert.equal(params.get("freshness"), "day");
    assert.equal(params.get("nested"), '{"a":1}');
    assert.equal(params.get("arr"), "[1,2]");
    assert.equal(params.has("drop"), false);
  });
});

describe("模板执行器：body 结构化替换与 POST params 浅合并三级降级（T-E2）", () => {
  it("query 含引号/反斜杠时请求体仍为合法 JSON；整值 \"{{count}}\" 替换为 number（含数组元素）", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search", defaultBody: '{"query":"{{query}}","note":"plain","count":"{{count}}","nested":{"items":["{{query}}","{{count}}"]}}' });
    const query = '他说："你好"\\世界';
    await runTemplateEngine(tpl, resolved("test"), query, { maxResults: 4 }, {}, fetchFn);

    const body = JSON.parse(fetchFn.calls[0]!.init.body as string) as Record<string, unknown>;
    assert.equal(body.query, query);
    assert.equal(body.note, "plain");
    assert.equal(body.count, 4);
    assert.equal(typeof body.count, "number");
    assert.deepEqual(body.nested, { items: [query, 4] });
  });

  it("浅合并三级之全覆盖：params 带全部字段时默认值全被覆盖（params 为字面值，不做占位符替换）", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search", defaultBody: '{"query":"{{query}}","count":"{{count}}","note":"plain"}' });
    await runTemplateEngine(tpl, resolved("test"), "原始query", { maxResults: 5 }, { query: "override", count: 9, note: "mine" }, fetchFn);

    assert.deepEqual(JSON.parse(fetchFn.calls[0]!.init.body as string), { query: "override", count: 9, note: "mine" });
  });

  it("浅合并三级之部分传参：未覆盖字段补默认（{{query}}/{{count}} 仍替换）", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search", defaultBody: '{"query":"{{query}}","count":"{{count}}","note":"plain"}' });
    await runTemplateEngine(tpl, resolved("test"), "剩余字段", { maxResults: 7 }, { note: "mine" }, fetchFn);

    assert.deepEqual(JSON.parse(fetchFn.calls[0]!.init.body as string), { query: "剩余字段", count: 7, note: "mine" });
  });

  it("浅合并三级之纯默认：params 为空对象时 defaultBody 原样替换后透传", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search", defaultBody: '{"query":"{{query}}","count":"{{count}}"}' });
    await runTemplateEngine(tpl, resolved("test"), "纯默认", { maxResults: 6 }, {}, fetchFn);

    assert.deepEqual(JSON.parse(fetchFn.calls[0]!.init.body as string), { query: "纯默认", count: 6 });
  });

  it("defaultBody 与 params 均空 → POST {}（引擎自行报错，走链降级）", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search" });
    await runTemplateEngine(tpl, resolved("test"), "q", {}, {}, fetchFn);

    assert.equal(fetchFn.calls[0]!.init.body, "{}");
  });

  it("defaultBody 缺失但 params 非空：params 独立成 body（可选语义，不再要求 POST 必有默认 body）", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search" });
    await runTemplateEngine(tpl, resolved("test"), "q", {}, { query: "only-params" }, fetchFn);

    assert.deepEqual(JSON.parse(fetchFn.calls[0]!.init.body as string), { query: "only-params" });
  });
});

describe("模板执行器：最长对象数组提取（T-E3 透传响应）", () => {
  it("多数组取最长：嵌套更深的对象数组胜出", async () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const out = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("test"), "q", {}, {}, makeFetch([jsonOk({ shallow: [{ id: 0 }], deep: { pages: { items } }, tags: ["a", "b", "c", "d", "e", "f"] })]));
    assert.deepEqual(parseResults(out), items);
  });

  it("平局取先出现：同长数组按深度先序（JSON 键插入序）取首个", async () => {
    const firstSeen = [{ id: "first-seen" }];
    const out = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("test"), "q", {}, {}, makeFetch([jsonOk({ firstSeen, second: [{ id: "second" }] })]));
    assert.deepEqual(parseResults(out), firstSeen);
  });

  it("string[] / number[] 不算对象数组：混响应里只认元素为 object 的数组", async () => {
    const results = [{ id: "only-object-array" }];
    const out = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("test"), "q", {}, {}, makeFetch([jsonOk({ tags: ["a", "b", "c"], nums: [1, 2, 3, 4], results })]));
    assert.deepEqual(parseResults(out), results);
  });

  it("空数组 = 成功空结果（根数组与嵌套空数组皆然），文本为 \"[]\"", async () => {
    const root = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("custom:root"), "q", {}, {}, makeFetch([jsonOk([])]));
    assert.deepEqual(root, { engine: "custom:root", results: "[]" });

    const nested = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("custom:nested"), "q", {}, {}, makeFetch([jsonOk({ data: { items: [] } })]));
    assert.deepEqual(nested, { engine: "custom:nested", results: "[]" });
  });
});

describe("模板执行器：无数组降级与业务码失败（T-E4）", () => {
  const KEY = "sk-envelope-secret-key";

  it("响应无对象数组 → 链降级失败（错误附脱敏响应摘录）", async () => {
    await assert.rejects(runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("custom:none"), "q", {}, {}, makeFetch([jsonOk({})])), /测试引擎 API returned no results array/);

    await assert.rejects(runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("custom:prim"), "q", {}, {}, makeFetch([jsonOk("plain string")])), /no results array/);

    await assert.rejects(runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("custom:nums"), "q", {}, {}, makeFetch([jsonOk({ nums: [1, 2, 3] })])), /no results array/);
  });

  it("bocha 业务码失败（HTTP 200 + body code 401）：无数组判据接住，msg 回显的 key 明文先脱敏", async () => {
    const out = runTemplateEngine(template({ name: "博查搜索", url: "https://api.example.com/search" }), resolved("bocha", { apiKey: KEY }), "q", {}, {}, makeFetch([jsonOk({ code: 401, msg: `invalid token ${KEY} rejected` })]));
    await assert.rejects(out, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /博查搜索 API returned no results array/);
      assert.ok(message.includes("401"), "响应摘录携带业务码供诊断");
      assert.ok(message.includes("***"));
      assert.equal(message.includes(KEY), false);
      return true;
    });
  });
});

describe("模板执行器：错误通道与脱敏（T-E5）", () => {
  const KEY = "sk-http-secret-key";

  it("非 2xx → 可读错误（文案用 template.name 显示名，含 status），body 回显 key 脱敏且截断 300 字符", async () => {
    const tpl = template({ name: "博查搜索", url: "https://api.example.com/search" });
    const longBody = `token ${KEY} rejected ${"x".repeat(400)}`;
    await assert.rejects(runTemplateEngine(tpl, resolved("bocha", { apiKey: KEY }), "q", {}, {}, makeFetch([new Response(longBody, { status: 401 })])), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal((error as { key?: string }).key, "TOOL_SEARCH_FAILED", "运行时错误走 engineFailed 通道供串行降级");
      assert.match(message, /博查搜索 API error 401: /);
      assert.equal(message.includes(KEY), false);
      assert.ok(message.includes("***"));
      assert.equal(message.length, "博查搜索 API error 401: ".length + 300, "回显 body 截断到 300 字符");
      return true;
    });
  });

  it("JSON parse 失败 → 可读错误；e.message 内嵌 body 片段回显 key 时过 redactSecret 脱敏（FIX-6）", async () => {
    const tpl = template({ url: "https://api.example.com/search" });
    await assert.rejects(runTemplateEngine(tpl, resolved("searxng"), "q", {}, {}, makeFetch([new Response("not-json", { status: 200 })])), /测试引擎 API returned invalid JSON/);

    // V8 的 JSON.parse 错误只回显 body 前 ~10 字符：用短 key 才能完整落入片段，
    // 验证 e.message 确实过了 redactSecret（长 key 只会泄漏前缀片段，无法整串命中）。
    const shortKey = "k3y123";
    const bochaTpl = template({ name: "博查搜索", url: "https://api.example.com/search" });
    await assert.rejects(runTemplateEngine(bochaTpl, resolved("bocha", { apiKey: shortKey }), "q", {}, {}, makeFetch([new Response(`${shortKey} not-json`, { status: 200 })])), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /博查搜索 API returned invalid JSON/);
      assert.ok(message.includes("***"), "JSON.parse 错误内嵌的 body 片段已脱敏");
      assert.equal(message.includes(shortKey), false);
      return true;
    });
  });

  it("50KB 预算内截断：超预算数组文本尾部带截断标注，预算内原样透传", async () => {
    // 18 条 × ~3KB ≈ 54KB > 50KB 预算。
    const bigItems = Array.from({ length: 18 }, (_value, index) => ({ url: `https://item.example.com/${index}`, content: "s".repeat(3000) }));
    const fullText = JSON.stringify(bigItems);
    assert.ok(utf8ByteLength(fullText) > TOOL_OUTPUT_MAX_BYTES, "测试数据本身应超预算");

    const truncated = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("test"), "q", {}, {}, makeFetch([jsonOk(bigItems)]));
    assert.equal(typeof truncated.results, "string");
    assert.ok(utf8ByteLength(fullText) > (truncated.results as string).length, "回流文本应短于全文");
    assert.ok((truncated.results as string).endsWith("已截断]"), `截断标注：${(truncated.results as string).slice(-50)}`);
    assert.ok((truncated.results as string).startsWith(`[${JSON.stringify(bigItems[0]).slice(0, 30)}`), "截断保留数组头部原样字节");

    // 预算内：小响应原样透传（无标注）。
    const smallItems = [{ id: 1 }, { id: 2 }];
    const intact = await runTemplateEngine(template({ url: "https://api.example.com/search" }), resolved("test"), "q", {}, {}, makeFetch([jsonOk(smallItems)]));
    assert.equal(intact.results, JSON.stringify(smallItems));
  });

  it("30s 超时 → timed out after 文案（AbortController 路径）", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const tpl = template({ url: "https://api.example.com/search" });
    // fetch 永不 resolve、只监听 AbortSignal（abort 时才 reject）。
    const hangingFetch = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
      })) as unknown as typeof globalThis.fetch;
    const pending = runTemplateEngine(tpl, resolved("bocha"), "q", {}, {}, hangingFetch).then(
      () => assert.fail("超时应抛错"),
      (error: unknown) => error,
    );
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(30_000);

    const error = await pending;
    const message = error instanceof Error ? error.message : String(error);
    assert.equal((error as { key?: string }).key, "TOOL_SEARCH_FAILED");
    assert.match(message, /测试引擎 search timed out after 30000ms/);
  });
});

describe("模板执行器：{{count}} 归一（T-E6，客户端截断已随透传废除）", () => {
  it("{{count}} 归一：0→5、99→20（POST defaultBody 保持 number 类型）", async () => {
    const tpl = template({ method: "POST", url: "https://api.example.com/search", defaultBody: '{"count":"{{count}}"}' });
    const fetchFn = makeFetch([jsonOk({ results: [] }), jsonOk({ results: [] })]);

    await runTemplateEngine(tpl, resolved("custom:clamp"), "q", { maxResults: 0 }, {}, fetchFn);
    assert.equal(JSON.parse(fetchFn.calls[0]!.init.body as string).count, 5);

    await runTemplateEngine(tpl, resolved("custom:clamp"), "q", { maxResults: 99 }, {}, fetchFn);
    assert.equal(JSON.parse(fetchFn.calls[1]!.init.body as string).count, 20);
  });
});
