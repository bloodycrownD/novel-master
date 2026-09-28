/**
 * Desktop 备份底层函数的 busy 互斥接线用例（ic-fix-spec ic-20 desktop 验收）。
 *
 * - 底层 export/import 三函数入口 acquire、出口 finally release 自平衡：
 *   云同步三直调路径（绕过上层备份流程）「期间 true、结束后 false」。
 * - 最外层流程（备份导入 / 云同步 pull）另持令牌、在 rebootstrap 完成之后
 *   release——含「库文件已替换、连接仍处重建窗口」的完整互斥。
 *
 * @module test/db-backup-busy
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  exportDatabaseBackupToPath,
  importDatabaseBackupFromBytes,
  importDatabaseBackupFromPath,
} from "../src/main/services/db-backup.service.js";
import {
  acquireDesktopDbMaintenanceBusy,
  isDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
  resetDesktopDbMaintenanceBusyForTest,
} from "../src/main/services/db-maintenance-busy.js";
import {
  getDesktopRuntime,
  rebootstrapDesktopRuntime,
} from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("db-backup 底层函数 busy 互斥（ic-20 desktop）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-backup-busy-"));
    resetDesktopDbMaintenanceBusyForTest();
  });

  after(async () => {
    resetDesktopDbMaintenanceBusyForTest();
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("直接调 exportDatabaseBackupToPath 期间 busy=true、结束后 false", async () => {
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      execute: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalExecute = conn.execute.bind(conn);
    let busyAtCheckpoint: boolean | undefined;
    conn.execute = (sql: string, params?: unknown) => {
      // checkpoint 是导出链路的第一步，执行瞬间必然已过底层 acquire。
      if (typeof sql === "string" && sql.includes("wal_checkpoint")) {
        busyAtCheckpoint = isDesktopDbMaintenanceBusy();
      }
      return originalExecute(sql, params);
    };
    try {
      await exportDatabaseBackupToPath(runtime, join(tempDir, "ic20-export.db"));
    } finally {
      conn.execute = originalExecute;
    }
    assert.equal(busyAtCheckpoint, true, "导出（checkpoint）瞬间 busy 必须为 true");
    assert.equal(isDesktopDbMaintenanceBusy(), false, "结束后必须复位");
  });

  it("直接调 importDatabaseBackupFromBytes 期间 busy=true、结束后 false", async () => {
    // 用上一用例导出的真实备份字节回灌：闭环无损（同一测试库）。
    const bytes = new Uint8Array(await readFile(join(tempDir, "ic20-export.db")));
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    let busyAtDump: boolean | undefined;
    conn.query = (sql: string, params?: unknown) => {
      // dumpProviderTableSnapshot 的 `SELECT * FROM <provider 表>` 是导入
      // 链路的第一批查询，执行瞬间必然已过底层 acquire。
      if (
        busyAtDump === undefined &&
        typeof sql === "string" &&
        sql.startsWith("SELECT * FROM ")
      ) {
        busyAtDump = isDesktopDbMaintenanceBusy();
      }
      return originalQuery(sql, params);
    };
    try {
      await importDatabaseBackupFromBytes(bytes);
    } finally {
      conn.query = originalQuery;
    }
    assert.equal(busyAtDump, true, "导入（dump 快照）瞬间 busy 必须为 true");
    assert.equal(isDesktopDbMaintenanceBusy(), false, "结束后必须复位");
  });

  it("最外层流程令牌：rebootstrap 完成之前 busy=true、外层 release 后 false（含重建窗口完整互斥）", async () => {
    // 模拟 handleBackupImport / handleCloudSyncPull 的令牌时序（r3 定稿）：
    // 外层进入时 acquire，底层 import 自平衡（期间计数 2、结束回到 1，
    // 不互相提前清位），rebootstrap 完成之后才 release。
    const runtime = await getDesktopRuntime();
    await exportDatabaseBackupToPath(runtime, join(tempDir, "ic20-roundtrip.db"));

    acquireDesktopDbMaintenanceBusy();
    try {
      await importDatabaseBackupFromPath(join(tempDir, "ic20-roundtrip.db"));
      // 底层已 release 自身令牌，但外层仍持有：rebootstrap 完成之前必须
      // 保持 busy（「库文件已替换、连接仍处重建窗口」是最危险段）。
      assert.equal(
        isDesktopDbMaintenanceBusy(),
        true,
        "rebootstrap 完成之前 busy 必须为 true（重建窗口互斥）",
      );
      await rebootstrapDesktopRuntime();
    } finally {
      releaseDesktopDbMaintenanceBusy();
    }
    assert.equal(
      isDesktopDbMaintenanceBusy(),
      false,
      "外层 release 后必须复位（计数/令牌配对，无提前清位）",
    );
  });
});
