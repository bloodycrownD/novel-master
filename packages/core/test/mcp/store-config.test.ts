import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unwrap, unwrapErr } from "../helpers/result-unwrap.js";
import { McpConfigStoreFactory, type McpConfigStoreDeps } from "../../src/infra/mcp/impl/mcp-config-store.js";
import type { McpServerConfig } from "../../src/domain/mcp/model/mcp-server-config.js";
import { McpSecretRefs } from "../../src/domain/mcp/ports/mcp-config-store.port.js";
import { AppError, AppErrorOps } from "../../src/errors/app-error.js";
import { Result } from "../../src/errors/either.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";

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
    return { id, name: id, enabled: true, transport: { type: "http", url }, timeoutMs: 120000, auth: { type: "none" } };
}

/** stdio 形态 fixture（归一保留、首版不可用）。 */
function stdioConfig(id: string): McpServerConfig {
    return { id, name: id, enabled: false, transport: { type: "stdio" }, timeoutMs: 1000, auth: { type: "none" } };
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

    it("T-M12: importExternal 的 bearer 明文只进 SKSP，KKV 值里不出现明文、只存 ref", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.importExternal({ mcpServers: { zhiyu: { url: "https://mcp.zhiyu.example/mcp", headers: { Authorization: "Bearer sk-secret-123" } } } }));
        const raw = deps.kkv.map.get(`${McpConfigStoreFactory.KKV_MODULE}/${McpConfigStoreFactory.KEY_SERVERS}`);
        assert.ok(typeof raw === "string");
        assert.ok(!raw.includes("sk-secret-123"), `KKV 值里出现明文：${raw}`);
        assert.equal(deps.secretStore.map.get(McpSecretRefs.bearer("zhiyu")), "sk-secret-123");
        const listed = unwrap(await store.list());
        assert.deepEqual(listed[0]?.auth, { type: "bearer", secretRef: McpSecretRefs.bearer("zhiyu") });
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

    it("KKV infra 失败沿 Result.err 接力（list / save / remove / importExternal 四入口同口径）", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        const injected = new AppError("KKV_CONFLICT", { detail: "injected infra failure" });
        deps.kkv.get = async () => Result.err(injected);
        const list = await store.list();
        assert.ok(AppErrorOps.is(unwrapErr(list), "KKV_CONFLICT"));
        const save = await store.save(httpConfig("zhiyu"));
        assert.ok(AppErrorOps.is(unwrapErr(save), "KKV_CONFLICT"));
        const remove = await store.remove("zhiyu");
        assert.ok(AppErrorOps.is(unwrapErr(remove), "KKV_CONFLICT"));
        const imported = await store.importExternal({ mcpServers: { zhiyu: { url: "https://mcp.zhiyu.example/mcp" } } });
        assert.ok(AppErrorOps.is(unwrapErr(imported), "KKV_CONFLICT"));
    });

    it("importExternal 按 id upsert 合并：现有列表保序、同 id 覆盖、新 id 追加队尾", async () => {
        const deps = makeDeps();
        const store = McpConfigStoreFactory.create(deps);
        unwrap(await store.save(httpConfig("existing")));
        const merged = unwrap(await store.importExternal({ mcpServers: { existing: { url: "https://changed.example.com/mcp" }, fresh: { type: "streamableHttp", url: "https://fresh.example.com/mcp" } } }));
        assert.deepEqual(merged.map((config) => config.id), ["existing", "fresh"]);
        assert.deepEqual(unwrap(await store.list()), merged);
        assert.deepEqual(merged[0]?.transport, { type: "http", url: "https://changed.example.com/mcp" });
        assert.deepEqual(merged[1]?.transport, { type: "http", url: "https://fresh.example.com/mcp" });
    });
});
