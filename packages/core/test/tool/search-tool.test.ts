import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import { SEARCH_TOOL_NAME, searchTool } from "../../src/domain/tool/builtin/search/search-tool.js";
import { SEARCH_NOT_CONFIGURED_MESSAGE, dispatchSearch } from "../../src/domain/tool/builtin/search/engines/dispatch.js";
import { assembleSearchToolContext } from "../../src/service/agent/logic/run-agent-turn.js";
import { createSearchConfigStore, type SearchConfigPublic, type SearchConfigStore } from "../../src/domain/tool/builtin/search/search-config.js";
import { DUCKDUCKGO_ENGINE_META, PRESET_ENGINE_TEMPLATES } from "../../src/domain/tool/builtin/search/preset-templates.js";
import { AppError } from "../../src/errors/app-error.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ResolvedEngineConfig } from "../../src/domain/tool/builtin/search/types.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { formatToolOutputForLlm, isCurlOutput, isSearchOutput } from "../../src/domain/tool/logic/format-tool-output.js";
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
        throw new AppError("KKV_NOT_FOUND", `KKV key not found: ${module}/${key}`);
      }
      return value;
    },
    set: async (module, key, value) => {
      kkvMap.set(`${module}/${key}`, value);
    },
    delete: async (module, key) => {
      kkvMap.delete(`${module}/${key}`);
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
  } = {}
): BuiltinToolContext {
  return {
    vfs: extra.vfs ?? ({} as never),
    projectId: "proj-1",
    sessionId: "sess-1",
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

/** DDG HTML 成功响应（e2e 兜底链断言用，单可解析块）。 */
function ddgHtmlResponse(): Response {
  return new Response(
    `<div class="result results_links web-result">
  <a rel="nofollow" class="result__a" href="https://ddg.example.com/page">DDG 标题</a>
  <a class="result__snippet">DDG 摘要</a>
</div>`,
    { status: 200, headers: { "content-type": "text/html" } }
  );
}

/** 启用指定引擎并写入 key（模板断言统一 fixture 化）。 */
async function enableWithKey(store: SearchConfigStore, engineId: string, key: string): Promise<void> {
  await store.setEnabled(engineId, true);
  await store.saveEngineKey(engineId, key);
}

describe("search 工具：注册与策略", () => {
  it("registry 含 search（共 11 个内置工具），不在任何摘除分支内", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.ok(registry.list().includes(SEARCH_TOOL_NAME));
    assert.equal(registry.list().length, 11);
  });
});

describe("search 工具：run 基础行为", () => {
  it("缺省配置（仅 DDG 启用）：链 = [duckduckgo]，DDG 请求真实发出", async () => {
    const { kkv, secretStore } = fakeStores();
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return ddgHtmlResponse();
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    const out = await runner.call(
      SEARCH_TOOL_NAME,
      { params: { q: "q" } },
      makeCtx({
        search: await assembleSearchToolContext(createSearchConfigStore({ kkv, secretStore })),
        fetchFn,
      })
    );
    const rec = out as { engine: string; results: unknown[] };
    assert.equal(rec.engine, "duckduckgo");
    assert.ok(urls[0]!.startsWith("https://html.duckduckgo.com/html/"), `DDG 请求应发出: ${urls[0]}`);
    assert.equal(urls.length, 1);
  });

  it("T-S4：全关（含 DDG 关闭）返回中性链空提示，不崩溃、不枚举引擎 id", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await store.setEnabled("duckduckgo", false);

    const runner = makeRunner();
    const out = await runner.call(SEARCH_TOOL_NAME, { params: { q: "q" } }, makeCtx({ search: await assembleSearchToolContext(store) }));
    assert.equal(out, SEARCH_NOT_CONFIGURED_MESSAGE);
    // 中性口径：不谎报「未启用任何」，两种到达路径共用一条文案。
    assert.match(SEARCH_NOT_CONFIGURED_MESSAGE, /当前没有可用的已启用搜索引擎/);
    assert.match(SEARCH_NOT_CONFIGURED_MESSAGE, /搜索配置/);
    for (const engineId of ["bocha", "tavily", "searxng", "duckduckgo"]) {
      assert.equal(SEARCH_NOT_CONFIGURED_MESSAGE.includes(engineId), false, `文案不得枚举引擎 id: ${engineId}`);
    }
  });

  it("未装配 search 闭包（CLI / 旧 mock）时抛可读 ToolError 而非崩溃", async () => {
    const runner = makeRunner();
    await assert.rejects(runner.call(SEARCH_TOOL_NAME, { params: { q: "q" } }, makeCtx()), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      assert.match(err.message, /search/);
      return true;
    });
  });

  it("schema：params 缺搜索词时 run 抛可读错误；count 透传给引擎", async () => {
    const runner = makeRunner();
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
    const search = await assembleSearchToolContext(store);
    const fetchFn = (async () => bochaResponse()) as typeof globalThis.fetch;
    const ctx = makeCtx({ search, fetchFn });

    // schema 只校验形状（engine/params）；搜索词缺失在 run 内以可读错误拒绝。
    await assert.rejects(runner.call(SEARCH_TOOL_NAME, { params: { count: 5 } }, ctx), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      const cause = (err as { cause?: unknown }).cause;
      assert.match(String(cause), /params 缺少搜索词/);
      return true;
    });

    const calls: string[] = [];
    const recordingFetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return bochaResponse();
    }) as typeof globalThis.fetch;
    const out = await runner.call(SEARCH_TOOL_NAME, { params: { q: "q", count: 0 } }, makeCtx({ ...ctx, fetchFn: recordingFetch }));
    assert.equal((out as { engine: string }).engine, "bocha");
    assert.equal(calls[0], "https://api.bochaai.com/v1/web-search");
  });

  it("T-S1：inputSchema 只剩 engine / params（搜索词在 params）；outputSchema 接受自定义 id 与 JSON 文本 / 结构列表双形态", () => {
    const parsed = searchTool.inputSchema.safeParse({
      engine: "custom:abc12345",
      params: { q: "q", need_content: true, locale: "zh" },
    });
    assert.equal(parsed.success, true);

    // params 可缺省（搜索词校验在 run 内）；engine 非 string 拒绝。
    assert.equal(searchTool.inputSchema.safeParse({}).success, true);
    assert.equal(searchTool.inputSchema.safeParse({ engine: 123 }).success, false);

    // DDG 结构化列表形态。
    const arrayOutput = searchTool.outputSchema!.safeParse({
      engine: "custom:abc12345",
      results: [{ title: "t", url: "https://x", snippet: "s" }],
    });
    assert.equal(arrayOutput.success, true);
    // 模板引擎 JSON 文本形态。
    const textOutput = searchTool.outputSchema!.safeParse({
      engine: "bocha",
      attempts: "a 失败(401) → bocha 成功",
      results: '[{"id":1},{"id":2}]',
    });
    assert.equal(textOutput.success, true);
  });

  it("T-S2（e2e）：params 透传——模板引擎合并进 POST 请求体（同名覆盖），DDG 忽略 params", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "deepseek", "sk-deepseek");
    const search = await assembleSearchToolContext(store);

    const bodies: string[] = [];
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      urls.push(target);
      if (target.startsWith("https://html.duckduckgo.com/html/")) return ddgHtmlResponse();
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          results: [{ title: "t", url: "https://t.example.com", snippet: "s" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    const out = await runner.call(SEARCH_TOOL_NAME, { params: { query: "量子计算", need_content: true } }, makeCtx({ search, fetchFn }));
    assert.equal((out as { engine: string }).engine, "deepseek");
    assert.equal(urls[0], "https://api.deepseek.com/v1/tools/search");
    const body = JSON.parse(bodies[0]!) as Record<string, unknown>;
    assert.equal(body.query, "量子计算");
    assert.equal(body.need_content, true, "params 自由字段应进请求体");
    assert.equal(body.count, 5, "{{count}} 归一后为 5");

    // 同名 params 覆盖模板默认值（POST 浅合并）。
    await runner.call(SEARCH_TOOL_NAME, { params: { q: "q", count: 99 } }, makeCtx({ search, fetchFn }));
    assert.equal((JSON.parse(bodies[1]!) as Record<string, unknown>).count, 99);

    // DDG 无模板：params 不参与请求（URL 只有 q）。
    const ddgOut = await runner.call(SEARCH_TOOL_NAME, { engine: "duckduckgo", params: { q: "q", any: "thing" } }, makeCtx({ search, fetchFn }));
    assert.equal((ddgOut as { engine: string }).engine, "duckduckgo");
    const ddgUrl = new URL(urls[2]!);
    assert.deepEqual([...ddgUrl.searchParams.keys()], ["q"]);
  });

  it("T-O3：结果序列化超 50KB 走 overflow-sink 落盘（savedPath/message，全文可读回）", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
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
      { params: { q: "q", count: 20 } },
      makeCtx({
        search: await assembleSearchToolContext(store),
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
    assert.ok(rec.savedPath != null && /^\/tmp\/search-\d{8}-[0-9a-f]{4}\.json$/.test(rec.savedPath), `savedPath 形状不对: ${rec.savedPath}`);
    assert.ok(rec.message != null && rec.message.length > 0);
    // 落盘内容 = 截断前的序列化全文，后续 read 可读回。
    const saved = files.get(rec.savedPath!);
    assert.ok(saved != null);
    const parsed = JSON.parse(saved!) as { engine: string; results: unknown };
    assert.equal(parsed.engine, "bocha");
    // 模板引擎 results 为提取数组 JSON 文本；bocha 20 条 ~61KB 超引擎 50KB 预算已截断并标注。
    assert.equal(typeof parsed.results, "string");
    assert.ok((parsed.results as string).endsWith("已截断]"), `引擎侧截断标注：${(parsed.results as string).slice(-60)}`);
    const readBack = (await (
      vfs as never as {
        read: (p: string) => Promise<{ content: string }>;
      }
    ).read(rec.savedPath!)) as { content: string };
    assert.equal(readBack.content, saved);
    // formatter 落盘形态：显示「已落盘 路径」。
    assert.ok(formatToolOutputForLlm(rec).startsWith(`已落盘 ${rec.savedPath}`));
  });

  it("T-O3 对偶：落盘失败（vfs.write 抛错）→ 降级回落完整 SearchResponse", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
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
      { params: { q: "q", count: 20 } },
      makeCtx({
        search: await assembleSearchToolContext(store),
        fetchFn,
        vfs,
      })
    );
    // 降级：完整 SearchResponse 原样回流（engine + 提取数组 JSON 文本），
    // 无 savedPath / message 字段。
    const rec = out as {
      engine: string;
      results: unknown;
      savedPath?: string;
      message?: string;
    };
    assert.equal(rec.engine, "bocha");
    assert.equal(typeof rec.results, "string");
    assert.ok((rec.results as string).length > 0);
    assert.equal("savedPath" in rec, false);
    assert.equal("message" in rec, false);
  });

  it("引擎错误经 toolFailed 包装（FAILED），错误文案不含 key 明文", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha-secret");
    const fetchFn = (async () =>
      new Response("unauthorized token sk-bocha-secret", {
        status: 401,
      })) as typeof globalThis.fetch;

    const runner = makeRunner();
    await assert.rejects(runner.call(SEARCH_TOOL_NAME, { params: { q: "q" } }, makeCtx({ search: await assembleSearchToolContext(store), fetchFn })), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      assert.equal(err.message.includes("sk-bocha-secret"), false);
      return true;
    });
  });
});

describe("search 工具：描述快照（T-D1）", () => {
  it("启用两引擎时描述含两段说明且按链序；关闭引擎后描述无其字样（含 DDG 关闭）", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
    await enableWithKey(store, "tavily", "sk-tavily");
    await store.setEnabled("duckduckgo", false);

    const ctx = makeCtx({ search: await assembleSearchToolContext(store) });
    const description = searchTool.description(ctx);
    const bochaIndex = description.indexOf("- bocha（博查搜索）：");
    const tavilyIndex = description.indexOf("- tavily（Tavily 搜索）：");
    assert.ok(bochaIndex >= 0, `描述缺少 bocha 段：${description}`);
    assert.ok(tavilyIndex > bochaIndex, "逐引擎段应按串行链序");
    assert.equal(description.includes("duckduckgo"), false, "DDG 关闭后描述无其字样");

    await store.setEnabled("bocha", false);
    const afterDisable = searchTool.description(makeCtx({ search: await assembleSearchToolContext(store) }));
    assert.equal(afterDisable.includes("bocha"), false, "下回合装配后关闭引擎不出现");
    assert.ok(afterDisable.includes("- tavily（Tavily 搜索）："));
  });

  it("快照口径=链同款：启用但未配置（无 key）的引擎不出现", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await store.setEnabled("brave", true); // 无 key → 配置不完整
    await store.setEnabled("duckduckgo", false);

    const description = searchTool.description(makeCtx({ search: await assembleSearchToolContext(store) }));
    assert.equal(description.includes("brave"), false);
    assert.match(description, /当前没有可用的已启用引擎/);
  });

  it("DDG 启用时描述含 DUCKDUCKGO_ENGINE_META 逐引擎段", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    const description = searchTool.description(makeCtx({ search: await assembleSearchToolContext(store) }));
    assert.ok(description.includes(`- duckduckgo（${DUCKDUCKGO_ENGINE_META.name}）：${DUCKDUCKGO_ENGINE_META.paramHint}`));
  });

  it("paramHint 不限长：装配期原样透传（不再截断）", async () => {
    const longHint = "x".repeat(600);
    const config: SearchConfigPublic = {
      engines: [
        {
          id: "bocha",
          name: "博查搜索",
          enabled: true,
          needsKey: true,
          hasKey: true,
          needsBaseUrl: false,
          isCustom: false,
          paramHint: longHint,
        },
      ],
      customEngines: [],
      presetOverrides: {},
      canRun: ["bocha"],
    };
    const store: SearchConfigStore = {
      ...createSearchConfigStore(fakeStores()),
      readConfig: async () => config,
    };
    const ctx = makeCtx({ search: await assembleSearchToolContext(store) });
    assert.equal(ctx.search!.engineSnapshot[0]!.paramHint.length, 600);
    assert.ok(searchTool.description(ctx).includes("x".repeat(600)));
  });

  it("未注入 search 闭包（makeCtx()）：描述走中性「未装配」文案，不承诺「调用会返回配置指引」", () => {
    const description = searchTool.description(makeCtx());
    assert.match(description, /当前运行时未装配搜索能力/);
    assert.equal(description.includes("调用会返回配置指引"), false, "未注入闭包时 run 必抛，描述不得承诺返回配置指引");
    assert.equal(description.includes("开启或配置引擎"), false, "未注入闭包时不含空快照指引段（通用尾段的「搜索配置中管理」不算）");
  });

  it("装配 readConfig 失败 → 空快照降级不击穿装配（链解析仍在 run 内自会报错）", async () => {
    const failingStore: SearchConfigStore = {
      ...createSearchConfigStore(fakeStores()),
      readConfig: async () => {
        throw new AppError("KKV_NOT_FOUND", "search config unavailable");
      },
    };
    const search = await assembleSearchToolContext(failingStore);
    assert.deepEqual(search.engineSnapshot, []);
    const description = searchTool.description(makeCtx({ search }));
    assert.match(description, /当前没有可用的已启用引擎/);
    // 空快照描述中性化：保留指引但不承诺 run 行为（快照是装配期取数，链以 run 内解析为准）。
    assert.equal(description.includes("调用会返回配置指引"), false);
    assert.match(description, /设置 → 搜索配置/);
  });

  it("回合内配置变更不刷新描述（下回合生效，照 skills 快照语义）", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
    await store.setEnabled("duckduckgo", false);
    const ctx = makeCtx({ search: await assembleSearchToolContext(store) });
    assert.ok(searchTool.description(ctx).includes("bocha"));

    await enableWithKey(store, "tavily", "sk-tavily");
    assert.equal(searchTool.description(ctx).includes("tavily"), false);
  });
});

describe("search 工具：串行链执行（T-R1 四口径，fixture 模板化）", () => {
  it("① 链首 401 → 降级到下一引擎成功，输出含 attempts 轨迹，formatter 展示轨迹行", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
    await enableWithKey(store, "tavily", "sk-tavily");

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
    const out = await runner.call(SEARCH_TOOL_NAME, { params: { q: "q" } }, makeCtx({ search: await assembleSearchToolContext(store), fetchFn }));
    const rec = out as { engine: string; attempts?: string; results: unknown };
    assert.equal(rec.engine, "tavily");
    assert.equal(rec.attempts, "bocha 失败(401) → tavily 成功");
    // 模板引擎透传：results 为提取数组的 JSON 文本（tavily 响应里的 answer 字符串不参与提取）。
    assert.deepEqual(JSON.parse(rec.results as string), [{ title: "t", url: "https://t.example.com", content: "c" }]);
    assert.deepEqual(urls, ["https://api.bochaai.com/v1/web-search", "https://api.tavily.com/search"]);
    // formatter：模板引擎 JSON 文本形态走「响应文本」抬头 + 尝试轨迹 + 原样文本块。
    const text = formatToolOutputForLlm(rec);
    assert.equal(text.split("\n")[0], "search tavily · 响应文本");
    assert.ok(text.includes("bocha 失败(401) → tavily 成功"), `attempts 应可见：${text.slice(0, 200)}`);
  });

  it("② 全链失败（含 DDG 兜底也失败）：聚合错误每引擎一行摘要、无 key 明文", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha-secret");
    await enableWithKey(store, "tavily", "sk-tavily-secret");

    const fetchFn = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target === "https://api.bochaai.com/v1/web-search") {
        return new Response("bad key sk-bocha-secret", { status: 401 });
      }
      if (target.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response("anomaly detected", { status: 403 });
      }
      return new Response("server error sk-tavily-secret", { status: 500 });
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    await assert.rejects(runner.call(SEARCH_TOOL_NAME, { params: { q: "q" } }, makeCtx({ search: await assembleSearchToolContext(store), fetchFn })), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      const detail = (err.cause as Error).message;
      // 每引擎一行：引擎名前缀 + 各自状态码（链尾 DDG 兜底也失败时同样一行）。
      assert.match(detail, /^串行搜索链全部尝试失败：/);
      assert.match(detail, /bocha: .*401/);
      assert.match(detail, /tavily: .*500/);
      assert.match(detail, /duckduckgo: .*403/);
      // 无 key 明文（响应体回显已被脱敏）。
      assert.equal(detail.includes("sk-bocha-secret"), false);
      assert.equal(detail.includes("sk-tavily-secret"), false);
      return true;
    });
  });

  it("③ 显式 engine 且失败：不降级直接报错（链中后续引擎零请求）", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
    await enableWithKey(store, "tavily", "sk-tavily");

    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("unauthorized", { status: 401 });
    }) as typeof globalThis.fetch;

    const runner = makeRunner();
    await assert.rejects(runner.call(SEARCH_TOOL_NAME, { engine: "bocha", params: { q: "q" } }, makeCtx({ search: await assembleSearchToolContext(store), fetchFn })), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      const detail = (err.cause as Error).message;
      // 只含 bocha 一行，无 tavily 摘要（钉死语义，不降级）。
      assert.match(detail, /bocha: .*401/);
      assert.equal(detail.includes("tavily:"), false);
      return true;
    });
    // tavily 端点零请求。
    assert.deepEqual(urls, ["https://api.bochaai.com/v1/web-search"]);
  });

  it("④ 链总预算 120s 耗尽：模板引擎各 30s 超时后剩余引擎不再尝试，带已收集错误返回（mock timers）", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    await enableWithKey(store, "bocha", "sk-bocha");
    await enableWithKey(store, "tavily", "sk-tavily");
    await enableWithKey(store, "brave", "sk-brave");
    await enableWithKey(store, "deepseek", "sk-deepseek");

    // 挂起 fetch：仅响应 abort（执行器超时定时器触发）后 reject。
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
      // 立即挂 rejection handler：预算耗尽在 tick 的微任务里发生，晚挂会被判 unhandledRejection。
      const callPromise = runner
        .call(
          SEARCH_TOOL_NAME,
          { params: { q: "q" } },
          makeCtx({
            search: await assembleSearchToolContext(store),
            fetchFn: hangingFetch,
          })
        )
        .then(
          () => null,
          (e: unknown) => e
        );
      // 链首 bocha 挂起（fetch + 30s 超时定时器已注册）。
      await new Promise((resolve) => setImmediate(resolve));
      // 前四个模板引擎各 30s 超时 → 虚拟时钟 120s。
      for (let index = 0; index < 4; index += 1) {
        await mock.timers.tick(30_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      // 第五位 DDG 尝试前预算耗尽被拦下。
      const err = (await callPromise) as ToolError;

      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      const detail = (err.cause as Error).message;
      // 已收集的四个引擎超时摘要各一行 + 预算耗尽说明。
      for (const engineId of ["bocha", "tavily", "brave", "deepseek"]) {
        assert.match(detail, new RegExp(`${engineId}: .*timed out after 30000ms`));
      }
      assert.match(detail, /链总预算 120s 已耗尽/);
      assert.match(detail, /剩余 1 个引擎未尝试/);
      // DDG 零请求（预算拦在尝试前）。
      assert.equal(
        urls.some((url) => url.includes("duckduckgo")),
        false,
        `DDG 不应被请求: ${urls.join(", ")}`
      );
    } finally {
      mock.timers.reset();
    }
  });
});

describe("search 工具：显式未知 engine（钉死未知 id）", () => {
  it("engine 不在动态全集：链解析抛 AppError（search_engine_not_found，params 带 id），经 ToolRunner 包装为 FAILED", async () => {
    const { kkv, secretStore } = fakeStores();
    const store = createSearchConfigStore({ kkv, secretStore });
    const runner = makeRunner();
    await assert.rejects(runner.call(SEARCH_TOOL_NAME, { engine: "google", params: { q: "q" } }, makeCtx({ search: await assembleSearchToolContext(store) })), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.equal(err.code, "FAILED");
      const cause = err.cause as AppError;
      assert.ok(cause instanceof AppError);
      assert.equal(cause.messageKey, "error.tool.search_engine_not_found");
      assert.equal(cause.messageParams?.engine, "google");
      return true;
    });
  });
});

describe("search 工具：formatter 与 summary", () => {
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

  it("文本形态（模板引擎透传）：isSearchOutput 命中且格式化为「响应文本」抬头 + 尝试轨迹 + 原样文本块", () => {
    const rec = {
      engine: "bocha",
      attempts: "duckduckgo 失败(403) → bocha 成功",
      results: '[{"name":"结果甲","link":"https://a.example.com"}]',
    };
    assert.equal(isSearchOutput(rec), true);
    const text = formatToolOutputForLlm(rec);
    assert.equal(text.split("\n")[0], "search bocha · 响应文本");
    assert.ok(text.includes("尝试轨迹: duckduckgo 失败(403) → bocha 成功"));
    assert.ok(text.includes('{"name":"结果甲","link":"https://a.example.com"}'));
  });

  it("空结果集与无 answer 均为正常形态；不误撞 curl 形状", () => {
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

  it("落盘形态：格式化为「已落盘 路径」", () => {
    const rec = {
      engine: "bocha",
      savedPath: "/tmp/search-20260906-ab12.json",
      message: "结果超过 50KB，全文已保存，可用 read 分页读取。",
    };
    assert.equal(isSearchOutput(rec), true);
    assert.equal(formatToolOutputForLlm(rec), "已落盘 /tmp/search-20260906-ab12.json\n结果超过 50KB，全文已保存，可用 read 分页读取。");
  });

  it("summary：bocha · N 条结果；文本形态「引擎 · 响应文本」；落盘形态显示已落盘路径；字符串提示无 summary", () => {
    const block = buildToolResultBlock(
      "tu-1",
      {
        ok: true,
        output: {
          engine: "bocha",
          results: Array.from({ length: 5 }, () => ({
            title: "t",
            url: "https://x",
            snippet: "s",
          })),
        },
      } as ParallelToolOutcome,
      { toolName: "search" }
    );
    assert.equal(block.summary, "bocha · 5 条结果");

    // 文本形态（模板引擎透传）：results 为 JSON 字符串 → summary「引擎 · 响应文本」。
    const textForm = buildToolResultBlock(
      "tu-1b",
      {
        ok: true,
        output: {
          engine: "bocha",
          results: '[{"name":"结果甲","link":"https://a.example.com"}]',
        },
      } as ParallelToolOutcome,
      { toolName: "search" }
    );
    assert.equal(textForm.summary, "bocha · 响应文本");

    const saved = buildToolResultBlock(
      "tu-2",
      {
        ok: true,
        output: {
          engine: "bocha",
          savedPath: "/tmp/search-20260906-ab12.json",
          message: "oversize",
        },
      } as ParallelToolOutcome,
      { toolName: "search" }
    );
    assert.equal(saved.summary, "已落盘 /tmp/search-20260906-ab12.json");

    const hint = buildToolResultBlock(
      "tu-3",
      {
        ok: true,
        output: SEARCH_NOT_CONFIGURED_MESSAGE,
      } as ParallelToolOutcome,
      { toolName: "search" }
    );
    assert.equal(hint.summary, undefined);
    assert.equal(hint.content, SEARCH_NOT_CONFIGURED_MESSAGE);
  });
});

describe("dispatch：引擎分发与链空文案", () => {
  it("SEARCH_NOT_CONFIGURED_MESSAGE 为中性文案（不枚举引擎 id）", () => {
    assert.equal(SEARCH_NOT_CONFIGURED_MESSAGE, "当前没有可用的已启用搜索引擎，请在 设置 → 搜索配置 开启或配置引擎");
    assert.match(SEARCH_NOT_CONFIGURED_MESSAGE, /设置 → 搜索配置/);
    for (const engineId of ["bocha", "tavily", "brave", "searxng", "deepseek", "zhipu", "duckduckgo"]) {
      assert.equal(SEARCH_NOT_CONFIGURED_MESSAGE.includes(engineId), false);
    }
  });

  it("dispatchSearch 按引擎路由：模板引擎走 resolved.template，DDG 特判走原适配器", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const target = String(url);
      urls.push(target);
      if (target.startsWith("https://html.duckduckgo.com/html/")) return ddgHtmlResponse();
      return bochaResponse();
    }) as typeof globalThis.fetch;

    const resolved: ResolvedEngineConfig = {
      engine: "bocha",
      apiKey: "k",
      template: PRESET_ENGINE_TEMPLATES.bocha,
    };
    const out = await dispatchSearch(resolved, "q", {}, {}, fetchFn);
    assert.equal(out.engine, "bocha");
    assert.equal(urls[0], "https://api.bochaai.com/v1/web-search");

    const ddg = await dispatchSearch({ engine: "duckduckgo" }, "q", {}, { ignored: true }, fetchFn);
    assert.equal(ddg.engine, "duckduckgo");
    assert.ok(urls[1]!.startsWith("https://html.duckduckgo.com/html/"));
  });

  it("dispatchSearch 未知 id / 无模板：rejected promise 抛 engineFailed 可读错误（含引擎 id，W3 async 化后同时序）", async () => {
    const fetchFn = (async () => bochaResponse()) as typeof globalThis.fetch;
    await assert.rejects(dispatchSearch({ engine: "custom:missing" }, "q", {}, {}, fetchFn), /unknown search engine: custom:missing/);
  });
});
