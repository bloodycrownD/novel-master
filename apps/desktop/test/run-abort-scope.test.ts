/**
 * 取消链路 doWork 层测试（signal-abort-scope T-S15 的「入口前已 abort」形态）：
 * 直传已 abort 的 scope，六类 handler 的 doWork 必须返回 `Outcome.cancelled`，
 * **不去碰**服务层副作用（对话框 / 备份 / VACUUM / 云同步 / 压缩）。
 *
 * 这组用例避开「registry 未注册 key → abort 静默 no-op」这条不产生信号的路径：
 * `nm:run/abort` 在任务登记前到达时本就无事可做，T-S15 要求的「入口前已 abort」
 * 必须在 doWork 层构造。
 *
 * 不可中断窗口的例外（backup import / db-maintenance / cloud-sync 尾段）不在这里
 * 断言 IPC_ABORTED——它们按自然终态 settle，见 spec T-S15 例外条款。
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ABORT_KEY, AbortScopeFactory, type AbortScope } from "@novel-master/core/abort";
import { Backup } from "../src/main/ipc/handlers/backup.js";
import { CloudSync } from "../src/main/ipc/handlers/cloud-sync.js";
import { CompactionIpc } from "../src/main/ipc/handlers/compaction.js";
import { DbMaintenance } from "../src/main/ipc/handlers/db-maintenance.js";
import { DbMaintenanceService } from "../src/main/services/db-maintenance.service.js";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../src/main/runtime/types.js";
import { setupDesktopDbTestEnv, teardownDesktopDbTestEnv } from "./desktop-db-test-env.js";

function abortedScope(): AbortScope {
    const scope = AbortScopeFactory.create();
    scope.abort("user-stop");
    return scope;
}

const CANCELLED = { kind: "cancelled", reason: "user-stop" } as const;

describe("六类长任务 doWork 的入口检查点（T-S15）", () => {
    let tempDir: string;
    let rt: DesktopNovelMasterRuntime;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-run-abort-"));
        const built = await DesktopRuntimeSingleton.get();
        if (!built.ok) throw built.error;
        rt = built.value;
    });

    after(async () => {
        await teardownDesktopDbTestEnv(tempDir);
    });

    it("backup export / import：已 abort 时不进入拷贝", async () => {
        // export 的 scope 在保存对话框 resolve 后才创建；doWork 层因此只覆盖
        // 「对话框已选路径、copy 前已 abort」这一段，目标路径不会被写入。
        assert.deepEqual(await Backup.export(rt, join(tempDir, "abort-export.db"), abortedScope()), CANCELLED);
        assert.deepEqual(await Backup.import(abortedScope()), CANCELLED);
    });

    it("db-maintenance：已 abort 时不进入 VACUUM 链路", async () => {
        assert.deepEqual(await DbMaintenanceService.run({ checkpoint: () => abortedScope().checkpoint() }), CANCELLED);
    });

    it("db-maintenance：正常路径结束后释放 registry 登记", async () => {
        const key = ABORT_KEY.dbMaintenance("m1");
        const result = await DbMaintenance.handle({ runId: "m1" });
        assert.equal(result.ok, true, result.ok ? "" : result.error.message);
        assert.equal(rt.abortRegistry.has(key), false);
    });

    it("cloud-sync pull / push：已 abort 时不进入同步与换库窗口", async () => {
        assert.deepEqual(await CloudSync.doPull(abortedScope()), CANCELLED);
        assert.deepEqual(await CloudSync.doPush(undefined, abortedScope()), CANCELLED);
    });

    it("compaction：已 abort 时不进入 hide / KKV 清理", async () => {
        const outcome = await CompactionIpc.manual(rt, { projectId: "project-1", sessionId: "session-1" }, abortedScope());
        assert.deepEqual(outcome, CANCELLED);
    });
});
