/**
 * Desktop 云同步 service 单例的换代行为（S-CS-02）。
 *
 * 病症：模块级 `let service` 只在首次 `CloudSyncService.get()` 时构造，
 * 之后每次调用虽然都 `await DesktopRuntimeSingleton.get()` 却不更新 ⇒ rebootstrap 之后
 * 拿到的是「新 runtime 外面套着旧 service」，旧 service 的 configStore 绑旧
 * kkv ⇒ 面板全线 CONNECTION_CLOSED，直到重启应用。
 *
 * 两条 rebootstrap 生产路径都要覆盖：pull 之后（handlers/cloud-sync.ts）与
 * 本地备份导入之后（handlers/backup.ts）。
 *
 * @module test/cloud-sync-service-lifecycle
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CloudSyncService } from "../src/main/services/cloud-sync.service.js";
import { CloudSync } from "../src/main/ipc/handlers/cloud-sync.js";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
    setupDesktopDbTestEnv,
    teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("云同步 service 单例随 runtime 换代重建 (S-CS-02)", () => {
    let tempDir: string;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-cloud-sync-lifecycle-"));
        CloudSyncService.resetForTest();
    });

    after(async () => {
        CloudSyncService.resetForTest();
        await teardownDesktopDbTestEnv(tempDir);
    });

    it("rebootstrap 后 getDesktopCloudSyncService 返回新实例", async () => {
        const s1R = await CloudSyncService.get();
        if (!s1R.ok) throw s1R.error;
        const s1 = s1R.value;
        await DesktopRuntimeSingleton.rebootstrap();
        const s2R = await CloudSyncService.get();
        if (!s2R.ok) throw s2R.error;
        const s2 = s2R.value;
        assert.notEqual(
            s1,
            s2,
            "runtime 换代后单例必须换代（旧代码只在新 runtime 外面套旧 service）",
        );
    });

    it("同一 runtime 连续两次 getDesktopCloudSyncService 返回同一实例", async () => {
        // 守住「不每次都重建」这条回归：换代判据是 runtime 身份，不是调用次数。
        const s1R = await CloudSyncService.get();
        if (!s1R.ok) throw s1R.error;
        const s1 = s1R.value;
        const s2R = await CloudSyncService.get();
        if (!s2R.ok) throw s2R.error;
        const s2 = s2R.value;
        assert.equal(s1, s2, "同一代 runtime 不得反复重建 service");
    });

    it("rebootstrap 后 getLocalStatus 不抛 CONNECTION_CLOSED", async () => {
        await DesktopRuntimeSingleton.rebootstrap();
        const result = await CloudSync.getConfig();
        assert.equal(
            result.ok,
            true,
            `换代后云同步 handler 必须仍可用: ${JSON.stringify(result)}`,
        );
    });

    it("本地备份导入（handleBackupImport 走的路径）之后云同步 handler 仍可用", async () => {
        // handlers/backup.ts 的 rebootstrap 是 S-CS-02 的**第二条触发面**，
        // 与用户是否碰过云同步完全无关——「我没碰云同步，云同步怎么坏了」就出自这里。
        // 这里不经过文件对话框（那会拉起 electron 壳），只复现它的两条语句：
        // 「导入 → rebootstrapDesktopRuntime()」。
        await DesktopRuntimeSingleton.rebootstrap();
        // 先把 service 缓存住，确保后面拿到的是「rebootstrap 之前」那一份。
        const beforeR = await CloudSyncService.get();
        if (!beforeR.ok) throw beforeR.error;
        const before = beforeR.value;

        const { DbBackupService } =
            await import("../src/main/services/db-backup.service.js");
        const { join } = await import("node:path");
        const runtimeR = await DesktopRuntimeSingleton.get();
        if (!runtimeR.ok) throw runtimeR.error;
        const runtime = runtimeR.value;
        const backupPath = join(tempDir, "lifecycle-backup.nmbackup");
        await DbBackupService.exportToPath(runtime, backupPath);
        await DbBackupService.importFromPath(backupPath);
        await DesktopRuntimeSingleton.rebootstrap();

        const s2R = await CloudSyncService.get();
        if (!s2R.ok) throw s2R.error;
        const s2 = s2R.value;
        assert.notEqual(s2, before, "本地备份导入换代 runtime 后单例必须换代");
        const result = await CloudSync.getConfig();
        assert.equal(
            result.ok,
            true,
            `本地备份导入之后云同步 handler 必须仍可用: ${JSON.stringify(result)}`,
        );
    });
});
