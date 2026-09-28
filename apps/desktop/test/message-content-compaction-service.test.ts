/**
 * Desktop 消息正文压缩调度服务接线用例（ic-fix-spec ic-01c / ic-02 与
 * cr-fix-spec cr-03 的 compaction 侧验收）。
 *
 * - cr-03/ic-01c：core 收尾维护段（VACUUM）执行瞬间 busy=true、结束复位；
 *   VACUUM 抛错（afterMaintenance 的 finally 语义）也必须复位。
 * - ic-02：轮内「connection is not open」不算失败收手——退避后下一轮
 *   重取 runtime 重挂继续搬运（旧实现整循环一个 try、catch 即永久退出）。
 *
 * @module test/message-content-compaction-service
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getMessageCompactionStatus } from "@novel-master/core";
import { runDesktopMessageContentCompactionLoop } from "../src/main/services/message-content-compaction.service.js";
import { isDesktopDbMaintenanceBusy } from "../src/main/services/db-maintenance-busy.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("desktop 消息正文压缩调度服务（cr-03 / ic-02）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-compaction-svc-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("cr-03/ic-01c：自动收尾维护段 VACUUM 瞬间 busy=true；VACUUM 抛错后 busy 仍复位（finally 语义）", async () => {
    const runtime = await getDesktopRuntime();
    // 空库：谓词空 → 置完成标记 → 触发维护段（本文件首个真跑维护的用例）。
    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
    };
    const originalExecute = conn.execute.bind(conn);
    let busyAtVacuum: boolean | undefined;
    // 探针必须透传其余实参（KKV 置标记等带参语句），否则会以
    // 「Too few parameter」打爆主流程，维护段根本走不到 VACUUM。
    conn.execute = async (sql: string, ...rest: unknown[]) => {
      if (sql.includes("VACUUM")) {
        busyAtVacuum = isDesktopDbMaintenanceBusy();
        // 构造 VACUUM 抛错（磁盘满/库被锁的真实失败形态）：
        // 证 afterMaintenance 的 finally 语义——抛错也必须复位 busy。
        throw new Error("注入：VACUUM 失败（模拟磁盘满）");
      }
      return originalExecute(sql, ...rest);
    };
    try {
      // 空库首轮即完成并进维护段；VACUUM 抛错由 core 吞掉只 warn。
      await runDesktopMessageContentCompactionLoop();
    } finally {
      conn.execute = originalExecute;
    }
    assert.equal(busyAtVacuum, true, "VACUUM 执行瞬间 busy 必须为 true");
    assert.equal(
      isDesktopDbMaintenanceBusy(),
      false,
      "VACUUM 抛错后 busy 必须复位（afterMaintenance 的 finally 语义）",
    );
    const status = await getMessageCompactionStatus(runtime.conn);
    assert.equal(status.done, true, "维护失败不影响搬运完成态");
  });

  it("ic-02：轮内连接被关（not open）退避重挂，不永久退出", async () => {
    const runtime = await getDesktopRuntime();
    // 清完成标记与维护兜底标记：让压缩任务真发谓词分批 SELECT。
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module = 'nm-message-content'",
    );
    // 造一条未压缩明文行（谓词命中）：空库的「谓词空=等价完成」会让
    // done 断言恒真（ic-09 同族坑）——有活干才能区分「重挂后收敛」与
    // 「catch 即 return 的永久退出」。
    await runtime.conn.execute(
      "INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms, hidden) VALUES (?, ?, ?, 'user', ?, ?, 0)",
      [
        "ic02-msg-1",
        "ic02-session",
        1,
        JSON.stringify([{ type: "text", text: "ic-02 重挂夹具" }]),
        Date.now(),
      ],
    );

    const conn = runtime.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    let injected = false;
    conn.query = (sql: string, params?: unknown) => {
      // 谓词分批 SELECT（rowid 游标 + LIMIT 100）：与收尾 COUNT（无 LIMIT）
      // 区分开，只把 not open 注入给批查询。
      if (
        !injected &&
        typeof sql === "string" &&
        sql.includes("FROM chat_message") &&
        sql.includes("content_json") &&
        /LIMIT/i.test(sql)
      ) {
        injected = true;
        return Promise.reject(new Error("connection is not open"));
      }
      return originalQuery(sql, params);
    };
    try {
      // 旧实现（循环外取 runtime + 整循环一个 try）：catch 即永久退出，
      // 明文行永不被搬运 → 下方 done 断言红。新实现：warn + 退避 1s →
      // 下一轮重取 runtime → 搬运收敛完成。
      await runDesktopMessageContentCompactionLoop();
    } finally {
      conn.query = originalQuery;
    }
    assert.equal(injected, true, "not open 注入必须真被消费");
    const status = await getMessageCompactionStatus(runtime.conn);
    assert.equal(status.done, true, "重挂后压缩任务必须完成收敛");
    assert.equal(isDesktopDbMaintenanceBusy(), false);
  });
});
