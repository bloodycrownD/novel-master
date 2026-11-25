import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unwrap, unwrapErr } from "../helpers/result-unwrap.js";
import { McpConfigStoreFactory, type McpConfigStoreDeps } from "../../src/infra/mcp/impl/mcp-config-store.js";
import type { McpServerConfig } from "../../src/domain/mcp/model/mcp-server-config.js";
import { McpToolRefs } from "../../src/domain/mcp/logic/rewrite-mcp-tool-references.js";
import { McpSecretRefs } from "../../src/domain/mcp/ports/mcp-config-store.port.js";
import { AppError, AppErrorOps } from "../../src/errors/app-error.js";
import { Result } from "../../src/errors/either.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";
import { fakeMcpAgentRegistry } from "../helpers/mcp-fake-agent-registry.js";

/** 内存 fake SecretStore：明文落 Map，断言直接读。 */
function fakeSecretStore(): SecretStore & { readonly map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        async has(ref) {
            return map.has(ref);
        },
        async get(ref) {
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

/** 内存 fake KkvService：缺 key 返回 KKV_NOT_FOUND（与 DefaultKkvService 同语义）。 */
function fakeKkv(): KkvService & { readonly map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        async listKeys() {
            return [...map.keys()];
        },
        async get(module, key) {
            const value = map.get(`${module}/${key}`);
            if (value == null) return Result.err(new AppError("KKV_NOT_FOUND", { detail: `KKV key not found: ${module}/${key}` }));
            return Result.ok(value);
        },
        async set(module, key, value) {
            map.set(`${module}/${key}`, value);
        },
        async delete(module, key) {
            const composite = `${module}/${key}`;
            if (!map.has(composite)) return Result.err(new AppError("KKV_NOT_FOUND", { detail: `KKV key not found: ${module}/${key}` }));
            map.delete(composite);
            return Result.ok(undefined);
        },
    };
}

function makeDeps(): McpConfigStoreDeps & {
    readonly kkv: KkvService & { readonly map: Map<string, string> };
    readonly secretStore: ReturnType<typeof fakeSecretStore>;
} {
    const kkv = fakeKkv();
    const secretStore = fakeSecretStore();
    return { kkv, secretStore };
}

/** http 形态 fixture（各用例在此基础上做单点变体）。 */
function httpConfig(id: string, url = `https://${id}.example.com/mcp`): McpServerConfig {
    return { id, description: "", enabled: true, transport: { type: "http", url }, timeoutMs: 120000, auth: { type: "none" } };
}

/** stdio 形态 fixture（归一保留、首版不可用）。 */
function stdioConfig(id: string): McpServerConfig {
    return { id, description: "", enabled: false, transport: { type: "stdio" }, timeoutMs: 1000, auth: { type: "none" } };
}

describe("mcp-config-store", () => {
    it("T-M12: save → list 读写往返一致，同 id upsert 覆盖不重复", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        const http = httpConfig("zhiyu");
        const stdio = stdioConfig("legacy");
        unwrap(await store.save(http));
        unwrap(await store.save(stdio));
        assert.deepEqual(unwrap(await store.list()), [http, stdio]);
        const updated: McpServerConfig = { ...http, transport: { type: "http", url: "https://relocated.example.com/mcp" } };
        unwrap(await store.save(updated));
        assert.deepEqual(unwrap(await store.list()), [updated, stdio]);
    });

    it("create：新 id 追加；id 已存在拒绝（Result.err），不覆盖既有配置", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("zhiyu")));
        const duplicated = unwrapErr(await store.create({ ...httpConfig("zhiyu"), transport: { type: "http", url: "https://evil.example.com/mcp" } }));
        assert.ok(AppErrorOps.is(duplicated, "INFRA_VALIDATION_FAILED"));
        // 被拒的保存不落库：原配置原样保留
        assert.deepEqual(unwrap(await store.list()), [httpConfig("zhiyu")]);
        unwrap(await store.create(httpConfig("fresh")));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("zhiyu"), httpConfig("fresh")]);
    });

    it("rename：换 id 原位替换配置，SKSP 密钥迁到新 ref、旧 ref 清掉，返回 oauthMigrated", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save({ ...httpConfig("old"), auth: { type: "bearer", secretRef: McpSecretRefs.bearer("old") } }));
        unwrap(await store.save(httpConfig("other")));
        deps.secretStore.map.set(McpSecretRefs.bearer("old"), "plain-bearer");
        deps.secretStore.map.set(McpSecretRefs.headers("old"), "{}");
        deps.secretStore.map.set(McpSecretRefs.oauth("old"), '{"tokens":{}}');
        const renamed: McpServerConfig = { ...httpConfig("new"), auth: { type: "bearer", secretRef: McpSecretRefs.bearer("new") } };
        const outcome = unwrap(await store.rename("old", renamed));
        assert.equal(outcome.oauthMigrated, true);
        // 配置原位替换（保序），SKSP 密钥跟着新 id 走、旧 ref 清干净
        assert.deepEqual(unwrap(await store.list()), [renamed, httpConfig("other")]);
        assert.equal(deps.secretStore.map.get(McpSecretRefs.bearer("new")), "plain-bearer");
        assert.equal(deps.secretStore.map.get(McpSecretRefs.headers("new")), "{}");
        assert.equal(deps.secretStore.map.get(McpSecretRefs.oauth("new")), '{"tokens":{}}');
        assert.equal(deps.secretStore.map.has(McpSecretRefs.bearer("old")), false);
        assert.equal(deps.secretStore.map.has(McpSecretRefs.headers("old")), false);
        assert.equal(deps.secretStore.map.has(McpSecretRefs.oauth("old")), false);
    });

    it("rename：新 id 撞其它 server 拒绝（不覆盖）；oauth 键搬迁失败回 oauthMigrated=false，换 ID 照常完成", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("a")));
        unwrap(await store.save(httpConfig("b")));
        const clash = unwrapErr(await store.rename("a", httpConfig("b")));
        assert.ok(AppErrorOps.is(clash, "INFRA_VALIDATION_FAILED"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("a"), httpConfig("b")]);
        // oauth 键存在且搬迁被 SKSP 拒（set throw）→ 授权态回落未授权，换 ID 本身成功
        deps.secretStore.map.set(McpSecretRefs.oauth("a"), '{"tokens":{}}');
        deps.secretStore.set = async (ref, plain) => {
            if (ref === McpSecretRefs.oauth("a2")) throw new AppError("SKSP_WRITE_FAILED", { detail: "injected" });
            deps.secretStore.map.set(ref, plain);
        };
        const moved = unwrap(await store.rename("a", httpConfig("a2")));
        assert.equal(moved.oauthMigrated, false);
        assert.deepEqual(unwrap(await store.list()).map((config) => config.id), ["a2", "b"]);
    });

    it("T-M13: remove 移除配置并连带清掉 bearer / headers / oauth 三个 SKSP ref，重复 remove 幂等", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save({ ...httpConfig("zhiyu"), auth: { type: "bearer", secretRef: McpSecretRefs.bearer("zhiyu") } }));
        unwrap(await store.save(httpConfig("other")));
        deps.secretStore.map.set(McpSecretRefs.bearer("zhiyu"), "plain");
        deps.secretStore.map.set(McpSecretRefs.headers("zhiyu"), "{}");
        deps.secretStore.map.set(McpSecretRefs.oauth("zhiyu"), "{}");
        unwrap(await store.remove("zhiyu"));
        assert.equal(deps.secretStore.map.has(McpSecretRefs.bearer("zhiyu")), false);
        assert.equal(deps.secretStore.map.has(McpSecretRefs.headers("zhiyu")), false);
        assert.equal(deps.secretStore.map.has(McpSecretRefs.oauth("zhiyu")), false);
        assert.deepEqual(unwrap(await store.list()), [httpConfig("other")]);
        unwrap(await store.remove("zhiyu"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("other")]);
    });

    it("读路径容错：损坏 JSON 回空列表，非法条目跳过、合法保留", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        deps.kkv.map.set(`${McpConfigStoreFactory.KKV_MODULE}/${McpConfigStoreFactory.KEY_SERVERS}`, "{oops");
        assert.deepEqual(unwrap(await store.list()), []);
        const valid = JSON.stringify([httpConfig("zhiyu"), { broken: true }, "not-a-server"]);
        deps.kkv.map.set(`${McpConfigStoreFactory.KKV_MODULE}/${McpConfigStoreFactory.KEY_SERVERS}`, valid);
        assert.deepEqual(unwrap(await store.list()), [httpConfig("zhiyu")]);
    });

    it("KKV infra 失败沿 Result.err 接力（list / save / create / rename / remove 五入口同口径）", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        const injected = new AppError("KKV_CONFLICT", { detail: "injected infra failure" });
        deps.kkv.get = async () => Result.err(injected);
        const list = await store.list();
        assert.ok(AppErrorOps.is(unwrapErr(list), "KKV_CONFLICT"));
        const save = await store.save(httpConfig("zhiyu"));
        assert.ok(AppErrorOps.is(unwrapErr(save), "KKV_CONFLICT"));
        const created = await store.create(httpConfig("zhiyu"));
        assert.ok(AppErrorOps.is(unwrapErr(created), "KKV_CONFLICT"));
        const renamed = await store.rename("zhiyu", httpConfig("zhiyu2"));
        assert.ok(AppErrorOps.is(unwrapErr(renamed), "KKV_CONFLICT"));
        const remove = await store.remove("zhiyu");
        assert.ok(AppErrorOps.is(unwrapErr(remove), "KKV_CONFLICT"));
    });

    it("KKV set 失败不被吞：save / rename / remove 的写失败以 reject 冒出，不静默返回 ok", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("seed")));
        deps.kkv.set = async () => {
            throw new AppError("KKV_CONFLICT", { detail: "injected write failure" });
        };
        const isInjected = (error: unknown): boolean => AppErrorOps.is(error, "KKV_CONFLICT");
        await assert.rejects(store.save(httpConfig("zhiyu")), isInjected);
        await assert.rejects(store.rename("seed", httpConfig("seed2")), isInjected);
        await assert.rejects(store.remove("seed"), isInjected);
    });

    it("save 在 KKV 落盘完成后才返回：写后紧跟 list 读到新值（真异步 set 抓未 await）", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        const map = deps.kkv.map;
        deps.kkv.set = async (module, key, value) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            map.set(`${module}/${key}`, value);
        };
        unwrap(await store.save(httpConfig("zhiyu")));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("zhiyu")]);
    });

    it("每工具启停：setToolDisabled 增删条目，清空时移除 server 条目；remove 连带清掉该 server 的清单", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("zhiyu")));
        unwrap(await store.setToolDisabled("zhiyu", "read", true));
        unwrap(await store.setToolDisabled("zhiyu", "write", true));
        unwrap(await store.setToolDisabled("zhiyu", "read", true));
        assert.deepEqual(unwrap(await store.listDisabledTools()), { zhiyu: ["read", "write"] });
        unwrap(await store.setToolDisabled("zhiyu", "read", false));
        assert.deepEqual(unwrap(await store.listDisabledTools()), { zhiyu: ["write"] });
        unwrap(await store.setToolDisabled("zhiyu", "write", false));
        assert.deepEqual(unwrap(await store.listDisabledTools()), {});
        unwrap(await store.setToolDisabled("zhiyu", "read", true));
        unwrap(await store.remove("zhiyu"));
        assert.deepEqual(unwrap(await store.listDisabledTools()), {});
    });

    it("listDisabledTools 读路径容错：损坏值回空表，值不是字符串数组的条目跳过", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        const key = `${McpConfigStoreFactory.KKV_MODULE}/${McpConfigStoreFactory.KEY_DISABLED_TOOLS}`;
        deps.kkv.map.set(key, "{oops");
        assert.deepEqual(unwrap(await store.listDisabledTools()), {});
        deps.kkv.map.set(key, JSON.stringify({ good: ["read"], bad: "read", mixed: ["read", 1] }));
        assert.deepEqual(unwrap(await store.listDisabledTools()), { good: ["read"] });
    });

    it("renameWithRewrite：先改写 agent 引用再改名，afterRename 在改名之后执行", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("old")));
        const registry = fakeMcpAgentRegistry({ hit: { name: "hit", prompts: { persist: [], dynamic: [] }, tools: { allow: ["mcp__old__read"] } } });
        const order: string[] = [];
        const outcome = unwrap(await McpToolRefs.renameWithRewrite({ configStore: store, agentRegistry: registry }, "old", httpConfig("new"), async () => {
            order.push("afterRename");
        }));
        assert.equal(outcome.oauthMigrated, true);
        assert.deepEqual(unwrap(await store.list()), [httpConfig("new")]);
        assert.deepEqual(registry.defs.get("hit")?.tools?.allow, ["mcp__new__read"]);
        assert.deepEqual(order, ["afterRename"]);
    });

    it("renameWithRewrite：引用改写失败时不动配置；afterRename 失败时引用与配置都回到旧 ID", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("old")));
        const registry = fakeMcpAgentRegistry({ hit: { name: "hit", prompts: { persist: [], dynamic: [] }, tools: { allow: ["mcp__old__read"] } } });
        registry.failNext();
        const rewriteFailed = unwrapErr(await McpToolRefs.renameWithRewrite({ configStore: store, agentRegistry: registry }, "old", httpConfig("new")));
        assert.ok(AppErrorOps.is(rewriteFailed, "INFRA_UNEXPECTED_ERROR"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("old")]);
        assert.deepEqual(registry.defs.get("hit")?.tools?.allow, ["mcp__old__read"]);
        const afterFailed = unwrapErr(await McpToolRefs.renameWithRewrite({ configStore: store, agentRegistry: registry }, "old", httpConfig("new"), async () => {
            throw new Error("bearer write failed");
        }));
        assert.ok(afterFailed.message.includes("bearer write failed"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("old")]);
        assert.deepEqual(registry.defs.get("hit")?.tools?.allow, ["mcp__old__read"]);
    });

    it("renameWithRewrite：新 ID 撞到别的 server 时只改回引用，不覆盖同名的那个", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("old")));
        unwrap(await store.save(httpConfig("taken")));
        const registry = fakeMcpAgentRegistry({ hit: { name: "hit", prompts: { persist: [], dynamic: [] }, tools: { allow: ["mcp__old__read"] } } });
        const clash = unwrapErr(await McpToolRefs.renameWithRewrite({ configStore: store, agentRegistry: registry }, "old", httpConfig("taken")));
        assert.ok(AppErrorOps.is(clash, "INFRA_VALIDATION_FAILED"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("old"), httpConfig("taken")]);
        assert.deepEqual(registry.defs.get("hit")?.tools?.allow, ["mcp__old__read"]);
    });

    it("renameWithRewrite：ID 没变时只是普通保存", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("same")));
        const registry = fakeMcpAgentRegistry({});
        const outcome = unwrap(await McpToolRefs.renameWithRewrite({ configStore: store, agentRegistry: registry }, "same", httpConfig("same", "https://moved.example.com/mcp")));
        assert.equal(outcome.oauthMigrated, true);
        assert.deepEqual(unwrap(await store.list()), [httpConfig("same", "https://moved.example.com/mcp")]);
    });
});
