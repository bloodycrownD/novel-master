import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import {
  SEARCH_TOOL_NAME,
} from "../../src/domain/tool/builtin/search/search-tool.js";
import {
  SEARCH_NOT_CONFIGURED_MESSAGE,
  dispatchSearch,
} from "../../src/domain/tool/builtin/search/engines/dispatch.js";
import { assembleSearchToolContext } from "../../src/service/agent/logic/run-agent-turn.js";
import { createSearchConfigStore } from "../../src/domain/tool/builtin/search/search-config.js";
import { KkvError } from "../../src/errors/kkv-errors.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ResolvedEngineConfig } from "../../src/domain/tool/builtin/search/types.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  formatToolOutputForLlm,
  isCurlOutput,
  isSearchOutput,
} from "../../src/domain/tool/logic/format-tool-output.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import type { ParallelToolOutcome } from "../../src/domain/tool/logic/tool-runner.js";

/** 内存 fake（同 search-config.test.ts，工具 e2e 装配用）。 */
function fakeStores(): { kkv: KkvService; secretStore: SecretStore } {
  const kkvMap = new Map<string, string>();
  const secretMap = new Map<string, string>();
  const kkv: KkvService = {
    listKeys: async () => [...kkvMap.keys()],
    get: async (module, key) => {
      const value = kkvMap.get(`${module}/${key}`);
      if (value == null) {
        throw new KkvError("NOT_FOUND", `KKV key not found: ${module}/${key}`);
      }
      return value;
    },
    set: async (module, key, value) => {
      kkvMap.set(`${module}/${key}`, value);
    },
    delete: async (module, key) => {
      kkvMap.delete(`${module}/${key}`);
      return true;
    },
  };
  const secretStore: SecretStore = {
    get: async (ref) => secretMap.get(ref) ?? null,
    set: async (ref, plain) => {
      secretMap.set(ref, plain);
    },
    delete: async (ref) => secretMap.delete(ref),
    has: async (ref) => secretMap.has(ref),
  };
  return { kkv, secretStore };
}

/** 构造注入 search 闭包（可选）与 mock fetchFn 的 BuiltinToolContext。 */
function makeCtx(
  extra: {
    readonly search?: BuiltinToolContext["search"];
    readonly fetchFn?: typeof globalThis.fetch;
  } = {},
): BuiltinToolContext {
  return {
    vfs: {} as never,
    projectId: "proj-1",
    sessionId: "sess-1",
    listSessionMessages: async () => [],
    ...(extra.search != null ? { search: extra.search } : {}),
    ...(extra.fetchFn != null ? { fetchFn: extra.fetchFn } : {}),
  };
}

function makeRunner(): ToolRunner<BuiltinToolContext> {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return new ToolRunner(registry);
}

/** bocha 成功响应（e2e 断言端点用）。 */
function bochaResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 200,
      data: {
        webPages: {
          value: [
            {
              url: "https://a.example.com/1",
              title: "标题",
              summary: "摘要",
            },
          ],
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("search 工具：注册与策略", () => {
  it("registry 含 search（共 11 个内置工具），不在任何摘除分支内", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.ok(registry.list().includes(SEARCH_TOOL_NAME));
    assert.equal(registry.list().length, 11);
  });
});

describe("search 工具：run 行为（T-S1 / T-S2）", () => {
  it("T-S1：未配置任何引擎时返回含配置入口指引的提示，不抛错", async () => {
    const runner = makeRunner();
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({
        search: {
          loadEngineConfig: async () => ({ configured: false }),
          resolveActiveEngine: async () => null,
        },
      })
    );
    assert.equal(typeof out, "string");
    const message = out as string;
    assert.equal(message, SEARCH_NOT_CONFIGURED_MESSAGE);
    assert.match(message, /未配置任何搜索引擎/);
    assert.match(message, /AI 搜索/);
    assert.match(message, /bocha/);
    assert.match(message, /searxng/);
  });

  it("未装配 search 闭包（CLI / 旧 mock）时抛可读 ToolError 而非崩溃", async () => {
    const runner = makeRunner();
    await assert.rejects(
      runner.call(SEARCH_TOOL_NAME, { query: "q" }, makeCtx()),
      (err: unknown) => {
        assert.ok(err instanceof ToolError);
        assert.equal(err.code, "FAILED");
        assert.match(err.message, /search/);
        return true;
      }
    );
  });

  it("schema：query 缺省拒绝；maxResults 缺省回落 5", async () => {
    const runner = makeRunner();
    const fetchFn = (async () => bochaResponse()) as typeof globalThis.fetch;
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha");
    const ctx = makeCtx({
      search: assembleSearchToolContext(
        createSearchConfigStore({ kkv, secretStore })
      ),
      fetchFn,
    });

    await assert.rejects(
      runner.call(SEARCH_TOOL_NAME, {} as never, ctx),
      (err: unknown) =>
        err instanceof ToolError && err.code === "INVALID_ARGUMENT"
    );

    // maxResults: 0 经 clamp 归一为 5（schema 放行 0，run 内 normalize）。
    const calls: string[] = [];
    const recordingFetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return bochaResponse();
    }) as typeof globalThis.fetch;
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", maxResults: 0 },
      makeCtx({ ...ctx, fetchFn: recordingFetch })
    );
    assert.equal((out as { engine: string }).engine, "bocha");
    assert.equal(calls[0], "https://api.bochaai.com/v1/web-search");
  });

  it("T-S2（e2e）：input.engine > defaultEngine > 第一个 configured，经真实 dispatch 命中对应端点", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.saveEngineKey("tavily", "sk-tavily");
    const search = assembleSearchToolContext(store);

    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      const payload =
        String(url) === "https://api.tavily.com/search"
          ? { answer: "a", results: [{ title: "t", url: "https://t.example.com", content: "c" }] }
          : { code: 200, data: { webPages: { value: [] } } };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    // ① input.engine=bocha 显式命中（即使 defaultEngine 未设）。
    let out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", engine: "bocha" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "bocha");
    assert.equal(urls[0], "https://api.bochaai.com/v1/web-search");

    // ② 无 input → defaultEngine=tavily 命中。
    await store.setDefaultEngine("tavily");
    out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "tavily");
    assert.equal(urls[1], "https://api.tavily.com/search");
    assert.equal((out as { answer?: string }).answer, "a");

    // ③ 清除 defaultEngine → 第一个 configured（bocha）。
    await store.setDefaultEngine(null);
    out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "bocha");
    assert.equal(urls[2], "https://api.bochaai.com/v1/web-search");

    // ④ input 指向未配置引擎（searxng）→ 顺位回落 bocha，输出回填实际引擎。
    out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", engine: "searxng" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "bocha");
    assert.equal(urls[3], "https://api.bochaai.com/v1/web-search");
  });

  it("T-S2（searxng-only）：仅配 baseUrl 也能解析命中，请求落自托管实例", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await store.setSearxngBaseUrl("http://192.168.1.5:8080");

    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({ results: [{ title: "s", url: "https://s.example.com", content: "c" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({
        search: assembleSearchToolContext(store),
        fetchFn,
      })
    );
    assert.equal((out as { engine: string }).engine, "searxng");
    assert.equal(urls[0], "http://192.168.1.5:8080/search?q=q&format=json");
  });

  it("适配器错误经 toolFailed 包装（FAILED），错误文案不含 key 明文（T-C2 工具层）", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha-secret");
    const fetchFn = (async () =>
      new Response("unauthorized token sk-bocha-secret", { status: 401 })) as typeof globalThis.fetch;

    const runner = makeRunner();
    await assert.rejects(
      runner.call(
        SEARCH_TOOL_NAME,
        { query: "q" },
        makeCtx({
          search: assembleSearchToolContext(
            createSearchConfigStore({ kkv, secretStore })
          ),
          fetchFn,
        })
      ),
      (err: unknown) => {
        assert.ok(err instanceof ToolError);
        assert.equal(err.code, "FAILED");
        assert.equal(err.message.includes("sk-bocha-secret"), false);
        return true;
      }
    );
  });
});

describe("search 工具：formatter 与 summary（Step 4 配套）", () => {
  it("正常形态：isSearchOutput 命中且格式化为引擎抬头 + answer + 紧凑列表", () => {
    const rec = {
      engine: "tavily",
      answer: "原生回答",
      results: [
        { title: "甲", url: "https://a.example.com", snippet: "摘要甲" },
        { title: "乙", url: "https://b.example.com", snippet: "摘要乙" },
      ],
    };
    assert.equal(isSearchOutput(rec), true);
    const text = formatToolOutputForLlm(rec);
    assert.equal(text.split("\n")[0], "search tavily · 2 条结果");
    assert.ok(text.includes("原生回答"));
    assert.ok(text.includes("- 甲 — https://a.example.com — 摘要甲"));
  });

  it("空结果集与无 answer 均为正常形态；不误撞 curl 形状", () => {
    assert.equal(isSearchOutput({ engine: "bocha", results: [] }), true);
    assert.equal(isSearchOutput({ engine: "bocha", results: [] }), true);
    const curlRec = {
      url: "https://x",
      finalUrl: "https://x",
      method: "GET",
      status: 200,
      contentType: "text/html",
      body: "b",
      truncated: false,
      originalBytes: 1,
    };
    assert.equal(isSearchOutput(curlRec), false);
    assert.equal(isCurlOutput(curlRec), true);
  });

  it("落盘形态（Step 6 后出现）：类型守卫先就位，格式化为「已落盘 路径」", () => {
    const rec = {
      engine: "bocha",
      savedPath: "/tmp/search-20260906-ab12.json",
      message: "结果超过 50KB，全文已保存，可用 read 分页读取。",
    };
    assert.equal(isSearchOutput(rec), true);
    assert.equal(
      formatToolOutputForLlm(rec),
      "已落盘 /tmp/search-20260906-ab12.json\n结果超过 50KB，全文已保存，可用 read 分页读取。"
    );
  });

  it("summary：bocha · N 条结果；落盘形态显示已落盘路径；字符串提示无 summary", () => {
    const block = buildToolResultBlock("tu-1", {
      ok: true,
      output: {
        engine: "bocha",
        results: Array.from({ length: 5 }, () => ({
          title: "t",
          url: "https://x",
          snippet: "s",
        })),
      },
    } as ParallelToolOutcome, { toolName: "search" });
    assert.equal(block.summary, "bocha · 5 条结果");

    const saved = buildToolResultBlock("tu-2", {
      ok: true,
      output: {
        engine: "bocha",
        savedPath: "/tmp/search-20260906-ab12.json",
        message: "oversize",
      },
    } as ParallelToolOutcome, { toolName: "search" });
    assert.equal(saved.summary, "已落盘 /tmp/search-20260906-ab12.json");

    const hint = buildToolResultBlock("tu-3", {
      ok: true,
      output: SEARCH_NOT_CONFIGURED_MESSAGE,
    } as ParallelToolOutcome, { toolName: "search" });
    assert.equal(hint.summary, undefined);
    assert.equal(hint.content, SEARCH_NOT_CONFIGURED_MESSAGE);
  });
});

describe("dispatch：引擎分发与未配置文案", () => {
  it("SEARCH_NOT_CONFIGURED_MESSAGE 含双端入口与四引擎说明", () => {
    assert.match(SEARCH_NOT_CONFIGURED_MESSAGE, /设置 → AI 搜索/);
    assert.match(SEARCH_NOT_CONFIGURED_MESSAGE, /我的 → 配置 → AI 搜索/);
  });

  it("dispatchSearch 按引擎路由（bocha 例：端点命中）", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return bochaResponse();
    }) as typeof globalThis.fetch;
    const resolved: ResolvedEngineConfig = {
      engine: "bocha",
      apiKey: "k",
    };
    const out = await dispatchSearch(resolved, "q", {}, fetchFn);
    assert.equal(out.engine, "bocha");
    assert.equal(urls[0], "https://api.bochaai.com/v1/web-search");
  });
});
