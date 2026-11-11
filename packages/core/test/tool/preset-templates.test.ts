import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runTemplateEngine } from "../../src/domain/tool/builtin/search/engines/template-engine.js";
import { DUCKDUCKGO_ENGINE_META, PRESET_ENGINE_TEMPLATES } from "../../src/domain/tool/builtin/search/preset-templates.js";
import { SEARCH_PARAM_HINT_MAX_LENGTH, validateSearchEngineTemplate, type SearchToolOptions } from "../../src/domain/tool/builtin/search/types.js";

const QUERY = "测试 查询";

/** 跑一份出厂模板并回传请求与响应（mock fetch 记录调用参数，回放单个 JSON Response）。 */
async function runPreset(id: keyof typeof PRESET_ENGINE_TEMPLATES, response: unknown, extra: { readonly apiKey?: string; readonly baseUrl?: string } = {}, options: SearchToolOptions = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const template = PRESET_ENGINE_TEMPLATES[id];
  const out = await runTemplateEngine(template, { engine: id, template, ...extra }, QUERY, options, {}, fetchFn);
  return { call: calls[0]!, out };
}

describe("出厂模板：六份请求形状与响应映射快照锁（T-P1..T-P6）", () => {
  it("T-P1 bocha：POST 端点 / Bearer 鉴权 / JSON body（count 为 number、不默认带 freshness）/ envelope + 候选映射", async () => {
    const key = "sk-bocha-preset-key";
    const { call, out } = await runPreset("bocha", { code: 200, data: { webPages: { value: [{ url: "https://r1.example.com/1", title: "标题甲", summary: "摘要甲" }] } } }, { apiKey: key });

    assert.equal(call.url, "https://api.bochaai.com/v1/web-search");
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Accept"), "application/json");
    assert.deepEqual(JSON.parse(call.init.body as string), { query: QUERY, count: 5, summary: true });
    assert.equal("answer" in out, false);
    assert.deepEqual(out.results, [{ title: "标题甲", url: "https://r1.example.com/1", snippet: "摘要甲" }]);
  });

  it("T-P2 tavily：POST 端点 / Bearer / body 字段与 answerPath 透传", async () => {
    const key = "sk-tavily-preset-key";
    const { call, out } = await runPreset("tavily", { answer: "答案文本", results: [{ title: "T", url: "https://t.example.com/1", content: "内容" }] }, { apiKey: key });

    assert.equal(call.url, "https://api.tavily.com/search");
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(call.init.body as string), { query: QUERY, search_depth: "basic", max_results: 5, include_answer: "basic", include_raw_content: false });
    assert.equal(out.answer, "答案文本");
    assert.deepEqual(out.results, [{ title: "T", url: "https://t.example.com/1", snippet: "内容" }]);
  });

  it("T-P3 brave：GET 端点 / X-Subscription-Token / q 与 count 查询参数 / Accept", async () => {
    const key = "sk-brave-preset-key";
    const { call, out } = await runPreset("brave", { web: { results: [{ title: "B", url: "https://b.example.com/1", description: "描述" }] } }, { apiKey: key });

    assert.ok(call.url.startsWith("https://api.search.brave.com/res/v1/web/search?"), `brave 端点：${call.url}`);
    assert.equal(call.init.method, "GET");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("X-Subscription-Token"), key);
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("Content-Type"), null);
    const params = new URL(call.url).searchParams;
    assert.equal(params.get("q"), QUERY);
    assert.equal(params.get("count"), "5");
    assert.deepEqual(out.results, [{ title: "B", url: "https://b.example.com/1", snippet: "描述" }]);
  });

  it("T-P4 searxng：GET {{baseUrl}} 端点 / 无鉴权头 / URL 不含 count 与 language", async () => {
    const { call, out } = await runPreset("searxng", { results: [{ title: "S", url: "https://s.example.com/1", content: "内容" }] }, { baseUrl: "http://192.168.1.5:8080" });

    const url = new URL(call.url);
    assert.equal(url.origin, "http://192.168.1.5:8080");
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("q"), QUERY);
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.has("count"), false);
    assert.equal(url.searchParams.has("language"), false);
    assert.equal(call.init.method, "GET");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Subscription-Token"), null);
    assert.equal(headers.get("Accept"), "application/json");
    assert.deepEqual(out.results, [{ title: "S", url: "https://s.example.com/1", snippet: "内容" }]);
  });

  it("T-P5 deepseek：POST 端点 / Bearer / body 字段 / snippet 映射", async () => {
    const key = "sk-deepseek-preset-key";
    const { call, out } = await runPreset("deepseek", { results: [{ title: "D", url: "https://d.example.com/1", snippet: "摘要" }] }, { apiKey: key });

    assert.equal(call.url, "https://api.deepseek.com/v1/tools/search");
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(call.init.body as string), { query: QUERY, count: 5 });
    assert.deepEqual(out.results, [{ title: "D", url: "https://d.example.com/1", snippet: "摘要" }]);
  });

  it("T-P6 zhipu：POST 端点 / search_query 字段 / search_engine 固化 search_std / link 映射 url", async () => {
    const key = "sk-zhipu-preset-key";
    const { call, out } = await runPreset("zhipu", { search_result: [{ title: "智谱标题", link: "https://z.example.com/1", content: "智谱摘要" }] }, { apiKey: key });

    assert.equal(call.url, "https://open.bigmodel.cn/api/paas/v4/web_search");
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(call.init.body as string), { search_query: QUERY, search_engine: "search_std", search_intent: false, count: 5 });
    assert.deepEqual(out.results, [{ title: "智谱标题", url: "https://z.example.com/1", snippet: "智谱摘要" }]);
  });
});

describe("出厂模板：常量数据锁（T-P 附带）", () => {
  it("六份模板按出厂序声明且 paramHint 均非空、≤500 字符", () => {
    assert.deepEqual(Object.keys(PRESET_ENGINE_TEMPLATES), ["bocha", "tavily", "brave", "searxng", "deepseek", "zhipu"]);
    for (const [id, template] of Object.entries(PRESET_ENGINE_TEMPLATES)) {
      assert.ok(template.paramHint.length > 0, `${id} paramHint 非空`);
      assert.ok(template.paramHint.length <= SEARCH_PARAM_HINT_MAX_LENGTH, `${id} paramHint ≤ ${SEARCH_PARAM_HINT_MAX_LENGTH}`);
    }
  });

  it("POST 模板统一 Content-Type / Accept，GET 模板带 Accept；searxng URL 用 {{baseUrl}} 且不含 count / language", () => {
    for (const [id, template] of Object.entries(PRESET_ENGINE_TEMPLATES)) {
      const headers = template.headers as Readonly<Record<string, string>>;
      assert.equal(headers.Accept, "application/json", `${id} Accept`);
      if (template.method === "POST") {
        assert.equal(headers["Content-Type"], "application/json", `${id} Content-Type`);
        assert.ok(template.bodyTemplate != null, `${id} bodyTemplate 必填`);
      }
    }
    assert.ok(PRESET_ENGINE_TEMPLATES.searxng.url.includes("{{baseUrl}}"));
    assert.equal(PRESET_ENGINE_TEMPLATES.searxng.url.includes("count"), false);
    assert.equal(PRESET_ENGINE_TEMPLATES.searxng.url.includes("language"), false);
    assert.equal(PRESET_ENGINE_TEMPLATES.zhipu.bodyTemplate?.includes('"search_engine":"search_std"'), true);
  });

  it("DDG 展示常量：name / paramHint 齐备（快照与设置页共用）", () => {
    assert.equal(DUCKDUCKGO_ENGINE_META.name, "DuckDuckGo");
    assert.ok(DUCKDUCKGO_ENGINE_META.paramHint.length > 0);
    assert.ok(DUCKDUCKGO_ENGINE_META.paramHint.length <= SEARCH_PARAM_HINT_MAX_LENGTH);
  });

  it("六份出厂模板全部通过保存路径校验（含明文密钥启发式检测，占位符不误报）", () => {
    for (const [id, template] of Object.entries(PRESET_ENGINE_TEMPLATES)) {
      const validated = validateSearchEngineTemplate(template);
      assert.ok(validated.ok, `${id} 模板应通过校验：${validated.ok ? "" : validated.error.message}`);
    }
  });
});
