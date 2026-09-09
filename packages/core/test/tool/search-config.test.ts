import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SEARCH_KKV_MODULE,
  createSearchConfigStore,
  normalizeSearxngBaseUrl,
  readSearchConfig,
  resolveEngineChain,
  searchApiKeyRef,
  KEY_ENGINE_ORDER,
  KEY_SEARXNG_BASE_URL,
  type SearchConfigDeps,
} from "../../src/domain/tool/builtin/search/search-config.js";
import { KkvError } from "../../src/errors/kkv-errors.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";

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
        throw new KkvError("NOT_FOUND", `KKV key not found: ${module}/${key}`);
      }
      return value;
    },
    async set(module, key, value) {
      map.set(`${module}/${key}`, value);
    },
    async delete(module, key) {
      const composite = `${module}/${key}`;
      if (!map.has(composite)) {
        throw new KkvError("NOT_FOUND", `KKV key not found: ${module}/${key}`);
      }
      map.delete(composite);
      return true;
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

describe("search-config：ref / kkv-key 常量", () => {
  it("SKSP ref 命名为 search/{engineId}/apiKey，KKV 模块为 nm-search", () => {
    assert.equal(searchApiKeyRef("bocha"), "search/bocha/apiKey");
    assert.equal(searchApiKeyRef("tavily"), "search/tavily/apiKey");
    assert.equal(searchApiKeyRef("brave"), "search/brave/apiKey");
    assert.equal(SEARCH_KKV_MODULE, "nm-search");
    assert.equal(KEY_ENGINE_ORDER, "engineOrder");
    assert.equal(KEY_SEARXNG_BASE_URL, "searxngBaseUrl");
  });
});

describe("search-config：searxng baseUrl 规范化", () => {
  it("仅 http/https、禁 userinfo、剥尾斜杠与 search/hash", () => {
    assert.equal(normalizeSearxngBaseUrl("https://search.example.com/"), "https://search.example.com");
    assert.equal(
      normalizeSearxngBaseUrl("http://192.168.1.5:8080/searx///"),
      "http://192.168.1.5:8080/searx"
    );
    assert.equal(
      normalizeSearxngBaseUrl("https://s.example.com/x?q=1#frag"),
      "https://s.example.com/x"
    );
    assert.equal(normalizeSearxngBaseUrl("ftp://x"), null);
    assert.equal(normalizeSearxngBaseUrl("https://u:p@x.com"), null);
    assert.equal(normalizeSearxngBaseUrl("not a url"), null);
    assert.equal(normalizeSearxngBaseUrl("  "), null);
  });
});

describe("search-config：readSearchConfig / 保存与清除（T-C1）", () => {
  it("全空状态：四引擎 configured 均 false、engineOrder 为默认序、baseUrl 空串", async () => {
    const config = await readSearchConfig(makeDeps());
    assert.deepEqual(config.engineOrder, ["bocha", "tavily", "brave", "searxng"]);
    assert.equal(config.searxngBaseUrl, "");
    assert.deepEqual(config.engines, {
      bocha: { configured: false },
      tavily: { configured: false },
      brave: { configured: false },
      searxng: { configured: false },
    });
  });

  it("保存 key 后 configured=true，清除后回落；明文不出现在任何返回值", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    await store.saveEngineKey("bocha", "sk-plain-bocha");
    let config = await readSearchConfig(deps);
    assert.equal(config.engines.bocha.configured, true);
    assert.equal(config.engines.tavily.configured, false);
    assert.equal(
      JSON.stringify(config).includes("sk-plain-bocha"),
      false,
      "对外配置不得携带 key 明文"
    );

    await store.clearEngineKey("bocha");
    config = await readSearchConfig(deps);
    assert.equal(config.engines.bocha.configured, false);
  });

  it("searxng 仅配 baseUrl 即 configured=true（不触碰 secretStore），且存规范化值", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.setSearxngBaseUrl("http://localhost:8888/");

    const config = await readSearchConfig(deps);
    assert.equal(config.engines.searxng.configured, true);
    assert.equal(config.searxngBaseUrl, "http://localhost:8888");
    // searxng 的 configured 判定不查 secretStore（has 日志为空）。
    assert.equal(deps.secretStore.hasCalls.length, 3);
    for (const ref of deps.secretStore.hasCalls) {
      assert.equal(ref.startsWith("search/searxng"), false);
    }
  });

  it("setSearxngBaseUrl 空串清除；非法值抛错；setEngineOrder 存取与非法排列抛错", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);

    await assert.rejects(store.setSearxngBaseUrl("ftp://bad"), /baseUrl 无效/);
    await assert.rejects(store.setSearxngBaseUrl("https://u:p@h.com"), /baseUrl 无效/);

    await store.setSearxngBaseUrl("http://localhost:8888");
    await store.setSearxngBaseUrl("");
    assert.equal((await readSearchConfig(deps)).engines.searxng.configured, false);

    // setEngineOrder：合法排列写入 + 读回；缺项 / 重复 / 含非法 id 抛错。
    await store.setEngineOrder(["searxng", "tavily", "brave", "bocha"]);
    assert.deepEqual((await readSearchConfig(deps)).engineOrder, [
      "searxng",
      "tavily",
      "brave",
      "bocha",
    ]);
    await assert.rejects(
      store.setEngineOrder(["bocha", "tavily", "brave"]),
      /合法排列/
    );
    await assert.rejects(
      store.setEngineOrder(["bocha", "bocha", "tavily", "brave", "searxng"]),
      /合法排列/
    );
    await assert.rejects(
      store.setEngineOrder([
        "bocha",
        "tavily",
        "brave",
        "google" as never,
      ]),
      /合法排列/
    );
  });

  it("saveEngineKey 空串拒绝", async () => {
    const store = createSearchConfigStore(makeDeps());
    await assert.rejects(store.saveEngineKey("bocha", "  "), /API key 不能为空/);
  });
});

describe("search-config：engineOrder 存量损坏容错（T-C1）", () => {
  it("非 JSON / 非数组：整体回落 ENGINE_IDS 默认序", async () => {
    const deps = makeDeps();
    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER, "not-json");
    assert.deepEqual((await readSearchConfig(deps)).engineOrder, [
      "bocha",
      "tavily",
      "brave",
      "searxng",
    ]);

    await deps.kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER, '"tavily"');
    assert.deepEqual((await readSearchConfig(deps)).engineOrder, [
      "bocha",
      "tavily",
      "brave",
      "searxng",
    ]);
  });

  it("含非法项 / 重复 / 缺项：合法前缀去重保留 + 缺项按默认序补齐", async () => {
    const deps = makeDeps();
    await deps.kkv.set(
      SEARCH_KKV_MODULE,
      KEY_ENGINE_ORDER,
      '["tavily","tavily","google","searxng"]'
    );
    // tavily/searxng 合法保留（重复去重），google 剔除，bocha/brave 缺项补齐。
    assert.deepEqual((await readSearchConfig(deps)).engineOrder, [
      "tavily",
      "searxng",
      "bocha",
      "brave",
    ]);
  });
});

describe("search-config：resolveEngineChain 解析链（T-S2 存储层）", () => {
  it("engineOrder 顺序返回全部 configured；显式 inputEngine 从该引擎起截取；全无返回空数组", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.saveEngineKey("bocha", "sk-bocha");
    await store.saveEngineKey("tavily", "sk-tavily");

    // ① 无 input：默认序全量 configured 链。
    assert.deepEqual(await resolveEngineChain(deps), [
      { engine: "bocha", apiKey: "sk-bocha" },
      { engine: "tavily", apiKey: "sk-tavily" },
    ]);

    // ② engineOrder 重排后链随序：tavily 领先。
    await store.setEngineOrder(["tavily", "bocha", "brave", "searxng"]);
    assert.deepEqual(await resolveEngineChain(deps), [
      { engine: "tavily", apiKey: "sk-tavily" },
      { engine: "bocha", apiKey: "sk-bocha" },
    ]);

    // ③ 显式 bocha：从 bocha 起截取（tavily 位于其前，不再入链）。
    assert.deepEqual(await resolveEngineChain(deps, "bocha"), [
      { engine: "bocha", apiKey: "sk-bocha" },
    ]);

    // ④ 显式 brave（未配置）：截取链 [brave, searxng] 内顺位回落，
    // 全未配置 → 空数组（不全局回落 tavily/bocha）。
    assert.deepEqual(await resolveEngineChain(deps, "brave"), []);
  });

  it("searxng-only：仅配 baseUrl（无任何 key）也能被解析链命中，key 引擎零读取", async () => {
    const deps = makeDeps();
    const store = createSearchConfigStore(deps);
    await store.setSearxngBaseUrl("http://192.168.1.5:8080/");

    const chain = await resolveEngineChain(deps);
    assert.deepEqual(chain, [
      { engine: "searxng", baseUrl: "http://192.168.1.5:8080" },
    ]);
    // searxng 命中不读任何 key 明文（get 日志为空）。
    assert.equal(deps.secretStore.getCalls.length, 0);
  });

  it("全无引擎配置返回空数组", async () => {
    assert.deepEqual(await resolveEngineChain(makeDeps()), []);
  });
});
