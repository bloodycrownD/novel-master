import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KEY_CUSTOM_ENGINES,
  KEY_ENABLED_ENGINES,
  KEY_ENGINE_BASE_URLS,
  KEY_ENGINE_ORDER_V2,
  KEY_PRESET_OVERRIDES,
  SEARCH_KKV_MODULE,
  createSearchConfigStore,
  normalizeEngineBaseUrl,
  readSearchConfig,
  resolveEngineChain,
  searchApiKeyRef,
  type SearchConfigDeps,
} from "../../src/domain/tool/builtin/search/search-config.js";
import { DUCKDUCKGO_ENGINE_META, PRESET_ENGINE_TEMPLATES } from "../../src/domain/tool/builtin/search/preset-templates.js";
import { validateSearchEngineTemplate, type SearchEngineTemplate } from "../../src/domain/tool/builtin/search/types.js";
import { AppError } from "../../src/errors/app-error.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";

/** 出厂缺省序（对象声明序即出厂序，DDG 队尾）。 */
const DEFAULT_ORDER = ["bocha", "tavily", "brave", "searxng", "deepseek", "zhipu", "duckduckgo"];

/** 内存 fake SecretStore：记录 has/get 调用日志供断言。 */
function fakeSecretStore(): SecretStore & {
  readonly hasCalls: string[];
  readonly getCalls: string[];
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();
  const hasCalls: string[] = [];
  const getCalls: string[] = [];
  return {
    map,
    hasCalls,
    getCalls,
    async has(ref) {
      hasCalls.push(ref);
      return map.has(ref);
    },
    async get(ref) {
      getCalls.push(ref);
      return map.get(ref) ?? null;
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
  };
}

/** 内存 fake KkvService：缺 key 抛 NOT_FOUND（与 DefaultKkvService 同语义）。 */
function fakeKkv(): KkvService & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async listKeys() {
      return [...map.keys()];
    },
    async get(module, key) {
      const value = map.get(`${module}/${key}`);
      if (value == null) {
        throw new AppError("KKV_NOT_FOUND", `KKV key not found: ${module}/${key}`);
      }
      return value;
    },
    async set(module, key, value) {
      map.set(`${module}/${key}`, value);
    },
    async delete(module, key) {
      const composite = `${module}/${key}`;
      if (!map.has(composite)) {
        throw new AppError("KKV_NOT_FOUND", `KKV key not found: ${module}/${key}`);
      }
      map.delete(composite);
    },
  };
}

function makeDeps(): SearchConfigDeps & {
  readonly kkv: KkvService & { readonly map: Map<string, string> };
  readonly secretStore: ReturnType<typeof fakeSecretStore>;
} {
  const kkv = fakeKkv();
  const secretStore = fakeSecretStore();
  return { kkv, secretStore };
}

/** 断言 AppError 的 i18n descriptor（store 写路径 / 链解析错误契约）。 */
function assertErrorDescriptor(error: unknown, messageKey: string, params?: Record<string, unknown>): boolean {
  assert.ok(error instanceof AppError, `应为 AppError：${String(error)}`);
  assert.equal(error.messageKey, messageKey);
  for (const [name, value] of Object.entries(params ?? {})) assert.equal(error.messageParams?.[name], value);
  return true;
}

/** 合法 GET 模板（各校验用例在此基础上做单点破坏）。 */
function validTemplate(): SearchEngineTemplate {
  return {
    name: "测试引擎",
    method: "GET",
    url: "https://api.example.com/search?q={{query}}",
    headers: { Accept: "application/json" },
    paramHint: "测试参数说明",
  };
}

/** 自定义实例 fixture（模板引用 apiKey 与 baseUrl，覆盖占位符判据）。 */
function customTemplate(): SearchEngineTemplate {
  return {
    name: "我的引擎",
    method: "GET",
    url: "{{baseUrl}}/api/search?q={{query}}",
    headers: { "X-API-Key": "{{apiKey}}" },
    paramHint: "自定义实例参数说明",
  };
}

/** 断言模板校验失败并返回错误（Result 失败分支收窄）。 */
function invalidTemplateError(raw: unknown): AppError<"TOOL_SEARCH_TEMPLATE_INVALID"> {
  const result = validateSearchEngineTemplate(raw);
  assert.equal(result.ok, false, "预期模板校验失败");
  if (result.ok) throw new Error("expected invalid search engine template");
  return result.error;
}

/** 读取 KKV 原始 JSON 值（断言落库形态用）。 */
function readKkvJson(
  deps: SearchConfigDeps & {
    readonly kkv: KkvService & { readonly map: Map<string, string> };
  },
  key: string
): unknown {
  const raw = deps.kkv.map.get(`${SEARCH_KKV_MODULE}/${key}`);
  return raw == null ? undefined : JSON.parse(raw);
}

describe("search-config：ref / kkv-key 常量", () => {
  it("SKSP ref 命名为 search/{engineId}/apiKey，KKV 模块为 nm-search，五键全部新键名", () => {
    assert.equal(searchApiKeyRef("bocha"), "search/bocha/apiKey");
    assert.equal(searchApiKeyRef("custom:abc12345"), "search/custom:abc12345/apiKey");
    assert.equal(SEARCH_KKV_MODULE, "nm-search");
    assert.equal(KEY_ENABLED_ENGINES, "enabledEngines");
    assert.equal(KEY_ENGINE_ORDER_V2, "engineOrderV2");
    assert.equal(KEY_CUSTOM_ENGINES, "customEngines");
    assert.equal(KEY_PRESET_OVERRIDES, "presetOverrides");
    assert.equal(KEY_ENGINE_BASE_URLS, "engineBaseUrls");
  });
});

describe("search-config：引擎实例地址规范化（normalizeEngineBaseUrl）", () => {
  it("仅 http/https、禁 userinfo、剥尾斜杠与 search/hash", () => {
    assert.equal(normalizeEngineBaseUrl("https://search.example.com/"), "https://search.example.com");
    assert.equal(normalizeEngineBaseUrl("http://192.168.1.5:8080/searx///"), "http://192.168.1.5:8080/searx");
    assert.equal(normalizeEngineBaseUrl("https://s.example.com/x?q=1#frag"), "https://s.example.com/x");
    assert.equal(normalizeEngineBaseUrl("ftp://x"), null);
    assert.equal(normalizeEngineBaseUrl("https://u:p@x.com"), null);
    assert.equal(normalizeEngineBaseUrl("not a url"), null);
    assert.equal(normalizeEngineBaseUrl("  "), null);
  });
});

describe("search-config：T-C1 新键缺省态与存量丢弃", () => {
  it("全空状态：出厂序（DDG 队尾）、仅 DDG 启用、canRun=[duckduckgo]、预置 needsKey/needsBaseUrl 判定", async () => {
    const config = await readSearchConfig(makeDeps());
    assert.deepEqual(
      config.engines.map((engine) => engine.id),
      DEFAULT_ORDER
    );
    // 缺省仅 DDG 启用（PRD R1.2），其余全部关闭。
    for (const engine of config.engines) assert.equal(engine.enabled, engine.id === "duckduckgo");
    assert.deepEqual(config.canRun, ["duckduckgo"]);
    assert.deepEqual(config.customEngines, []);
    assert.deepEqual(config.presetOverrides, {});

    const byId = new Map(config.engines.map((engine) => [engine.id, engine]));
    const duckduckgo = byId.get("duckduckgo")!;
    assert.equal(duckduckgo.name, DUCKDUCKGO_ENGINE_META.name);
    assert.equal(duckduckgo.paramHint, DUCKDUCKGO_ENGINE_META.paramHint);
    assert.equal(duckduckgo.needsKey, false);
    assert.equal(duckduckgo.needsBaseUrl, false);
    assert.equal(duckduckgo.isCustom, false);
    for (const engineId of ["bocha", "tavily", "brave", "deepseek", "zhipu"] as const) {
      assert.equal(byId.get(engineId)!.needsKey, true, `${engineId} 模板应引用 {{apiKey}}`);
      assert.equal(byId.get(engineId)!.needsBaseUrl, false);
      assert.equal(byId.get(engineId)!.hasKey, false);
    }
    const searxng = byId.get("searxng")!;
    assert.equal(searxng.needsKey, false);
    assert.equal(searxng.needsBaseUrl, true);
    assert.equal(searxng.baseUrl, undefined);
  });

  it("存量旧键（engineOrder / searxngBaseUrl）写入后读路径不触达（存量丢弃语义）", async () => {
    const deps = makeDeps();
    await deps.kkv.set(SEARCH_KKV_MODULE, "engineOrder", JSON.stringify(["tavily", "bocha", "brave", "searxng"]));
    await deps.kkv.set(SEARCH_KKV_MODULE, "searxngBaseUrl", "http://legacy.local:8080");

    const config = await readSearchConfig(deps);
    assert.deepEqual(
      config.engines.map((engine) => engine.id),
      DEFAULT_ORDER
    );
    assert.equal(config.engines.find((engine) => engine.id === "searxng")!.baseUrl, undefined);
    // 链解析同样只认新键：旧 searxngBaseUrl 不产生可用引擎。
    assert.deepEqual(await resolveEngineChain(deps), [{ engine: "duckduckgo" }]);
  });
});

describe("search-config：key 通道（保存 / 清除 / 空串拒绝）", () => {
  it("保存 key 后 hasKey=true，清除后回落；明文不出现在任何返回值", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    await store.saveEngineKey("bocha", "sk-plain-bocha");
    let config = await readSearchConfig(deps);
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.hasKey, true);
    assert.equal(config.engines.find((engine) => engine.id === "tavily")!.hasKey, false);
    assert.equal(JSON.stringify(config).includes("sk-plain-bocha"), false, "对外配置不得携带 key 明文");

    await store.clearEngineKey("bocha");
    config = await readSearchConfig(deps);
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.hasKey, false);
  });

  it("saveEngineKey 空串拒绝；自定义实例建后同走统一 key 通道", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await assert.rejects(store.saveEngineKey("bocha", "  "), (e: unknown) => assertErrorDescriptor(e, "error.tool.search_api_key_required"));
    await store.createCustomEngine({
      def: {
        id: "custom:abc12345",
        name: "我的引擎",
        template: validTemplate(),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    await store.saveEngineKey("custom:abc12345", "sk-custom");
    assert.equal(deps.secretStore.map.get("search/custom:abc12345/apiKey"), "sk-custom");
  });

  it("saveEngineKey / clearEngineKey 未知 engineId 拒绝（dangling SKSP ref 防护，点名 FIX-12）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await assert.rejects(store.saveEngineKey("google", "sk-plain-google"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "google",
      })
    );
    await assert.rejects(store.clearEngineKey("google"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "google",
      })
    );
    await assert.rejects(store.clearEngineKey("custom:nope"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "custom:nope",
      })
    );
    assert.equal(deps.secretStore.map.size, 0, "未知 id 不得落 SKSP ref");
    // 已知 id 行为不变。
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.clearEngineKey("bocha");
    assert.equal(deps.secretStore.map.has("search/bocha/apiKey"), false);
  });
});

describe("search-config：T-C2 容错归一与放宽后的 setEngineOrder", () => {
  it("engineOrderV2 损坏回出厂序；未知 id 丢弃、已知项保序、缺失项按出厂序补尾", async () => {
    const deps = makeDeps();
    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, "not-json");
    assert.deepEqual(
      (await readSearchConfig(deps)).engines.map((engine) => engine.id),
      DEFAULT_ORDER
    );

    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, '"tavily"');
    assert.deepEqual(
      (await readSearchConfig(deps)).engines.map((engine) => engine.id),
      DEFAULT_ORDER
    );

    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, '["tavily","tavily","google","searxng"]');
    assert.deepEqual(
      (await readSearchConfig(deps)).engines.map((engine) => engine.id),
      ["tavily", "searxng", "bocha", "brave", "deepseek", "zhipu", "duckduckgo"]
    );

    // 存量四引擎序缺 DDG：按出厂序补尾，用户既有排序保留（点名用例 263 的 engineOrderV2 语义）。
    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, '["tavily","bocha","brave","searxng"]');
    assert.deepEqual(
      (await readSearchConfig(deps)).engines.map((engine) => engine.id),
      ["tavily", "bocha", "brave", "searxng", "deepseek", "zhipu", "duckduckgo"]
    );
  });

  it("enabledEngines dangling id 丢弃；损坏 / 缺省回落仅 DDG 启用", async () => {
    const deps = makeDeps();
    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENABLED_ENGINES, '["bocha","ghost"]');
    let config = await readSearchConfig(deps);
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.enabled, true);
    assert.equal(config.engines.find((engine) => engine.id === "duckduckgo")!.enabled, false);
    assert.deepEqual(config.canRun, [], "bocha 未配置 key，enabled 也不入链");

    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENABLED_ENGINES, '"bocha"');
    config = await readSearchConfig(deps);
    assert.equal(config.engines.find((engine) => engine.id === "duckduckgo")!.enabled, true);
    assert.deepEqual(config.canRun, ["duckduckgo"]);
  });

  it("setEngineOrder 放宽：缺项容忍、未知 id / 重复项拒绝、合法序列存取（点名用例 172 的 order 部分）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    // 缺项容忍：读侧按出厂序补尾。
    await store.setEngineOrder(["tavily", "bocha"]);
    assert.deepEqual(
      (await readSearchConfig(deps)).engines.map((engine) => engine.id),
      ["tavily", "bocha", "brave", "searxng", "deepseek", "zhipu", "duckduckgo"]
    );

    await assert.rejects(store.setEngineOrder(["bocha", "bocha"]), (e: unknown) => assertErrorDescriptor(e, "error.tool.search_engine_order_invalid"));
    await assert.rejects(store.setEngineOrder(["bocha", "google"]), (e: unknown) => assertErrorDescriptor(e, "error.tool.search_engine_order_invalid"));

    // 合法全量序列存取回读（DDG 无队尾特权）。
    await store.setEngineOrder(["duckduckgo", "searxng", "tavily", "brave", "bocha", "zhipu", "deepseek"]);
    assert.deepEqual(
      (await readSearchConfig(deps)).engines.map((engine) => engine.id),
      ["duckduckgo", "searxng", "tavily", "brave", "bocha", "zhipu", "deepseek"]
    );
  });

  it("engineBaseUrls 读路径逐值 normalize：非法值丢弃，canRun 与串行链同源（点名 FIX-13）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    // 绕过保存校验直写脏数据（模拟旧版本 / 外部落库）；bocha 槽位验证合法值归一，与模板是否引用无关。
    await deps.kkv.set(
      SEARCH_KKV_MODULE,
      KEY_ENGINE_BASE_URLS,
      JSON.stringify({
        searxng: "not a url",
        bocha: "https://dirty.example.com///",
      })
    );
    await store.setEnabled("searxng", true);

    const config = await readSearchConfig(deps);
    assert.equal(config.engines.find((engine) => engine.id === "searxng")!.baseUrl, undefined, "非法 baseUrl 读路径丢弃");
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.baseUrl, "https://dirty.example.com", "合法值归一保留");
    assert.equal(config.canRun.includes("searxng"), false, "baseUrl 非法的引擎不得判可跑");

    const chainIds = (await resolveEngineChain(deps)).map((entry) => entry.engine);
    assert.equal(chainIds.includes("searxng"), false, "串行链同样不入（与 canRun 同源）");
    assert.deepEqual(chainIds, config.canRun, "canRun 与串行链逐项一致");
  });
});

describe("search-config：T-C3 resolveEngineChain 双过滤 + 显式三分支", () => {
  it("链 = enabled ∩ 配置完整（占位符判据），按 order 序且条目携带 template（DDG 无模板）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.setEnabled("bocha", true);
    await store.setEnabled("brave", true); // 启用但无 key → 过滤
    await store.setEnabled("searxng", true); // 启用但 URL 仍是出厂示例 → 过滤
    // searxng 无密钥、URL 即完整端点：改掉出厂示例地址后才算配置完整。
    await store.updatePresetOverride("searxng", {
      url: "http://192.168.1.5:8080/search?format=json",
    });

    const chain = await resolveEngineChain(deps);
    assert.deepEqual(
      chain.map((entry) => entry.engine),
      ["bocha", "searxng", "duckduckgo"]
    );
    assert.equal(chain[0]!.apiKey, "sk-bocha");
    assert.equal(chain[0]!.template, PRESET_ENGINE_TEMPLATES.bocha);
    assert.equal(chain[1]!.template!.url, "http://192.168.1.5:8080/search?format=json");
    assert.equal(chain[1]!.template!.method, "GET", "未覆盖字段沿用出厂模板");
    assert.equal("apiKey" in chain[1]!, false, "searxng 模板不引用 apiKey，不得读取 key");
    assert.equal("template" in chain[2]!, false, "DDG 无模板");
  });

  it("DDG 不再恒队尾 / 恒在链：重排后随序、关闭后链空（点名用例 282/337）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.setEngineOrder(["duckduckgo", "bocha", "tavily"]);
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.setEnabled("bocha", true);
    assert.deepEqual(
      (await resolveEngineChain(deps)).map((entry) => entry.engine),
      ["duckduckgo", "bocha"]
    );

    await store.setEnabled("duckduckgo", false);
    await store.setEnabled("bocha", false);
    assert.deepEqual(await resolveEngineChain(deps), []);
    assert.deepEqual((await readSearchConfig(deps)).canRun, []);
  });

  it("显式三分支：①钉链首 ②顺位回落（截尾不全局回落）③未知 id 抛 AppError 含引擎 id", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.saveEngineKey("tavily", "sk-tavily");
    await store.setEnabled("bocha", true);
    await store.setEnabled("tavily", true);
    await store.setEnabled("searxng", true);
    await store.updatePresetOverride("searxng", {
      url: "http://192.168.1.5:8080/search?format=json",
    });

    // ① 已知且通过过滤 → 钉为该引擎单发。
    assert.deepEqual(
      (await resolveEngineChain(deps, "tavily")).map((entry) => entry.engine),
      ["tavily"]
    );

    // ② 已知但未通过过滤 → 沿 order 从该 id 起截尾取第一个可用项：
    // brave 未启用，往后 searxng（已改实例地址）命中；不回落排位更前的 bocha/tavily。
    assert.deepEqual(
      (await resolveEngineChain(deps, "brave")).map((entry) => entry.engine),
      ["searxng"]
    );

    // ② 截尾后链空 → 空数组（调用方走链空提示）。
    await store.setEnabled("searxng", false);
    await store.setEnabled("duckduckgo", false);
    assert.deepEqual(await resolveEngineChain(deps, "searxng"), []);

    // ③ 不在动态全集 → AppError + i18n key（params 带引擎 id）。
    await assert.rejects(resolveEngineChain(deps, "google"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "google",
      })
    );
  });

  it("显式 engine 分支：pinned 引擎只 resolveOne 一次（enabled 且未就绪不在回落循环里重复读 SKSP，点名 FIX-14）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.setEnabled("duckduckgo", false);
    await store.setEnabled("bocha", true); // enabled 但无 key → pinned 试探失败，进入截尾回落

    assert.deepEqual(await resolveEngineChain(deps, "bocha"), [], "截尾后无其他可用引擎 → 空链");
    assert.deepEqual(deps.secretStore.getCalls, ["search/bocha/apiKey"], "pinned 已试探过的引擎恰一次 SKSP 读，回落循环跳过");

    // pinned 就绪路径同样只读一次。
    await store.saveEngineKey("bocha", "sk-bocha");
    assert.deepEqual(
      (await resolveEngineChain(deps, "bocha")).map((entry) => entry.engine),
      ["bocha"]
    );
    assert.deepEqual(deps.secretStore.getCalls, ["search/bocha/apiKey", "search/bocha/apiKey"], "两次显式解析各恰一次 SKSP 读");
  });
});

describe("search-config：T-C4 自定义实例 CRUD 与预置覆盖", () => {
  it("createCustomEngine：模板校验 + append orderV2 + apiKey/baseUrl 拆分落库（不入 enabled）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.createCustomEngine({
      def: {
        id: "custom:abc12345",
        name: "我的引擎",
        template: customTemplate(),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      apiKey: "sk-custom",
      baseUrl: "https://custom.example.com/",
    });

    const config = await readSearchConfig(deps);
    const entry = config.engines.find((engine) => engine.id === "custom:abc12345")!;
    assert.equal(entry.name, "我的引擎");
    assert.equal(entry.isCustom, true);
    assert.equal(entry.enabled, false, "新建自定义实例默认不启用");
    assert.equal(entry.needsKey, true);
    assert.equal(entry.hasKey, true);
    assert.equal(entry.needsBaseUrl, true);
    assert.equal(entry.baseUrl, "https://custom.example.com");
    // orderV2 append（双键之一）；SKSP / engineBaseUrls 拆分落库（模板本体无明文）。
    assert.deepEqual(readKkvJson(deps, KEY_ENGINE_ORDER_V2), [...DEFAULT_ORDER, "custom:abc12345"]);
    assert.equal((readKkvJson(deps, KEY_CUSTOM_ENGINES) as unknown[]).length, 1);
    assert.equal(deps.secretStore.map.get("search/custom:abc12345/apiKey"), "sk-custom");
    assert.deepEqual(readKkvJson(deps, KEY_ENGINE_BASE_URLS), {
      "custom:abc12345": "https://custom.example.com",
    });
    assert.equal(JSON.stringify(config.customEngines).includes("sk-custom"), false);

    // 收录契约：启用后即可入链（模板 + key/baseUrl 就绪）。
    await store.setEnabled("custom:abc12345", true);
    assert.deepEqual((await readSearchConfig(deps)).canRun, ["duckduckgo", "custom:abc12345"]);
    assert.deepEqual(
      (await resolveEngineChain(deps)).map((engine) => engine.engine),
      ["duckduckgo", "custom:abc12345"]
    );
  });

  it("updateCustomEngine：名称 / 模板更新；apiKey/baseUrl 缺省保留、空串清除", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.createCustomEngine({
      def: {
        id: "custom:abc12345",
        name: "我的引擎",
        template: customTemplate(),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      apiKey: "sk-custom",
      baseUrl: "https://custom.example.com",
    });

    await store.updateCustomEngine("custom:abc12345", {
      template: {
        ...customTemplate(),
        name: "改名后的引擎",
        paramHint: "新说明",
      },
    });
    let entry = (await readSearchConfig(deps)).engines.find((engine) => engine.id === "custom:abc12345")!;
    assert.equal(entry.name, "改名后的引擎", "缺省 name 随模板 name");
    assert.equal(entry.paramHint, "新说明");
    assert.equal(entry.hasKey, true, "apiKey 缺省保留");
    assert.equal(entry.baseUrl, "https://custom.example.com", "baseUrl 缺省保留");

    await store.updateCustomEngine("custom:abc12345", {
      apiKey: "",
      baseUrl: "",
    });
    entry = (await readSearchConfig(deps)).engines.find((engine) => engine.id === "custom:abc12345")!;
    assert.equal(entry.hasKey, false);
    assert.equal(entry.baseUrl, undefined);
    assert.deepEqual(readKkvJson(deps, KEY_ENGINE_BASE_URLS), undefined);
    assert.deepEqual((await readSearchConfig(deps)).canRun, ["duckduckgo"]);
  });

  it("deleteCustomEngine：prune orderV2 / enabledEngines / engineBaseUrls + 清 SKSP ref", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.createCustomEngine({
      def: {
        id: "custom:abc12345",
        name: "我的引擎",
        template: customTemplate(),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      apiKey: "sk-custom",
      baseUrl: "https://custom.example.com",
    });
    await store.setEnabled("custom:abc12345", true);

    await store.deleteCustomEngine("custom:abc12345");
    const config = await readSearchConfig(deps);
    assert.deepEqual(config.customEngines, []);
    assert.equal(
      config.engines.some((engine) => engine.id === "custom:abc12345"),
      false
    );
    assert.deepEqual(readKkvJson(deps, KEY_ENGINE_ORDER_V2), DEFAULT_ORDER);
    assert.equal(deps.secretStore.map.has("search/custom:abc12345/apiKey"), false);
    assert.equal(JSON.stringify(readKkvJson(deps, KEY_ENGINE_BASE_URLS) ?? {}).includes("custom:abc12345"), false);
    const enabledRaw = deps.kkv.map.get(`${SEARCH_KKV_MODULE}/${KEY_ENABLED_ENGINES}`) ?? "[]";
    assert.equal(JSON.parse(enabledRaw).includes("custom:abc12345"), false);
  });

  it("presetOverrides：浅合并 + 嵌套对象整体替换、恢复默认；setEnabled 只动开关不动 key", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.setEnabled("bocha", true);

    await store.updatePresetOverride("bocha", {
      headers: {
        Authorization: "Bearer {{apiKey}}",
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Extra": "1",
      },
      paramHint: "覆盖说明",
    });
    let config = await readSearchConfig(deps);
    assert.deepEqual(config.presetOverrides, { bocha: true });
    assert.ok(deps.kkv.map.has(`${SEARCH_KKV_MODULE}/${KEY_PRESET_OVERRIDES}`), "覆盖副本应落 presetOverrides 键");
    let chain = await resolveEngineChain(deps);
    let template = chain.find((entry) => entry.engine === "bocha")!.template!;
    assert.equal(template.headers["X-Extra"], "1", "嵌套对象整体替换（headers 全量覆盖）");
    assert.equal(template.headers.Authorization, "Bearer {{apiKey}}");
    assert.equal(template.url, PRESET_ENGINE_TEMPLATES.bocha.url, "未覆盖字段保留出厂值");
    assert.equal(template.defaultBody, PRESET_ENGINE_TEMPLATES.bocha.defaultBody, "未覆盖字段保留出厂值");
    assert.equal(template.paramHint, "覆盖说明");

    // setEnabled 独立性：开关只动 enabledEngines，不动 key。
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.hasKey, true);
    await store.setEnabled("bocha", false);
    config = await readSearchConfig(deps);
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.enabled, false);
    assert.equal(config.engines.find((engine) => engine.id === "bocha")!.hasKey, true);
    await assert.rejects(store.setEnabled("google", true), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "google",
      })
    );

    // updatePresetOverride 仅预置 id；恢复默认 = 删除覆盖条目。
    await assert.rejects(store.updatePresetOverride("custom:abc12345", { paramHint: "x" }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "custom:abc12345",
      })
    );
    await store.setEnabled("bocha", true);
    await store.resetPresetOverride("bocha");
    config = await readSearchConfig(deps);
    assert.deepEqual(config.presetOverrides, {});
    chain = await resolveEngineChain(deps);
    template = chain.find((entry) => entry.engine === "bocha")!.template!;
    assert.equal(template, PRESET_ENGINE_TEMPLATES.bocha);
  });

  it("setEngineBaseUrl：空串清除、非空规范化、未知引擎拒绝（点名用例 172）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    await assert.rejects(store.setEngineBaseUrl("searxng", "ftp://bad"), (e: unknown) => assertErrorDescriptor(e, "error.tool.search_searxng_base_url_invalid"));
    await assert.rejects(store.setEngineBaseUrl("searxng", "https://u:p@h.com"), (e: unknown) => assertErrorDescriptor(e, "error.tool.search_searxng_base_url_invalid"));
    await assert.rejects(store.setEngineBaseUrl("google", "http://x"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "google",
      })
    );

    await store.setEngineBaseUrl("searxng", "http://localhost:8888/");
    assert.deepEqual(readKkvJson(deps, KEY_ENGINE_BASE_URLS), {
      searxng: "http://localhost:8888",
    });
    await store.setEngineBaseUrl("searxng", "");
    assert.equal(readKkvJson(deps, KEY_ENGINE_BASE_URLS), undefined);
  });

  it("createCustomEngine 错误分支：id 形态 / 重复 id / name 空串全拒绝且零写入（点名 FIX-16）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    const defWith = (
      id: string
    ): {
      id: string;
      name: string;
      template: SearchEngineTemplate;
      createdAt: string;
    } => ({
      id,
      name: "我的引擎",
      template: validTemplate(),
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    // id 不符 ^custom:[A-Za-z0-9_-]{1,64}$：缺前缀 / 空后缀 / 含斜杠 / 超长。
    await assert.rejects(store.createCustomEngine({ def: defWith("myengine") }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_template_invalid", {
        reason: "invalid custom engine id: myengine",
      })
    );
    await assert.rejects(store.createCustomEngine({ def: defWith("custom:") }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_template_invalid", {
        reason: "invalid custom engine id: custom:",
      })
    );
    await assert.rejects(store.createCustomEngine({ def: defWith("custom:a/b") }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_template_invalid", {
        reason: "invalid custom engine id: custom:a/b",
      })
    );
    await assert.rejects(store.createCustomEngine({ def: defWith(`custom:${"a".repeat(65)}`) }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_template_invalid", {
        reason: `invalid custom engine id: custom:${"a".repeat(65)}`,
      })
    );
    assert.equal(deps.kkv.map.size, 0, "id 拒绝路径零写入");

    // 重复 id。
    await store.createCustomEngine({ def: defWith("custom:abc12345") });
    await assert.rejects(store.createCustomEngine({ def: defWith("custom:abc12345") }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_template_invalid", {
        reason: "duplicate custom engine id: custom:abc12345",
      })
    );

    // name 空串（trim 后为空即拒）。
    await assert.rejects(
      store.createCustomEngine({
        def: {
          id: "custom:def67890",
          name: "   ",
          template: validTemplate(),
          createdAt: "",
        },
      }),
      (e: unknown) =>
        assertErrorDescriptor(e, "error.tool.search_template_invalid", {
          reason: "custom engine name is required",
        })
    );
  });

  it("updateCustomEngine / deleteCustomEngine 未知 id 拒绝（点名 FIX-16）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await assert.rejects(store.updateCustomEngine("custom:nope", { name: "改名" }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "custom:nope",
      })
    );
    await assert.rejects(store.deleteCustomEngine("custom:nope"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "custom:nope",
      })
    );
    // 预置 id 不是自定义实例，同样拒绝。
    await assert.rejects(store.updateCustomEngine("bocha", { name: "改名" }), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "bocha",
      })
    );
    await assert.rejects(store.deleteCustomEngine("bocha"), (e: unknown) =>
      assertErrorDescriptor(e, "error.tool.search_engine_not_found", {
        engine: "bocha",
      })
    );
    assert.equal(deps.kkv.map.size, 0, "拒绝路径零写入");
  });
});

describe("search-config：T-C7 validateSearchEngineTemplate 全规则 + 保存路径密钥拒绝", () => {
  it("六份出厂模板全部通过校验；v3 出厂 searxng 为完整端点（URL 内无 {{baseUrl}} 占位符）", () => {
    for (const [engineId, template] of Object.entries(PRESET_ENGINE_TEMPLATES)) {
      const result = validateSearchEngineTemplate(template);
      assert.equal(result.ok, true, `${engineId} 出厂模板应通过校验`);
    }
  });

  it("结构规则：method / URL / defaultBody 可选 / 占位符 / paramHint", () => {
    // 合法基线 + trim 归一。
    const okTemplate = validateSearchEngineTemplate({
      ...validTemplate(),
      name: "  测试引擎  ",
    });
    assert.equal(okTemplate.ok, true);
    if (okTemplate.ok) assert.equal(okTemplate.value.name, "测试引擎");

    // v2：POST 不再强制 defaultBody（留空则依赖 agent 调用时传 params）。
    const postNoBody = validateSearchEngineTemplate({
      ...validTemplate(),
      method: "POST",
      url: "https://api.example.com/search",
    });
    assert.equal(postNoBody.ok, true);
    if (postNoBody.ok) assert.equal("defaultBody" in postNoBody.value, false);

    // 结构性错误统一 TOOL_SEARCH_TEMPLATE_INVALID + search_template_invalid（params 带原因）。
    const methodError = invalidTemplateError({
      ...validTemplate(),
      method: "PUT",
    });
    assert.equal(methodError.key, "TOOL_SEARCH_TEMPLATE_INVALID");
    assert.equal(methodError.messageKey, "error.tool.search_template_invalid");
    assert.match(String(methodError.messageParams?.reason), /method must be GET or POST/);

    assert.match(String(invalidTemplateError({ ...validTemplate(), url: "ftp://x" }).messageParams?.reason), /http or https/);
    assert.match(String(invalidTemplateError({ ...validTemplate(), url: "" }).messageParams?.reason), /url is required/);
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          url: "https://x.com/?q={{limit}}",
        }).messageParams?.reason
      ),
      /unknown placeholder/
    );
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          method: "POST",
          defaultBody: "{oops",
        }).messageParams?.reason
      ),
      /valid JSON/
    );
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          method: "POST",
          defaultBody: '"text"',
        }).messageParams?.reason
      ),
      /JSON object/
    );
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          method: "POST",
          defaultBody: '{"n":"x{{count}}"}',
        }).messageParams?.reason
      ),
      /whole-string/
    );
    // paramHint 不限长：超长说明原样通过校验（装配期也不再截断）。
    const longHint = validateSearchEngineTemplate({
      ...validTemplate(),
      paramHint: "x".repeat(800),
    });
    assert.equal(longHint.ok, true);
    assert.match(String(invalidTemplateError(null).messageParams?.reason), /expected an object/);
  });

  it("明文密钥检测：url / headers / defaultBody 命中拒绝（{{apiKey}} 占位符自身不命中）", () => {
    const headerSecret = invalidTemplateError({
      ...validTemplate(),
      headers: { Authorization: "Bearer sk-live-abcdef" },
    });
    assert.equal(headerSecret.messageKey, "error.tool.search_secret_detected");
    assert.equal(headerSecret.messageParams?.field, "headers.Authorization");

    const urlSecret = invalidTemplateError({
      ...validTemplate(),
      url: "https://x.com/?api_key=abcdefghij1234567890",
    });
    assert.equal(urlSecret.messageKey, "error.tool.search_secret_detected");
    assert.equal(urlSecret.messageParams?.field, "url");

    const bodySecret = invalidTemplateError({
      ...validTemplate(),
      method: "POST",
      defaultBody: '{"q":"{{query}}","api_key":"sk-secret123"}',
    });
    assert.equal(bodySecret.messageKey, "error.tool.search_secret_detected");
    assert.equal(bodySecret.messageParams?.field, "defaultBody");

    // 占位符自身 / 短 token 不是命中项。
    const placeholderOk = validateSearchEngineTemplate({
      ...validTemplate(),
      headers: {
        Authorization: "Bearer {{apiKey}}",
        "X-API-KEY": "{{apiKey}}",
      },
    });
    assert.equal(placeholderOk.ok, true);
    const shortTokenOk = validateSearchEngineTemplate({
      ...validTemplate(),
      headers: { Authorization: "Bearer short-token" },
    });
    assert.equal(shortTokenOk.ok, true);
  });

  it("保存路径密钥拒绝：createCustomEngine / updatePresetOverride 双入口命中即拒绝且零写入", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    await assert.rejects(
      store.createCustomEngine({
        def: {
          id: "custom:abc12345",
          name: "我的引擎",
          template: {
            ...validTemplate(),
            headers: { Authorization: "Bearer sk-live-abcdef" },
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        apiKey: "sk-custom",
      }),
      (e: unknown) =>
        assertErrorDescriptor(e, "error.tool.search_secret_detected", {
          field: "headers.Authorization",
        })
    );
    assert.equal(deps.kkv.map.size, 0, "拒绝保存时不得写 KKV");
    assert.equal(deps.secretStore.map.size, 0, "拒绝保存时不得写 SKSP");

    await assert.rejects(
      store.updatePresetOverride("bocha", {
        defaultBody: '{"query":"{{query}}","count":"{{count}}","api_key":"sk-secret123"}',
      }),
      (e: unknown) =>
        assertErrorDescriptor(e, "error.tool.search_secret_detected", {
          field: "defaultBody",
        })
    );
    assert.equal(deps.kkv.map.size, 0);
  });

  it("paramHint 明文密钥扩扫：create / update / updatePresetOverride 保存入口命中即拒绝且零写入（点名 FIX-15）", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    await assert.rejects(
      store.createCustomEngine({
        def: {
          id: "custom:abc12345",
          name: "我的引擎",
          template: {
            ...validTemplate(),
            paramHint: "鉴权请携带 sk-plain-custom-secret-01",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      (e: unknown) =>
        assertErrorDescriptor(e, "error.tool.search_secret_detected", {
          field: "paramHint",
        })
    );
    await assert.rejects(
      store.updatePresetOverride("bocha", {
        paramHint: "api_key=sk-plain-override-secret-0001",
      }),
      (e: unknown) =>
        assertErrorDescriptor(e, "error.tool.search_secret_detected", {
          field: "paramHint",
        })
    );
    await store.createCustomEngine({
      def: {
        id: "custom:abc12345",
        name: "我的引擎",
        template: validTemplate(),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    await assert.rejects(
      store.updateCustomEngine("custom:abc12345", {
        template: {
          ...validTemplate(),
          paramHint: "密钥 sk-plain-update-secret-0001",
        },
      }),
      (e: unknown) =>
        assertErrorDescriptor(e, "error.tool.search_secret_detected", {
          field: "paramHint",
        })
    );
    assert.equal(deps.kkv.map.size, 2, "仅首次合法 create 落库（customEngines + engineOrderV2），拒绝路径零写入");

    // 合法 paramHint 不受影响，覆盖照常落库。
    await store.updatePresetOverride("bocha", {
      paramHint: "query 拼在 url 上，count 控制条数",
    });
    const overrides = readKkvJson(deps, KEY_PRESET_OVERRIDES) as Record<string, { paramHint: string }>;
    assert.equal(overrides.bocha.paramHint, "query 拼在 url 上，count 控制条数");
  });

  it("W1 回归锁（FIX-3/4/5）：非法头名 / GET 带 defaultBody / JSON 键含占位符全拒绝（FIX-2 随 envelope 字段消亡）", () => {
    // FIX-3：头名非空 + RFC 7230 token（换行 / 空格头名会让执行期 fetch 抛原生 TypeError）。
    assert.match(String(invalidTemplateError({ ...validTemplate(), headers: { "": "x" } }).messageParams?.reason), /header name must not be empty/);
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          headers: { "Bad Name": "x" },
        }).messageParams?.reason
      ),
      /must be a valid HTTP token/
    );
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          headers: { "X-Bad\nName": "x" },
        }).messageParams?.reason
      ),
      /must be a valid HTTP token/
    );
    // CR r2 收紧为完整 RFC 7230 tchar 集：括号 / 引号 / 逗号 / 反斜杠等分隔符拒绝（宽口径 [!-9;-~] 会误放行）。
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          headers: { "X-Key[v2]": "x" },
        }).messageParams?.reason
      ),
      /must be a valid HTTP token/
    );
    assert.match(String(invalidTemplateError({ ...validTemplate(), headers: { 'a"b': "x" } }).messageParams?.reason), /must be a valid HTTP token/);
    assert.match(String(invalidTemplateError({ ...validTemplate(), headers: { "a,b": "x" } }).messageParams?.reason), /must be a valid HTTP token/);
    assert.match(String(invalidTemplateError({ ...validTemplate(), headers: { "a\\b": "x" } }).messageParams?.reason), /must be a valid HTTP token/);
    const tokenOk = validateSearchEngineTemplate({
      ...validTemplate(),
      headers: {
        "X-API-Key": "{{apiKey}}",
        Accept: "application/json",
        "a|b": "x",
        "a~b": "x",
        a_b: "x",
      },
    });
    assert.equal(tokenOk.ok, true, "合法 tchar 头名（含 | ~ _）不受影响");

    // FIX-4：GET 携带 defaultBody 校验层拒绝（静默丢弃会假成功）。
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          defaultBody: '{"q":"{{query}}"}',
        }).messageParams?.reason
      ),
      /defaultBody is not allowed for GET/
    );

    // FIX-5：JSON 键含占位符拒绝（执行器只替换值，键里的占位符会原样进请求）。
    assert.match(
      String(
        invalidTemplateError({
          ...validTemplate(),
          method: "POST",
          defaultBody: '{"{{query}}x":1,"q":"{{query}}"}',
        }).messageParams?.reason
      ),
      /must not contain a placeholder/
    );
  });
});
