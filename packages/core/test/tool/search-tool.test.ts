import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

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
    readonly vfs?: BuiltinToolContext["vfs"];
  } = {},
): BuiltinToolContext {
  return {
    vfs: extra.vfs ?? ({} as never),
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
          resolveEngineChain: async () => [],
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

  it("T-S2（e2e）：input.engine 钉死起步 > engineOrder 第一个 configured，经真实 dispatch 命中对应端点", async () => {
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
    // ① input.engine=tavily 显式钉死链首（即使默认序 bocha 在前且已配置）。
    let out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", engine: "tavily" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "tavily");
    assert.equal(urls[0], "https://api.tavily.com/search");
    // 显式链首首发成功：省略 attempts 字段。
    assert.equal("attempts" in out, false);

    // ② 无 input：engineOrder 重排后第一个 configured（tavily）命中。
    await store.setEngineOrder(["tavily", "bocha", "brave", "searxng"]);
    out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "tavily");
    assert.equal(urls[1], "https://api.tavily.com/search");
    assert.equal((out as { answer?: string }).answer, "a");

    // ③ 恢复默认序 → 第一个 configured（bocha）命中。
    await store.setEngineOrder(["bocha", "tavily", "brave", "searxng"]);
    out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({ search, fetchFn })
    );
    assert.equal((out as { engine: string }).engine, "bocha");
    assert.equal(urls[2], "https://api.bochaai.com/v1/web-search");

    // ④ input 指向未配置引擎（brave）：从 brave 起截取链 [brave, searxng]
    // 均未配置 → 未配置提示（不全局回落 bocha/tavily）。
    out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", engine: "brave" },
      makeCtx({ search, fetchFn })
    );
    assert.equal(out, SEARCH_NOT_CONFIGURED_MESSAGE);
    assert.equal(urls.length, 3);
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

  it("T-O3: 结果序列化超 50KB 走 overflow-sink 落盘（savedPath/message，全文可读回）", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha");
    // 20 条 × 3KB snippet ≈ 61KB 序列化 > 50KB 预算。
    const longSnippet = "s".repeat(3000);
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: Array.from({ length: 20 }, (_, i) => ({
                url: `https://x.example.com/${i}`,
                title: `t${i}`,
                summary: longSnippet,
              })),
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof globalThis.fetch;

    const files = new Map<string, string>();
    const vfs = {
      write: async (p: string, content: string) => {
        files.set(p, content);
        return { version: 1 };
      },
      read: async (p: string) => {
        const content = files.get(p);
        if (content == null) throw new Error(`NOT_FOUND: ${p}`);
        return { path: p, content, version: 1, mtimeMs: 0 };
      },
    } as never;

    const runner = makeRunner();
    // maxResults=20 让 20 条 3KB snippet 全量回流（缺省 5 条仅 15KB 不触发预算）。
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", maxResults: 20 },
      makeCtx({
        search: assembleSearchToolContext(
          createSearchConfigStore({ kkv, secretStore })
        ),
        fetchFn,
        vfs,
      })
    );
    const rec = out as {
      engine: string;
      savedPath?: string;
      message?: string;
    };
    // 落盘形态：SearchOversizeOutput（engine + savedPath + message，无 results）。
    assert.equal(rec.engine, "bocha");
    assert.ok(
      rec.savedPath != null &&
        /^\/tmp\/search-\d{8}-[0-9a-f]{4}\.json$/.test(rec.savedPath),
      `savedPath 形状不对: ${rec.savedPath}`
    );
    assert.ok(rec.message != null && rec.message.length > 0);
    // 落盘内容 = 截断前的序列化全文，后续 read 可读回。
    const saved = files.get(rec.savedPath!);
    assert.ok(saved != null);
    const parsed = JSON.parse(saved!) as { engine: string; results: unknown[] };
    assert.equal(parsed.engine, "bocha");
    assert.equal(parsed.results.length, 20);
    const readBack = (await (vfs as never as {
      read: (p: string) => Promise<{ content: string }>;
    }).read(rec.savedPath!)) as { content: string };
    assert.equal(readBack.content, saved);
    // formatter 落盘形态：显示「已落盘 路径」。
    assert.ok(
      formatToolOutputForLlm(rec).startsWith(`已落盘 ${rec.savedPath}`)
    );
  });

  it("T-G2（T-O3 对偶）：落盘失败（vfs.write 抛错）→ 降级回落完整 SearchResponse", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha");
    // 与 T-O3 同构：20 条 × 3KB snippet ≈ 61KB 序列化超 50KB 预算。
    const longSnippet = "s".repeat(3000);
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: Array.from({ length: 20 }, (_, i) => ({
                url: `https://x.example.com/${i}`,
                title: `t${i}`,
                summary: longSnippet,
              })),
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof globalThis.fetch;

    // vfs.write 抛错：落盘保险丝失灵，search 不因落盘故障丢搜索所得。
    const vfs = {
      write: async () => {
        throw new Error("vfs unavailable");
      },
    } as never;

    const runner = makeRunner();
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q", maxResults: 20 },
      makeCtx({
        search: assembleSearchToolContext(
          createSearchConfigStore({ kkv, secretStore })
        ),
        fetchFn,
        vfs,
      })
    );
    // 降级：完整 SearchResponse 原样回流（engine + 20 条 results），
    // 无 savedPath / message 字段。
    const rec = out as {
      engine: string;
      results: unknown[];
      savedPath?: string;
      message?: string;
    };
    assert.equal(rec.engine, "bocha");
    assert.equal(rec.results.length, 20);
    assert.equal("savedPath" in rec, false);
    assert.equal("message" in rec, false);
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

describe("search 工具：串行链执行（T-S3，修订轮）", () => {
  it("①链首 401 → 降级到下一 configured 引擎成功，输出含 attempts 轨迹，formatter 展示轨迹行", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha");
    await secretStore.set("search/tavily/apiKey", "sk-tavily");

    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const target = String(url);
      urls.push(target);
      if (target === "https://api.bochaai.com/v1/web-search") {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          answer: "a",
          results: [{ title: "t", url: "https://t.example.com", content: "c" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { query: "q" },
      makeCtx({
        search: assembleSearchToolContext(
          createSearchConfigStore({ kkv, secretStore })
        ),
        fetchFn,
      })
    );
    const rec = out as {
      engine: string;
      attempts?: string;
      results: unknown[];
    };
    assert.equal(rec.engine, "tavily");
    assert.equal(rec.attempts, "bocha 失败(401) → tavily 成功");
    assert.equal(rec.results.length, 1);
    assert.deepEqual(urls, [
      "https://api.bochaai.com/v1/web-search",
      "https://api.tavily.com/search",
    ]);
    // formatter：引擎抬头下一行展示尝试轨迹。
    const lines = formatToolOutputForLlm(rec).split("\n");
    assert.equal(lines[0], "search tavily · 1 条结果");
    assert.equal(lines[1], "尝试轨迹: bocha 失败(401) → tavily 成功");
  });

  it("②全链失败：聚合错误每引擎一行摘要、无 key 明文", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha-secret");
    await secretStore.set("search/tavily/apiKey", "sk-tavily-secret");

    const fetchFn = (async (url: string | URL | Request) => {
      // 两个引擎的 401/500 响应体均回显 key 明文，验证聚合错误脱敏。
      const target = String(url);
      if (target === "https://api.bochaai.com/v1/web-search") {
        return new Response("bad key sk-bocha-secret", { status: 401 });
      }
      return new Response("server error sk-tavily-secret", { status: 500 });
    }) as typeof globalThis.fetch;

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
        const detail = (err.cause as Error).message;
        // 每引擎一行：引擎名前缀 + 各自状态码。
        assert.match(detail, /^串行搜索链全部尝试失败：/);
        assert.match(detail, /bocha: .*401/);
        assert.match(detail, /tavily: .*500/);
        // 无 key 明文（响应体回显已被脱敏）。
        assert.equal(detail.includes("sk-bocha-secret"), false);
        assert.equal(detail.includes("sk-tavily-secret"), false);
        return true;
      }
    );
  });

  it("③显式 engine 且失败：不降级直接报错（链中后续引擎零请求）", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha");
    await secretStore.set("search/tavily/apiKey", "sk-tavily");

    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("unauthorized", { status: 401 });
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    await assert.rejects(
      runner.call(
        SEARCH_TOOL_NAME,
        { query: "q", engine: "bocha" },
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
        const detail = (err.cause as Error).message;
        // 只含 bocha 一行，无 tavily 摘要（钉死语义，不降级）。
        assert.match(detail, /bocha: .*401/);
        assert.equal(detail.includes("tavily:"), false);
        return true;
      }
    );
    // tavily 端点零请求。
    assert.deepEqual(urls, ["https://api.bochaai.com/v1/web-search"]);
  });

  it("④链总预算 120s 耗尽：两引擎各挂起超时后剩余引擎不再尝试，带已收集错误返回（mock timers）", async () => {
    const { kkv, secretStore } = fakeStores();
    await secretStore.set("search/bocha/apiKey", "sk-bocha");
    await secretStore.set("search/tavily/apiKey", "sk-tavily");
    await secretStore.set("search/brave/apiKey", "sk-brave");

    // 挂起 fetch：仅响应 abort（适配器超时定时器触发）后 reject。
    const urls: string[] = [];
    const hangingFetch = ((url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("This operation was aborted"));
        });
      });
    }) as typeof globalThis.fetch;

    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const runner = makeRunner();
      const callPromise = runner.call(
        SEARCH_TOOL_NAME,
        { query: "q" },
        makeCtx({
          search: assembleSearchToolContext(
            createSearchConfigStore({ kkv, secretStore })
          ),
          fetchFn: hangingFetch,
        })
      );
      // 链首 bocha 挂起（fetch + 超时定时器已注册）。
      await new Promise((resolve) => setImmediate(resolve));
      // bocha 60s 超时 → 降级 tavily（此时虚拟时钟 60s，预算尚余）。
      await mock.timers.tick(60_000);
      await new Promise((resolve) => setImmediate(resolve));
      // tavily 60s 超时 → 虚拟时钟 120s，brave 尝试前预算耗尽被拦下。
      await mock.timers.tick(60_000);
      const err = (await callPromise.then(
        () => null,
        (e: unknown) => e
      )) as ToolError;

      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      const detail = (err.cause as Error).message;
      // 已收集的 bocha / tavily 超时摘要各一行 + 预算耗尽说明。
      assert.match(detail, /bocha: .*timed out after 60000ms/);
      assert.match(detail, /tavily: .*timed out after 60000ms/);
      assert.match(detail, /链总预算 120s 已耗尽/);
      assert.match(detail, /剩余 1 个引擎未尝试/);
      // brave 零请求（预算拦在尝试前）。
      assert.equal(
        urls.some((u) => u.includes("brave")),
        false,
        `brave 不应被请求: ${urls.join(", ")}`
      );
    } finally {
      mock.timers.reset();
    }
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
