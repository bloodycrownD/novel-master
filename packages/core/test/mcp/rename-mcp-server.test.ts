import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unwrap, unwrapErr } from "../helpers/result-unwrap.js";
import { McpServerRename } from "../../src/domain/mcp/logic/rename-mcp-server.js";
import { McpConfigStoreFactory, type McpConfigStoreDeps } from "../../src/infra/mcp/impl/mcp-config-store.js";
import type { McpServerConfig } from "../../src/domain/mcp/model/mcp-server-config.js";
import { AppError, AppErrorOps } from "../../src/errors/app-error.js";
import { Result } from "../../src/errors/either.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { KkvService } from "../../src/service/kkv/kkv.port.js";

/**
 * McpServerRename.withAfterStep（换 ID 编排，rewrite-mcp-tool-references 精简后
 * 的接替用例）：锁「rename → afterRename」的顺序与回滚链——afterRename 失败
 * 按旧配置改回旧 ID，不留「配置已改名、密钥写了一半」的状态。
 *
 * @module test/mcp/rename-mcp-server.test
 */

/** 内存 fake SecretStore：明文落 Map。 */
function fakeSecretStore(): SecretStore & { readonly map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        async has(ref) { return map.has(ref); },
        async get(ref) { return map.get(ref) ?? null; },
        async set(ref, plain) { map.set(ref, plain); },
        async delete(ref) { return map.delete(ref); },
    };
}

/** 内存 fake KkvService：缺 key 返回 KKV_NOT_FOUND（与 DefaultKkvService 同语义）。 */
function fakeKkv(): KkvService & { readonly map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        async listKeys() { return [...map.keys()]; },
        async get(module, key) {
            const value = map.get(`${module}/${key}`);
            if (value == null) return Result.err(new AppError("KKV_NOT_FOUND", { detail: `KKV key not found: ${module}/${key}` }));
            return Result.ok(value);
        },
        async set(module, key, value) { map.set(`${module}/${key}`, value); return Result.ok(undefined); },
        async delete(module, key) {
            const composite = `${module}/${key}`;
            if (!map.has(composite)) return Result.err(new AppError("KKV_NOT_FOUND", { detail: `KKV key not found: ${module}/${key}` }));
            map.delete(composite);
            return Result.ok(undefined);
        },
    };
}

function makeDeps(): McpConfigStoreDeps {
    return { kkv: fakeKkv(), secretStore: fakeSecretStore() };
}

/** http 形态 fixture。 */
function httpConfig(id: string, url = `https://${id}.example.com/mcp`): McpServerConfig {
    return { id, description: "", enabled: true, transport: { type: "http", url }, timeoutMs: 120000, auth: { type: "none" } };
}

describe("McpServerRename.withAfterStep", () => {
    it("rename 成功后执行 afterRename（编排顺序：先改名后收尾）", async () => {
        const store = McpConfigStoreFactory.create(makeDeps());
        unwrap(await store.save(httpConfig("old")));
        const order: string[] = [];
        const outcome = unwrap(await McpServerRename.withAfterStep({ configStore: store }, "old", httpConfig("new"), async () => {
            order.push("afterRename");
        }));
        assert.equal(outcome.oauthMigrated, true);
        assert.deepEqual(unwrap(await store.list()), [httpConfig("new")]);
        assert.deepEqual(order, ["afterRename"]);
    });

    it("afterRename 失败 → 按旧配置改回旧 ID（回滚链），错因交回不吞", async () => {
        const store = McpConfigStoreFactory.create(makeDeps());
        unwrap(await store.save(httpConfig("old")));
        const failed = unwrapErr(await McpServerRename.withAfterStep({ configStore: store }, "old", httpConfig("new"), async () => {
            throw new Error("bearer write failed");
        }));
        assert.ok(AppErrorOps.is(failed, "INFRA_UNEXPECTED_ERROR"));
        assert.ok(failed.message.includes("bearer write failed"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("old")]);
    });

    it("rename 失败（新 ID 撞别的 server）→ 配置原样保留，直接交回失败", async () => {
        const store = McpConfigStoreFactory.create(makeDeps());
        unwrap(await store.save(httpConfig("old")));
        unwrap(await store.save(httpConfig("taken")));
        const clash = unwrapErr(await McpServerRename.withAfterStep({ configStore: store }, "old", httpConfig("taken")));
        assert.ok(AppErrorOps.is(clash, "INFRA_VALIDATION_FAILED"));
        assert.deepEqual(unwrap(await store.list()), [httpConfig("old"), httpConfig("taken")]);
    });

    it("oldId === config.id 时只是普通保存（不走 rename 编排）", async () => {
        const store = McpConfigStoreFactory.create(makeDeps());
        unwrap(await store.save(httpConfig("same")));
        const outcome = unwrap(await McpServerRename.withAfterStep({ configStore: store }, "same", httpConfig("same", "https://moved.example.com/mcp")));
        assert.equal(outcome.oauthMigrated, true);
        assert.deepEqual(unwrap(await store.list()), [httpConfig("same", "https://moved.example.com/mcp")]);
    });
});
