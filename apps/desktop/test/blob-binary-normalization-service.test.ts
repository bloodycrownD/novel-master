/**
 * Desktop blob 归一调度服务接线用例（cr-fix-spec cr-03 / cr-05 / cr-33 的
 * desktop 验收）。
 *
 * - cr-03：core 收尾维护链路（GC/checkpoint/VACUUM）执行瞬间 busy=true；
 *   VACUUM 抛错（afterMaintenance 的 finally 语义）也必须复位；归一循环
 *   本身（批间）不置 busy——renderer「清理」按钮的 controlsDisabled 只
 *   透传 isDesktopDbMaintenanceBusy()，主进程侧断言即等价钉住。
 * - cr-05：挂载去重键=runtime 连接身份；轮内「connection is not open」
 *   不算失败收手——退避后下一轮重取 runtime 重挂。
 *
 * @module test/blob-binary-normalization-service
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getBlobBinaryStatus } from "@novel-master/core";
import { scheduleDesktopBlobBinaryNormalization } from "../src/main/services/blob-binary-normalization.service.js";
import { isDesktopDbMaintenanceBusy } from "../src/main/services/db-maintenance-busy.js";
import {
  getDesktopRuntime,
  rebootstrapDesktopRuntime,
  resetDesktopRuntimeForTest,
} from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** 轮询等待条件成立（超时抛错），后台 fire-and-forget 循环的完成信号。 */
async function waitUntil(
  probe: () => Promise<boolean> | boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitUntil 超时：${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("desktop blob 归一调度服务（cr-03 / cr-05）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-blob-svc-"));
    await resetDesktopRuntimeForTest();
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("cr-03：自动收尾维护段 VACUUM 瞬间 busy=true；VACUUM 抛错后 busy 仍复位（finally 语义）", async () => {
    // 【必须是本文件首条真跑维护段的用例】`runStartupMaintenanceOnce` 是
    // 模块级进程去重（执行前置位、失败不回滚），本用例消费掉该标记后，
    // 后续用例对「VACUUM 是否真跑」的观测一律不可用（照 core 测试
    // blob-binary-normalization.test.ts 的既有纪律；busy 断言不依赖
    // VACUUM 成功，抛错路径才是 finally 语义的试金石）。
    const runtime = await getDesktopRuntime();
    // 空库（谓词空=done）+ 预置维护兜底标记 → 满足 allDone &&
    // maintenancePending 门条件，进维护段触发 VACUUM。
    await runtime.conn.execute(
      "INSERT INTO kkv_entry (module, key, value) VALUES ('nm-blob-binary', 'startupMaintenancePending', '1')",
    );

    // busy 窗口断言不能靠事件循环插入：better-sqlite3 的同步 VACUUM 会冻住
    // main 事件循环——照 db-maintenance-handlers.test.ts T-DMD2 的探针手法，
    // 在 conn.execute 上装探针、VACUUM 语句执行的一刻采样。
    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
    };
    const originalExecute = conn.execute.bind(conn);
    let busyAtVacuum: boolean | undefined;
    // 探针必须透传其余实参（KKV 写入等带参语句），否则会以
    // 「Too few parameter」打爆归一主流程。
    conn.execute = async (sql: string, ...rest: unknown[]) => {
      if (sql.includes("VACUUM")) {
        busyAtVacuum = isDesktopDbMaintenanceBusy();
        // 构造 VACUUM 抛错（磁盘满/库被锁的真实失败形态，照姊妹文件
        // message-content-decompression-service.test.ts 的注入范式）：证
        // afterMaintenance 的 finally 语义——抛错也必须复位 busy。
        throw new Error("注入：VACUUM 失败（模拟磁盘满）");
      }
      return originalExecute(sql, ...rest);
    };
    try {
      scheduleDesktopBlobBinaryNormalization();
      await waitUntil(
        () => busyAtVacuum !== undefined,
        10_000,
        "等待自动收尾 VACUUM 探针命中",
      );
    } finally {
      conn.execute = originalExecute;
    }
    assert.equal(busyAtVacuum, true, "VACUUM 执行瞬间 busy 必须为 true");
    await waitUntil(
      () => !isDesktopDbMaintenanceBusy(),
      5_000,
      "等待 afterMaintenance 复位 busy",
    );
    assert.equal(
      isDesktopDbMaintenanceBusy(),
      false,
      "VACUUM 抛错后 busy 必须复位（afterMaintenance 的 finally 语义）",
    );
    // 维护失败只影响空间回收，不影响归一完成态（core 吞错只 warn）。
    const status = await getBlobBinaryStatus(runtime.conn);
    assert.equal(
      status.tables.every((table) => table.done),
      true,
      "维护失败不影响归一完成态",
    );
  });

  it("cr-03：归一循环进行中（未进维护段）busy=false，清理按钮不被归一置位", async () => {
    const runtime = await getDesktopRuntime();
    // 清完成标记：上一用例置过标记，不清会让归一直接短路、批查询不发。
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module = 'nm-blob-binary'",
    );
    // 造 legacy base64 文本行：归一有活干（processedAny=true）。
    // zlib 压缩任意文本 → base64 文本形态直插（照 core 归一测试的造数手法）。
    const { deflateSync } = await import("node:zlib");
    for (let i = 0; i < 5; i += 1) {
      const b64 = deflateSync(new TextEncoder().encode(`cr-03-batch-${i}`)).toString("base64");
      await runtime.conn.execute(
        "INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count) VALUES (?, 'zlib-b64', ?, ?, 0)",
        [`cr03-${i}`, b64, b64.length],
      );
    }

    const conn = runtime.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    let busyAtBatch: boolean | undefined;
    let batchSeen = 0;
    conn.query = (sql: string, params?: unknown) => {
      // 归一谓词分批 SELECT（含 LIMIT 100）：批间采样点——此刻归一循环
      // 正在推进、维护段尚未开始，busy 必须为 false（归一是分批短事务 +
      // setTimeout(0) 让步，不冻结事件循环、不占清理互斥）。
      if (
        typeof sql === "string" &&
        sql.includes("FROM vfs_content_blob") &&
        /LIMIT/i.test(sql)
      ) {
        batchSeen += 1;
        busyAtBatch = isDesktopDbMaintenanceBusy();
      }
      return originalQuery(sql, params);
    };
    try {
      scheduleDesktopBlobBinaryNormalization();
      // 谓词清零 = 5 行 legacy 真被归一搬运完（比读标记更贴近「批查询真跑」）。
      await waitUntil(
        async () => {
          const rows = (await originalQuery(
            "SELECT COUNT(*) AS n FROM vfs_content_blob WHERE (encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text'))",
          )) as { n: number }[];
          return Number(rows[0]?.n ?? 0) === 0;
        },
        15_000,
        "等待 5 行 legacy 归一收敛（谓词清零）",
      );
      assert.ok(batchSeen > 0, "归一批间探针必须命中过");
    } finally {
      conn.query = originalQuery;
    }
    assert.equal(
      busyAtBatch,
      false,
      "归一循环进行中（未进维护段）busy 必须为 false——controlsDisabled 不得因归一被置位",
    );
    // done 判定后循环可能仍在收尾（维护段/下一表扫描），等 busy 稳定复位
    // 再终判，避免收尾回调窗口与断言竞态。
    await waitUntil(
      () => !isDesktopDbMaintenanceBusy(),
      5_000,
      "等待归一收尾后 busy 复位",
    );
    assert.equal(isDesktopDbMaintenanceBusy(), false);
  });

  it("cr-05：轮内连接被关（not open）不永久死亡——退避后重挂并完成归一", async () => {
    const runtime = await getDesktopRuntime();
    // 【顺序即正确性】先装 query 补丁，再清完成标记、插 legacy 行、调度——
    // 前序用例（cr-03）的 fire-and-forget 循环可能仍在轮询，若补丁晚于
    // 「删标记 / 插行」安装，它的谓词查询会走 originalQuery 把行提前归一
    // 并置标记，注入就永远等不到消费（全量并发负载下窗口被拉宽、稳定命中；
    // 隔离跑不显现，往用例里加 console.log 即改变命中——时序敏感实测）。
    // 补丁先行后无论哪条循环消费注入，退避重挂后终将由某条循环完成归一，
    // 「注入被消费 + done 收敛」两个断言在任意时序下都成立。
    const conn = runtime.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    let injected = false;
    conn.query = (sql: string, params?: unknown) => {
      if (
        !injected &&
        typeof sql === "string" &&
        sql.includes("FROM vfs_content_blob") &&
        /LIMIT/i.test(sql)
      ) {
        injected = true;
        return Promise.reject(new Error("connection is not open"));
      }
      return originalQuery(sql, params);
    };
    try {
      // 清完成标记：空表也会真发一次谓词分批 SELECT，注入点才有机会命中。
      await runtime.conn.execute("DELETE FROM kkv_entry WHERE module = 'nm-blob-binary'");
      // 造一条 legacy base64 行：空表的「谓词空=等价完成」会让 done 轮询
      // 恒真（旧实现 catch 即 return 也绿）——有活干才能区分「重挂收敛」
      // 与「永久死亡」。
      const { deflateSync } = await import("node:zlib");
      const b64 = deflateSync(new TextEncoder().encode("cr-05-rebind")).toString("base64");
      await runtime.conn.execute(
        "INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count) VALUES (?, 'zlib-b64', ?, ?, 0)",
        ["cr05-1", b64, b64.length],
      );
      scheduleDesktopBlobBinaryNormalization();
      // 旧实现（catch 无分流 → return）：legacy 行永不被归一，谓词不清、
      // done 判定不成立，轮询超时变红。新实现：warn + 退避 1s → 下一轮
      // 重取 runtime 恢复 → 归一搬运 → 谓词空、标记置位。
      await waitUntil(
        async () => {
          const status = await getBlobBinaryStatus(runtime.conn);
          return status.tables.every((table) => table.done);
        },
        15_000,
        "等待重挂后的归一完成",
      );
      assert.equal(injected, true, "not open 注入必须真被消费");
    } finally {
      conn.query = originalQuery;
    }
    assert.equal(isDesktopDbMaintenanceBusy(), false);
  });

  it("cr-05：rebootstrap 换 runtime 后再次调度仍会发生（身份去重不挂死）", async () => {
    const runtimeBefore = await getDesktopRuntime();
    // 第一轮：清标记挂载，等归一完成（scheduledRuntime 已随循环退出清空）。
    await runtimeBefore.conn.execute(
      "DELETE FROM kkv_entry WHERE module = 'nm-blob-binary'",
    );
    scheduleDesktopBlobBinaryNormalization();
    await waitUntil(
      async () => {
        const status = await getBlobBinaryStatus(runtimeBefore.conn);
        return status.tables.every((table) => table.done);
      },
      15_000,
      "等待第一轮归一完成",
    );

    // 模拟 rebootstrap（备份导入 / 云同步 pull 的真实路径）：先关连接再重建。
    await rebootstrapDesktopRuntime();
    const runtimeAfter = await getDesktopRuntime();
    assert.notEqual(runtimeAfter, runtimeBefore, "rebootstrap 必须换新 runtime");

    // 新连接装 query 探针计数：第二次调度必须真的起跑（旧实现的进程级
    // scheduled 布尔永不复位，第二次调度直接 return → 计数恒 0 → 红）。
    const conn = runtimeAfter.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    let newConnQueries = 0;
    conn.query = (sql: string, params?: unknown) => {
      newConnQueries += 1;
      return originalQuery(sql, params);
    };
    try {
      scheduleDesktopBlobBinaryNormalization();
      await waitUntil(
        () => newConnQueries > 0,
        10_000,
        "等待第二次调度在新连接上真跑",
      );
    } finally {
      conn.query = originalQuery;
    }
    assert.ok(newConnQueries > 0, "rebootstrap 后第二次调度仍发生");
  });
});
