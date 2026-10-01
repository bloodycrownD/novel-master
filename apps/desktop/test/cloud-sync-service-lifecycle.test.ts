/**
 * Desktop 云同步 service 单例的换代行为（S-CS-02）。
 *
 * 病症：模块级 `let service` 只在首次 `getDesktopCloudSyncService()` 时构造，
 * 之后每次调用虽然都 `await getDesktopRuntime()` 却不更新 ⇒ rebootstrap 之后
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
import {
  getDesktopCloudSyncService,
  resetDesktopCloudSyncServiceForTest,
} from "../src/main/services/cloud-sync.service.js";
import { handleCloudSyncGetConfig } from "../src/main/ipc/handlers/cloud-sync.js";
import {
  getDesktopRuntime,
  rebootstrapDesktopRuntime,
} from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("云同步 service 单例随 runtime 换代重建 (S-CS-02)", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-cloud-sync-lifecycle-"));
    resetDesktopCloudSyncServiceForTest();
  });

  after(async () => {
    resetDesktopCloudSyncServiceForTest();
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("rebootstrap 后 getDesktopCloudSyncService 返回新实例", async () => {
    const s1 = await getDesktopCloudSyncService();
    await rebootstrapDesktopRuntime();
    const s2 = await getDesktopCloudSyncService();
    assert.notEqual(
      s1,
      s2,
      "runtime 换代后单例必须换代（旧代码只在新 runtime 外面套旧 service）",
    );
  });

  it("同一 runtime 连续两次 getDesktopCloudSyncService 返回同一实例", async () => {
    // 守住「不每次都重建」这条回归：换代判据是 runtime 身份，不是调用次数。
    const s1 = await getDesktopCloudSyncService();
    const s2 = await getDesktopCloudSyncService();
    assert.equal(s1, s2, "同一代 runtime 不得反复重建 service");
  });

  it("rebootstrap 后 getLocalStatus 不抛 CONNECTION_CLOSED", async () => {
    await rebootstrapDesktopRuntime();
    const result = await handleCloudSyncGetConfig();
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
    await rebootstrapDesktopRuntime();
    // 先把 service 缓存住，确保后面拿到的是「rebootstrap 之前」那一份。
    const before = await getDesktopCloudSyncService();

    const { exportDatabaseBackupToPath, importDatabaseBackupFromPath } =
      await import("../src/main/services/db-backup.service.js");
    const { join } = await import("node:path");
    const runtime = await getDesktopRuntime();
    const backupPath = join(tempDir, "lifecycle-backup.nmbackup");
    await exportDatabaseBackupToPath(runtime, backupPath);
    await importDatabaseBackupFromPath(backupPath);
    await rebootstrapDesktopRuntime();

    const s2 = await getDesktopCloudSyncService();
    assert.notEqual(s2, before, "本地备份导入换代 runtime 后单例必须换代");
    const result = await handleCloudSyncGetConfig();
    assert.equal(
      result.ok,
      true,
      `本地备份导入之后云同步 handler 必须仍可用: ${JSON.stringify(result)}`,
    );
  });
});
