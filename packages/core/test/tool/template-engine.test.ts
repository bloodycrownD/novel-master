import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { runTemplateEngine } from "../../src/domain/tool/builtin/search/engines/template-engine.js";
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

/** 文本错误 Response 快捷构造（HTTP 非 2xx 路径）。 */
/** 模板工厂：只写与用例相关的字段，其余取最小合法值。 */
function template(patch: Partial<SearchEngineTemplate> & { readonly url: string }): SearchEngineTemplate {
  return { name: "测试引擎", method: "GET", headers: {}, resultPath: "", fieldMap: { title: ["title"], url: ["url"], snippet: ["snippet"] }, paramHint: "", ...patch };
}

/** 引擎解析结果工厂（凭据按用例注入）。 */
function resolved(engine: string, extra: Partial<ResolvedEngineConfig> = {}): ResolvedEngineConfig {
  return { engine, ...extra };
}

/** fetch 永不 resolve、只监听 AbortSignal（超时用例）。 */
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
    await assert.rejects(runTemplateEngine(baseTpl, resolved("searxng"), "q", {}, {}, makeFetch([jsonOk([])])), /searxng template requires \{\{baseUrl\}\} but no base URL is configured/);

    const keyTpl = template({ url: "https://api.example.com/search", headers: { "X-Key": "{{apiKey}}" } });
    await assert.rejects(runTemplateEngine(keyTpl, resolved("bocha"), "q", {}, {}, makeFetch([jsonOk([])])), /bocha template requires \{\{apiKey\}\} but no key is configured/);
  });

  it("GET params 合并：追加/覆盖同名 query 参数，非字符串值 JSON 序列化，undefined 跳过", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ url: "https://api.example.com/search?q={{query}}&count={{count}}", resultPath: "results" });
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

describe("模板执行器：body 结构化替换与 POST params 浅合并（T-E2）", () => {
  it("query 含引号/反斜杠时请求体仍为合法 JSON；整值 \"{{count}}\" 替换为 number（含数组元素）", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search", bodyTemplate: '{"query":"{{query}}","note":"plain","count":"{{count}}","nested":{"items":["{{query}}","{{count}}"]}}', resultPath: "results" });
    const query = '他说："你好"\\世界';
    await runTemplateEngine(tpl, resolved("test"), query, { maxResults: 4 }, {}, fetchFn);

    const body = JSON.parse(fetchFn.calls[0]!.init.body as string) as Record<string, unknown>;
    assert.equal(body.query, query);
    assert.equal(body.note, "plain");
    assert.equal(body.count, 4);
    assert.equal(typeof body.count, "number");
    assert.deepEqual(body.nested, { items: [query, 4] });
  });

  it("POST params 浅合并：同名覆盖模板字段，嵌套对象整体替换", async () => {
    const fetchFn = makeFetch([jsonOk({ results: [] })]);
    const tpl = template({ method: "POST", url: "https://api.example.com/search", bodyTemplate: '{"query":"{{query}}","count":"{{count}}","nested":{"a":1}}', resultPath: "results" });
    await runTemplateEngine(tpl, resolved("test"), "q", { maxResults: 5 }, { query: "override", count: 9, nested: { b: 2 } }, fetchFn);

    const body = JSON.parse(fetchFn.calls[0]!.init.body as string) as Record<string, unknown>;
    assert.equal(body.query, "override");
    assert.equal(body.count, 9);
    assert.deepEqual(body.nested, { b: 2 });
  });
});

describe("模板执行器：候选 fieldMap 与跳过判据（T-E3）", () => {
  it("按序取首个非空候选；url 候选全空跳过；title 缺省回填 url；snippet 缺省空串", async () => {
    const fetchFn = makeFetch([
      jsonOk([
        { title: "标题甲", name: "备用名", url: "https://a.example.com/1", link: "https://ignored.example.com/1", summary: "摘要甲" },
        { link: "https://b.example.com/2", name: "名字乙", content: "内容乙" },
        { href: "https://c.example.com/3", description: "描述丙" },
        { title: "丢弃：url 候选全空", url: "  ", link: "", href: "   " },
        { title: "丢弃：无 url 候选" },
        { url: "https://d.example.com/6", title: "  ", snippet: "  " },
      ]),
    ]);
    const tpl = template({ url: "https://api.example.com/search", resultPath: "", fieldMap: { title: ["title", "name"], url: ["url", "link", "href"], snippet: ["summary", "snippet", "description", "content"] } });
    const out = await runTemplateEngine(tpl, resolved("bocha"), "q", {}, {}, fetchFn);

    assert.deepEqual(out.results, [
      { title: "标题甲", url: "https://a.example.com/1", snippet: "摘要甲" },
      { title: "名字乙", url: "https://b.example.com/2", snippet: "内容乙" },
      { title: "https://c.example.com/3", url: "https://c.example.com/3", snippet: "描述丙" },
      { title: "https://d.example.com/6", url: "https://d.example.com/6", snippet: "" },
    ]);
  });
});

describe("模板执行器：envelope 与 answerPath（T-E4）", () => {
  const KEY = "sk-envelope-secret-key";

  it("codePath 取值缺失 = 通过；默认 okValues 接受 200 与 \"200\"", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "data.items", envelope: { codePath: "code" } });
    const missing = await runTemplateEngine(tpl, resolved("bocha", { apiKey: KEY }), "q", {}, {}, makeFetch([jsonOk({ data: { items: [{ url: "https://a.example.com/1" }] } })]));
    assert.equal(missing.results.length, 1);

    for (const code of [200, "200"]) {
      const out = await runTemplateEngine(tpl, resolved("bocha", { apiKey: KEY }), "q", {}, {}, makeFetch([jsonOk({ code, data: { items: [] } })]));
      assert.deepEqual(out.results, []);
    }
  });

  it("业务码不通过 → 抛错，msg 回显的 key 明文先脱敏", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "data.items", envelope: { codePath: "code", msgPath: "msg" } });
    await assert.rejects(runTemplateEngine(tpl, resolved("bocha", { apiKey: KEY }), "q", {}, {}, makeFetch([jsonOk({ code: 4001, msg: `invalid token ${KEY} rejected` })])), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /bocha API error 4001/);
      assert.ok(message.includes("***"));
      assert.equal(message.includes(KEY), false);
      return true;
    });
  });

  it("okValues 可自定义（按字符串/数字等价比较）", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "results", envelope: { codePath: "status", okValues: ["ok", 0] } });
    const ok = await runTemplateEngine(tpl, resolved("custom:engine"), "q", {}, {}, makeFetch([jsonOk({ status: "ok", results: [] })]));
    assert.deepEqual(ok.results, []);
    await assert.rejects(runTemplateEngine(tpl, resolved("custom:engine"), "q", {}, {}, makeFetch([jsonOk({ status: "bad", results: [] })])), /custom:engine API error bad: unknown error/);
  });

  it("answerPath：非空字符串 trim 后透传，缺失或空白省略字段", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "data.items", answerPath: "answer" });
    const withAnswer = await runTemplateEngine(tpl, resolved("tavily"), "q", {}, {}, makeFetch([jsonOk({ answer: "  四十二章经  ", data: { items: [] } })]));
    assert.equal(withAnswer.answer, "四十二章经");
    assert.equal(withAnswer.engine, "tavily");

    const missing = await runTemplateEngine(tpl, resolved("tavily"), "q", {}, {}, makeFetch([jsonOk({ data: { items: [] } })]));
    assert.equal("answer" in missing, false);

    const blank = await runTemplateEngine(tpl, resolved("tavily"), "q", {}, {}, makeFetch([jsonOk({ answer: "   ", data: { items: [] } })]));
    assert.equal("answer" in blank, false);
  });
});

describe("模板执行器：错误通道与脱敏（T-E5）", () => {
  const KEY = "sk-http-secret-key";

  it("非 2xx → 可读错误（含 status），body 回显 key 脱敏且截断 300 字符", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "results" });
    const longBody = `token ${KEY} rejected ${"x".repeat(400)}`;
    await assert.rejects(runTemplateEngine(tpl, resolved("bocha", { apiKey: KEY }), "q", {}, {}, makeFetch([new Response(longBody, { status: 401 })])), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal((error as { key?: string }).key, "TOOL_SEARCH_FAILED", "运行时错误走 engineFailed 通道供串行降级");
      assert.match(message, /bocha API error 401: /);
      assert.equal(message.includes(KEY), false);
      assert.ok(message.includes("***"));
      assert.equal(message.length, "bocha API error 401: ".length + 300, "回显 body 截断到 300 字符");
      return true;
    });
  });

  it("JSON parse 失败 → 可读错误", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "results" });
    await assert.rejects(runTemplateEngine(tpl, resolved("searxng"), "q", {}, {}, makeFetch([new Response("not-json", { status: 200 })])), /searxng API returned invalid JSON/);
  });

  it("resultPath 找不到或非数组 → 可读错误；空数组 = 合法空结果", async () => {
    const nested = template({ url: "https://api.example.com/search", resultPath: "data.webPages.value" });
    await assert.rejects(runTemplateEngine(nested, resolved("bocha"), "q", {}, {}, makeFetch([jsonOk({ data: {} })])), /missing data\.webPages\.value results array/);

    const root = template({ url: "https://api.example.com/search", resultPath: "" });
    await assert.rejects(runTemplateEngine(root, resolved("custom:root"), "q", {}, {}, makeFetch([jsonOk({})])), /missing root results array/);

    const notArray = template({ url: "https://api.example.com/search", resultPath: "data" });
    await assert.rejects(runTemplateEngine(notArray, resolved("custom:not-array"), "q", {}, {}, makeFetch([jsonOk({ data: { hmm: true } })])), /missing data results array/);

    const empty = await runTemplateEngine(root, resolved("custom:root"), "q", {}, {}, makeFetch([jsonOk([])]));
    assert.deepEqual(empty, { engine: "custom:root", results: [] });
  });

  it("30s 超时 → timed out after 文案（AbortController 路径）", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const tpl = template({ url: "https://api.example.com/search", resultPath: "results" });
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
    assert.match(message, /bocha search timed out after 30000ms/);
  });
});

describe("模板执行器：客户端截断与 count 归一（T-E6）", () => {
  function manyItems(count: number): readonly Record<string, string>[] {
    return Array.from({ length: count }, (_value, index) => ({ url: `https://item.example.com/${index}` }));
  }

  it("所有模板引擎按 maxResults 客户端截断（searxng 无 count 参数形态）", async () => {
    const tpl = template({ url: "https://api.example.com/search", resultPath: "results" });
    const fetchFn = makeFetch([jsonOk({ results: manyItems(8) })]);

    const limited = await runTemplateEngine(tpl, resolved("searxng"), "q", { maxResults: 3 }, {}, fetchFn);
    assert.equal(limited.results.length, 3);

    const fallback = await runTemplateEngine(tpl, resolved("searxng"), "q", {}, {}, makeFetch([jsonOk({ results: manyItems(8) })]));
    assert.equal(fallback.results.length, 5, "maxResults 缺省为 5");
  });

  it("{{count}} 归一：0→5、99→20（POST body 保持 number 类型）", async () => {
    const tpl = template({ method: "POST", url: "https://api.example.com/search", bodyTemplate: '{"count":"{{count}}"}', resultPath: "results" });
    const fetchFn = makeFetch([jsonOk({ results: [] }), jsonOk({ results: [] })]);

    await runTemplateEngine(tpl, resolved("custom:clamp"), "q", { maxResults: 0 }, {}, fetchFn);
    assert.equal(JSON.parse(fetchFn.calls[0]!.init.body as string).count, 5);

    await runTemplateEngine(tpl, resolved("custom:clamp"), "q", { maxResults: 99 }, {}, fetchFn);
    assert.equal(JSON.parse(fetchFn.calls[1]!.init.body as string).count, 20);
  });
});
