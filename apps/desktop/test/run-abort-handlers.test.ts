/**
 * 取消链路 IPC 测试（signal-abort-scope T-S21 / T-S15 主进程侧）：
 *
 * - `nm:run/abort`：未知 kind → `IPC_INVALID_ABORT_TARGET`；id 缺省/空串/不存在
 *   静默 ok；合法 `{kind,id}` 取消对应 key；`nm:agent/abort` 转发别名等价于
 *   `abort(ABORT_KEY.agent(sessionId))`（不带前缀的裸 key 不受影响）。
 * - `providerModels` 并发 claim → `PROVIDER_MODELS_IN_FLIGHT`；异步段 abort 后
 *   在 100ms 内以 `IPC_ABORTED` settle 且 `registry.has(key) === false`。
 * - `usageStats` 异步段同样在 100ms 内 settle 并释放登记。
 * - `doWork` 层直传已 abort 的 scope：返回 `Outcome.cancelled`（避开「未注册
 *   key 静默 no-op」这条不产生信号的路径）。
 *
 * runtime 走 module hook（与 usage-stats-ipc.test.ts 同范式）：先把
 * desktop-runtime-singleton 重定向到 run-abort-runtime-stub.mjs，再动态导入
 * handler。renderer 按钮断言属 Step 14 UI（本分片不含 renderer 文件），这里
 * 只锁 preload 白名单（IpcChannel 收敛）与主进程契约。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, describe, it } from "node:test";

import { ABORT_KEY, AbortRegistryFactory, AbortScopeFactory, type AbortScope } from "@novel-master/core/abort";
import { AppError, Result } from "@novel-master/core/errors";
import { IPC_CHANNELS, type IpcChannel } from "../shared/ipc-types.js";

register(new URL("./run-abort-runtime-hook.mjs", import.meta.url));
const { RunAbort } = await import("../src/main/ipc/handlers/run-abort.js");
const { UsageStats } = await import("../src/main/ipc/handlers/usage-stats.js");
const { ProviderModels } = await import("../src/main/ipc/handlers/provider-models.js");
const { RunScope } = await import("../src/main/ipc/run-scope.js");

type AbortRegistryLike = ReturnType<typeof AbortRegistryFactory.create>;

type StubRuntime = {
    abortRegistry: AbortRegistryLike;
    usageStats: Record<string, unknown>;
    providerModels: Record<string, unknown>;
};

const SUMMARY = {
    calls: 1,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billedInputTokens: 10,
    avgFirstTokenMs: null,
    avgTokensPerSecond: null,
};

function installRuntime(overrides: Partial<StubRuntime> = {}): StubRuntime {
    const rt: StubRuntime = { abortRegistry: AbortRegistryFactory.create(), usageStats: {}, providerModels: {}, ...overrides };
    (globalThis as unknown as { __runAbortTestRuntime?: StubRuntime }).__runAbortTestRuntime = rt;
    return rt;
}

afterEach(() => {
    delete (globalThis as unknown as { __runAbortTestRuntime?: StubRuntime }).__runAbortTestRuntime;
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function tick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function abortedScope(): AbortScope {
    const scope = AbortScopeFactory.create();
    scope.abort("user-stop");
    return scope;
}

function errorCodeOf(result: { ok: boolean; error?: { code: string } }): string | undefined {
    return result.ok ? undefined : result.error?.code;
}

describe("nm:run/abort（T-S21）", () => {
    it("preload 白名单：IpcChannel 收敛 nm:run/abort", () => {
        const channel: IpcChannel = IPC_CHANNELS.NM_RUN_ABORT;
        assert.equal(channel, "nm:run/abort");
    });

    it("未知 kind → IPC_INVALID_ABORT_TARGET（含缺省请求体）", async () => {
        installRuntime();
        const unknown = await RunAbort.abort({ kind: "nope" as never, id: "x" });
        assert.equal(unknown.ok, false);
        assert.equal(errorCodeOf(unknown), "IPC_INVALID_ABORT_TARGET");
        if (!unknown.ok) assert.equal(unknown.error.message, "无法识别的取消目标");

        const missing = await RunAbort.abort(undefined);
        assert.equal(missing.ok, false);
        assert.equal(errorCodeOf(missing), "IPC_INVALID_ABORT_TARGET");
    });

    it("id 缺省 / 空串 / 不存在：静默 ok 且不取消任何任务", async () => {
        const rt = installRuntime();
        const scope = AbortScopeFactory.create();
        rt.abortRegistry.register(ABORT_KEY.backup("r1"), scope);

        for (const req of [
            { kind: "backup" as const, id: "" },
            { kind: "backup" as const, id: "not-registered" },
        ]) {
            const res = await RunAbort.abort(req);
            assert.equal(res.ok, true);
        }
        assert.equal(scope.reason, null);
    });

    it("合法 { kind, id } 取消对应 key（backup）", async () => {
        const rt = installRuntime();
        const scope = AbortScopeFactory.create();
        rt.abortRegistry.register(ABORT_KEY.backup("r1"), scope);

        const res = await RunAbort.abort({ kind: "backup", id: "r1" });
        assert.equal(res.ok, true);
        assert.equal(scope.reason, "user-stop");
        // abort 不删登记（删除交给 finally 的所有权比对 unregister）。
        assert.equal(rt.abortRegistry.has(ABORT_KEY.backup("r1")), true);
    });

    it("六个 kind 的 key 命名空间映射一致（backup/dbmaint/stats/models/sync/compaction）", async () => {
        const rt = installRuntime();
        const cases = [
            ["backup", "x1", ABORT_KEY.backup("x1")],
            ["dbmaint", "x2", ABORT_KEY.dbMaintenance("x2")],
            ["stats", "x3", ABORT_KEY.usageStats("x3")],
            ["models", "x4", ABORT_KEY.providerModels("x4")],
            ["sync", "local", ABORT_KEY.cloudSync("local")],
            ["compaction", "x5", ABORT_KEY.compaction("x5")],
        ] as const;
        for (const [kind, id, key] of cases) {
            const scope = AbortScopeFactory.create();
            rt.abortRegistry.register(key, scope);
            const res = await RunAbort.abort({ kind, id });
            assert.equal(res.ok, true);
            assert.equal(scope.reason, "user-stop", `${kind} 应取消 ${key}`);
            rt.abortRegistry.unregister(key, scope);
        }
    });

    it("nm:agent/abort 转发别名：只取消 agent:<sessionId>，不碰裸 sessionId", async () => {
        const rt = installRuntime();
        const agentScope = AbortScopeFactory.create();
        const bareScope = AbortScopeFactory.create();
        rt.abortRegistry.register(ABORT_KEY.agent("s1"), agentScope);
        rt.abortRegistry.register("s1", bareScope);

        const res = await RunAbort.abortAlias({ sessionId: "s1" });
        assert.equal(res.ok, true);
        assert.equal(agentScope.reason, "user-stop");
        assert.equal(bareScope.reason, null);
    });
});

describe("runAbortable 边界三分派（T-S15 骨架）", () => {
    it("completed → ipcOk；failed → formatIpcError；cancelled / replaced → IPC_ABORTED；finally 释放登记", async () => {
        const registry = AbortRegistryFactory.create();

        const completed = await RunScope.abortable({ registry, key: "k-completed" }, async () => ({ kind: "completed", value: 42 }));
        assert.deepEqual(completed, { ok: true, data: 42 });
        assert.equal(registry.has("k-completed"), false);

        const failed = await RunScope.abortable({ registry, key: "k-failed" }, async () => ({
            kind: "failed",
            error: new AppError("INFRA_UNEXPECTED_ERROR", { detail: "业务失败" }),
        }));
        assert.equal(failed.ok, false);
        assert.equal(errorCodeOf(failed), "INFRA_UNEXPECTED_ERROR");
        assert.equal(registry.has("k-failed"), false);

        const cancelled = await RunScope.abortable({ registry, key: "k-cancelled" }, async () => ({ kind: "cancelled", reason: "timeout" }));
        assert.equal(cancelled.ok, false);
        assert.equal(errorCodeOf(cancelled), "IPC_ABORTED");
        assert.equal(registry.has("k-cancelled"), false);

        const replaced = await RunScope.abortable({ registry, key: "k-replaced" }, async () => ({ kind: "replaced" }));
        assert.equal(replaced.ok, false);
        assert.equal(errorCodeOf(replaced), "IPC_ABORTED");
        assert.equal(registry.has("k-replaced"), false);
    });

    it("key 为 null（runId 缺省）：不触碰 registry，仍按 deadline 建 scope", async () => {
        const registry = AbortRegistryFactory.create();
        const result = await RunScope.abortable({ registry, key: null, timeoutMs: 60_000 }, async (scope) => {
            assert.ok(scope.deadlineAt != null);
            return { kind: "completed", value: "ok" };
        });
        assert.deepEqual(result, { ok: true, data: "ok" });
        assert.equal([...registry.entries()].length, 0);
    });
});

describe("providerModels 取消与并发（T-S15 / T-S21）", () => {
    it("同一 providerId 并发拉取 → PROVIDER_MODELS_IN_FLIGHT；abort 后 100ms 内 IPC_ABORTED 并释放登记", async () => {
        const gate = deferred<ReturnType<typeof Result.ok<undefined>>>();
        const rt = installRuntime({ providerModels: { fetch: () => gate.promise } });

        const pending = ProviderModels.fetch({ providerId: "p1" });
        await tick();
        assert.equal(rt.abortRegistry.has(ABORT_KEY.providerModels("p1")), true);

        const conflict = await ProviderModels.fetch({ providerId: "p1" });
        assert.equal(conflict.ok, false);
        assert.equal(errorCodeOf(conflict), "PROVIDER_MODELS_IN_FLIGHT");

        await RunAbort.abort({ kind: "models", id: "p1" });
        const abortAt = Date.now();
        gate.resolve(Result.ok(undefined));
        const settled = await pending;
        assert.ok(Date.now() - abortAt < 100, "abort 后应在 100ms 内 settle");
        assert.equal(settled.ok, false);
        assert.equal(errorCodeOf(settled), "IPC_ABORTED");
        assert.equal(rt.abortRegistry.has(ABORT_KEY.providerModels("p1")), false);
    });

    it("doWork 直传已 abort 的 scope → Outcome.cancelled（入口检查点）", async () => {
        const rt = installRuntime({ providerModels: { fetch: () => Promise.resolve(Result.ok(undefined)) } });
        const outcome = await ProviderModels.doFetch(rt as never, "p1", abortedScope());
        assert.deepEqual(outcome, { kind: "cancelled", reason: "user-stop" });
    });
});

describe("usageStats 取消（T-S15）", () => {
    it("异步段 abort → 100ms 内 IPC_ABORTED，registry 登记释放", async () => {
        const gate = deferred<ReturnType<typeof Result.ok<typeof SUMMARY>>>();
        const rt = installRuntime({ usageStats: { getSummary: () => gate.promise } });

        const pending = UsageStats.handleQuery({ kind: "summary", filter: {}, runId: "u1" });
        await tick();
        assert.equal(rt.abortRegistry.has(ABORT_KEY.usageStats("u1")), true);

        await RunAbort.abort({ kind: "stats", id: "u1" });
        const abortAt = Date.now();
        gate.resolve(Result.ok(SUMMARY));
        const settled = await pending;
        assert.ok(Date.now() - abortAt < 100, "abort 后应在 100ms 内 settle");
        assert.equal(settled.ok, false);
        assert.equal(errorCodeOf(settled), "IPC_ABORTED");
        assert.equal(rt.abortRegistry.has(ABORT_KEY.usageStats("u1")), false);
    });

    it("doWork 直传已 abort 的 scope → Outcome.cancelled（入口检查点）", async () => {
        const rt = installRuntime({ usageStats: { getSummary: () => Promise.resolve(Result.ok(SUMMARY)) } });
        const outcome = await UsageStats.query(rt as never, { kind: "summary", filter: {} }, abortedScope());
        assert.deepEqual(outcome, { kind: "cancelled", reason: "user-stop" });
    });
});
