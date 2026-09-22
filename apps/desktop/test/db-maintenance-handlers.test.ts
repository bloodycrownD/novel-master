import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  resetDesktopCloudSyncServiceForTest,
  setDesktopCloudSyncBusyForTest,
} from "../src/main/services/cloud-sync.service.js";
import {
  isDesktopDbMaintenanceBusy,
  resetDesktopDbMaintenanceBusyForTest,
  runDbMaintenance,
} from "../src/main/services/db-maintenance.service.js";
import {
  handleDbMaintenance,
  handleDbStats,
} from "../src/main/ipc/handlers/db-maintenance.js";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
} from "../src/main/runtime/agent-activity.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("db-maintenance ipc handlers", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-db-maintenance-"));
    resetDesktopCloudSyncServiceForTest();
    resetDesktopDbMaintenanceBusyForTest();
  });

  after(async () => {
    resetDesktopCloudSyncServiceForTest();
    resetDesktopDbMaintenanceBusyForTest();
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-DMD1：Agent 运行中或云同步进行中时返回中文错误", async () => {
    incrementDesktopAgentActive();
    try {
      const res = await handleDbMaintenance();
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.message, "Agent 运行中，请稍后再操作");
      }
    } finally {
      decrementDesktopAgentActive();
    }

    setDesktopCloudSyncBusyForTest(true);
    try {
      const res = await handleDbMaintenance();
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.message, "云同步进行中，请稍后再操作");
      }
    } finally {
      setDesktopCloudSyncBusyForTest(false);
    }

    assert.equal(isDesktopDbMaintenanceBusy(), false);
  });

  it("T-DMD2：正常路径返回前后体积且执行窗口内 maintenanceBusy 为真", async () => {
    // stats 顺带验证：fileBytes 来自 stat，reclaimableBytes 来自 PRAGMA 口径
    const stats = await handleDbStats();
    assert.equal(stats.ok, true);
    if (stats.ok) {
      assert.ok(stats.data.fileBytes > 0);
      assert.ok(stats.data.reclaimableBytes >= 0);
    }

    // busy 窗口断言不能靠事件循环插入（setImmediate/轮询）：better-sqlite3
    // 的同步 VACUUM 会冻住 main 事件循环，任何回调都要等 busy 复位后才能
    // 跑——所以在 conn.execute 上装探针，在 VACUUM 语句执行的一刻采样。
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      execute: (sql: string) => Promise<unknown>;
    };
    const originalExecute = conn.execute.bind(conn);
    let busyAtVacuum: boolean | undefined;
    conn.execute = async (sql: string) => {
      if (sql.includes("VACUUM")) {
        busyAtVacuum = isDesktopDbMaintenanceBusy();
      }
      return originalExecute(sql);
    };
    try {
      const res = await handleDbMaintenance();
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.ok(res.data.beforeBytes > 0);
        assert.ok(res.data.afterBytes > 0);
        // VACUUM 只会收缩或持平，文件不应变大
        assert.ok(res.data.afterBytes <= res.data.beforeBytes);
      }
    } finally {
      conn.execute = originalExecute;
    }
    assert.equal(busyAtVacuum, true);
    assert.equal(isDesktopDbMaintenanceBusy(), false);
  });

  it("T-DMD3：维护链路抛错时消息透传且 maintenanceBusy 复位", async () => {
    // 事务内 VACUUM 被 SQLite 拒绝（core 链路真实抛错点），
    // 用来构造 runDatabaseMaintenance 失败路径。
    const runtime = await getDesktopRuntime();
    await runtime.conn.execute("BEGIN");

    const pending = handleDbMaintenance();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(isDesktopDbMaintenanceBusy(), true);
    const res = await pending;
    await runtime.conn.execute("ROLLBACK");

    assert.equal(res.ok, false);
    assert.equal(isDesktopDbMaintenanceBusy(), false);
    if (!res.ok) {
      assert.ok(res.error.message.length > 0);
    }

    // 透传口径：同一构造下直调 service 抛出的原始 message 与 handler
    // 返回的 error.message 一致（formatIpcError 不改写文案）
    await runtime.conn.execute("BEGIN");
    let rawMessage = "";
    try {
      await runDbMaintenance();
    } catch (err) {
      rawMessage = err instanceof Error ? err.message : String(err);
    }
    await runtime.conn.execute("ROLLBACK");
    assert.ok(rawMessage.length > 0);
    if (!res.ok) {
      assert.equal(res.error.message, rawMessage);
    }
  });
});
