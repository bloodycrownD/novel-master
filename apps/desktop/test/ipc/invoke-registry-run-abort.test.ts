/**
 * Renderer IPC 层取消契约（signal-abort-scope T-S21 / T-S22）。
 *
 * 覆盖 Step 14 的 IPC 接线部分：
 * - 四个长任务（backup export / import、db-maintenance、cloud-sync push）把 renderer
 *   生成的 runId 原样写进请求体；缺省请求体保持 undefined（既有轻调用零改动）。
 * - `nm:run/abort` 包装把 `{ kind, id }` 原样写进请求体。
 * - `IPC_ABORTED` 被判为取消终态（`isIpcAborted`），其它错误码不误判；长任务结果
 *   原样上抛、不改写错误文本。
 *
 * mock 的是 client.ts 注入 `createInvokeClient` 的那层 bridge（invoke 函数），
 * 与 renderer 运行期同一条入口（renderer/ipc/client.ts:26）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IPC_CHANNELS, type IpcResult } from "../../shared/ipc-types.js";
import { createInvokeClient, isIpcAborted } from "../../renderer/ipc/invoke-registry.js";

type InvokeCall = { readonly channel: string; readonly arg: unknown };

/** mock bridge：记录每次 invoke 的 channel 与请求体，按固定结果 resolve。 */
function makeMockClient(result: IpcResult<unknown> = { ok: true, data: null }) {
    const calls: InvokeCall[] = [];
    const client = createInvokeClient(<T>(channel: string, arg?: unknown): Promise<T> => {
        calls.push({ channel, arg });
        return Promise.resolve(result as unknown as T);
    });
    return { client, calls };
}

describe("长任务 IPC：runId 透传（T-S21）", () => {
    it("backup export / backup import 请求体带 runId", async () => {
        const { client, calls } = makeMockClient();
        await client.ipcBackupExport({ runId: "run-export-1" });
        await client.ipcBackupImport({ runId: "run-import-1" });
        assert.deepEqual(calls, [
            { channel: IPC_CHANNELS.BACKUP_EXPORT, arg: { runId: "run-export-1" } },
            { channel: IPC_CHANNELS.BACKUP_IMPORT, arg: { runId: "run-import-1" } },
        ]);
    });

    it("db-maintenance 请求体带 runId", async () => {
        const { client, calls } = makeMockClient();
        await client.ipcDbMaintenance({ runId: "run-maint-1" });
        assert.deepEqual(calls, [
            { channel: IPC_CHANNELS.DB_MAINTENANCE, arg: { runId: "run-maint-1" } },
        ]);
    });

    it("cloud-sync push 透传 runId 并叠加 forceOverwriteRemote", async () => {
        const { client, calls } = makeMockClient();
        await client.ipcCloudSyncPush({ runId: "run-push-1", forceOverwriteRemote: true });
        assert.deepEqual(calls, [
            {
                channel: IPC_CHANNELS.CLOUD_SYNC_PUSH,
                arg: { runId: "run-push-1", forceOverwriteRemote: true },
            },
        ]);
    });

    it("缺省请求体保持 undefined（既有轻调用零改动）", async () => {
        const { client, calls } = makeMockClient();
        await client.ipcBackupExport();
        await client.ipcBackupImport();
        await client.ipcDbMaintenance();
        await client.ipcCloudSyncPush();
        assert.deepEqual(
            calls.map((call) => call.arg),
            [undefined, undefined, undefined, undefined],
        );
    });
});

describe("nm:run/abort renderer 包装（T-S21）", () => {
    it("把 { kind, id } 原样写进 nm:run/abort", async () => {
        const { client, calls } = makeMockClient();
        await client.ipcRunAbort({ kind: "backup", id: "run-export-1" });
        await client.ipcRunAbort({ kind: "sync", id: "local" });
        assert.deepEqual(calls, [
            { channel: IPC_CHANNELS.NM_RUN_ABORT, arg: { kind: "backup", id: "run-export-1" } },
            { channel: IPC_CHANNELS.NM_RUN_ABORT, arg: { kind: "sync", id: "local" } },
        ]);
        assert.equal(IPC_CHANNELS.NM_RUN_ABORT, "nm:run/abort");
    });
});

describe("IPC_ABORTED 静默处理（T-S22）", () => {
    it("IPC_ABORTED 判为取消终态", () => {
        assert.equal(
            isIpcAborted({ ok: false, error: { code: "IPC_ABORTED", message: "已取消" } }),
            true,
        );
    });

    it("成功与其它错误码不误判为取消", () => {
        assert.equal(isIpcAborted({ ok: true, data: null }), false);
        assert.equal(
            isIpcAborted({
                ok: false,
                error: { code: "CLOUD_SYNC_NEED_PULL_FIRST", message: "需先拉取云端数据" },
            }),
            false,
        );
    });

    it("长任务把取消结果原样交给统一判定，不改写错误文本", async () => {
        const { client } = makeMockClient({
            ok: false,
            error: { code: "IPC_ABORTED", message: "已取消" },
        });
        const res = await client.ipcBackupExport({ runId: "run-export-1" });
        assert.equal(isIpcAborted(res), true);
        if (!res.ok) assert.equal(res.error.message, "已取消");
    });
});
