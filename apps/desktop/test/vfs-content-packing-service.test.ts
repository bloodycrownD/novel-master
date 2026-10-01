/**
 * Desktop VFS 历史版本打包调度服务接线用例（fix-spec pbp-29）。
 *
 * blob 归一 / 消息压缩两侧的调度服务已有同款接线用例（cr-03 / cr-05 / ic-02），
 * 打包服务是第三份逐字复制来的骨架，风险分支同样高、此前零覆盖。本文件钉
 * 三条契约：
 *
 * - **busy 回调缝**（对应 cr-03）：core 进收尾维护段（GC/checkpoint/VACUUM）
 *   的瞬间 `isDesktopDbMaintenanceBusy() === true`；维护段抛错（VACUUM 磁盘
 *   满/库被锁）后 `afterMaintenance` 仍复位（finally 语义）——busy 挂死会让
 *   renderer 的「数据清理」按钮永久禁用。
 * - **轮内连接关闭自愈**（对应 ic-02 / cr-05）：轮内撞上「connection is not
 *   open」不算失败收手——warn + 退避后下一轮重取 runtime 拿新连接继续打包；
 *   catch 即 return 的实现会让候选永久滞留（状态行一直显示「剩余 N 组」）。
 * - **组合守卫**（对应 ic-21）：busy/云同步/Agent 任一命中时循环让路、
 *   零候选扫描（不在数据清理 VACUUM 窗口里抢连接），复位后恢复。
 *
 * mock 面：照兄弟文件的手法——**不桩 core**，用真 core + 真临时库（`conn` 上
 * 装探针 / 注入抛错），因为 busy 契约验的是「core 调回调缝的时刻」与「连接
 * 换掉后的重取」，桩掉 core 会把待验行为一起桩没。
 *
 * @module test/vfs-content-packing-service
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { scheduleDesktopVfsContentPacking } from "../src/main/services/vfs-content-packing.service.js";
import {
  acquireDesktopDbMaintenanceBusy,
  isDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
} from "../src/main/services/db-maintenance-busy.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../src/main/runtime/types.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** conn 上被探针改写的两个方法（runtime.conn 的结构化窄化视图）。 */
type ProbeableConn = {
  execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
  query: (sql: string, params?: unknown) => Promise<unknown>;
};

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 候选扫描语句特征（collectCandidateEntries：revision JOIN blob + 排除 head）。 */
function isCandidateScan(sql: unknown): boolean {
  return (
    typeof sql === "string" &&
    sql.includes("FROM vfs_revision r") &&
    sql.includes("JOIN vfs_content_blob b")
  );
}

/**
 * 造一个可打包 entry：1 个 head 版本（blob 行）+ 2 个非 head 历史版本
 * （各自独立 blob 行）——非 head 候选谓词要求同 entry 内 DISTINCT hash ≥ 2，
 * 只造 1 个历史版本会恒零候选（done 立即成立，测不出任何东西）。
 *
 * 三个版本各用「相似长文」，让切组走真实编码路径（组内成员明文读得到、
 * 不进坏组分支）。blob 行直插 zlib 二进制（写侧同形态，blob 归一服务用例
 * 的造数手法同源）。
 */
async function seedPackableEntry(
  runtime: DesktopNovelMasterRuntime,
  tag: string,
): Promise<void> {
  const { deflateSync } = await import("node:zlib");
  const conn = runtime.conn as unknown as ProbeableConn;
  const unit = "落霞与孤鹜齐飞，秋水共长天一色。";
  const plainOf = (index: number): string =>
    `${tag}-版本${index}\n${unit.repeat(40 + index * 10)}`;
  const insertBlob = async (contentHash: string, plain: string): Promise<void> => {
    await conn.execute(
      "INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count) VALUES (?, 'zlib', ?, ?, 0)",
      [
        contentHash,
        deflateSync(new TextEncoder().encode(plain)),
        new TextEncoder().encode(plain).byteLength,
      ],
    );
  };

  for (let version = 1; version <= 3; version += 1) {
    await insertBlob(`${tag}-h${version}`, plainOf(version));
  }
  const inserted = await conn.execute(
    "INSERT INTO vfs_entry (scope_key, path, content_hash, head_version, mtime_ms, entry_kind) VALUES (?, ?, ?, 3, 0, 'file')",
    [`scope-${tag}`, `${tag}.md`, `${tag}-h3`,],
  );
  const entryId = Number((inserted as { lastInsertRowid: number | bigint }).lastInsertRowid);
  for (let version = 1; version <= 3; version += 1) {
    await conn.execute(
      "INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count) VALUES (?, ?, 'active', ?, ?, 1)",
      [entryId, version, version, `${tag}-h${version}`],
    );
  }
}

/** 已落库的 pack 行数（组被真打包的终态证据，比读内存标记更贴近数据面）。 */
async function countPackRows(
  conn: ProbeableConn,
): Promise<number> {
  const rows = (await conn.query(
    "SELECT COUNT(*) AS n FROM vfs_content_pack",
  )) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

describe("desktop VFS 打包调度服务（pbp-29）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-pack-svc-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("busy 回调缝：进收尾维护段瞬间 busy=true；VACUUM 抛错后仍复位（finally 语义）", async () => {
    // 【必须是本文件首条真跑维护段的用例】`runStartupMaintenanceOnce` 是
    // 进程级去重（执行前置位、失败不回滚），本用例消费掉该标记后，后续用例
    // 一律观测不到 VACUUM（照 blob 归一服务用例的既有纪律）。busy 断言不
    // 依赖 VACUUM 成功——抛错路径才是 finally 语义的试金石。
    const runtime = await getDesktopRuntime();
    // 空库（谓词空 = done）+ 预置维护兜底标记 → 满足
    // 「done && maintenancePending」门条件，进维护段触发 VACUUM。
    await runtime.conn.execute(
      "INSERT INTO kkv_entry (module, key, value) VALUES ('nm-vfs-pack', 'startupMaintenancePending', '1')",
    );

    // busy 窗口断言不能靠事件循环插入：better-sqlite3 的同步 VACUUM 会冻住
    // main 事件循环——在 conn.execute 上装探针、VACUUM 语句执行的一刻采样
    // （此时 beforeMaintenance 已置位、afterMaintenance 尚未复位）。
    const conn = runtime.conn as unknown as ProbeableConn;
    const originalExecute = conn.execute.bind(conn);
    let busyAtVacuum: boolean | undefined;
    conn.execute = async (sql: string, ...rest: unknown[]) => {
      if (sql.includes("VACUUM")) {
        busyAtVacuum = isDesktopDbMaintenanceBusy();
        // 注入 VACUUM 抛错（磁盘满/库被锁的真实失败形态）：证
        // afterMaintenance 的 finally 语义——抛错也必须复位 busy。
        throw new Error("注入：VACUUM 失败（模拟磁盘满）");
      }
      // 探针必须透传其余实参（KKV 写入等带参语句），否则会以
      // 「Too few parameter」打爆打包主流程。
      return originalExecute(sql, ...rest);
    };
    try {
      scheduleDesktopVfsContentPacking();
      await waitUntil(
        () => busyAtVacuum !== undefined,
        15_000,
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
  });

  it("轮内连接被关（not open）退避重挂，不永久死亡——候选照常收敛", async () => {
    const runtime = await getDesktopRuntime();
    await seedPackableEntry(runtime, "pbp29-rebind");

    const conn = runtime.conn as unknown as ProbeableConn;
    const originalQuery = conn.query.bind(conn);
    let injected = false;
    conn.query = (sql: string, params?: unknown) => {
      if (!injected && isCandidateScan(sql)) {
        injected = true;
        return Promise.reject(new Error("connection is not open"));
      }
      return originalQuery(sql, params);
    };
    try {
      scheduleDesktopVfsContentPacking();
      // 旧实现（catch 无分流 → return）：候选永不打组、pack 行恒空 → 红。
      // 新实现：warn + 退避 1s → 下一轮重取 runtime → 组落库。
      await waitUntil(
        async () => (await countPackRows(conn)) > 0,
        20_000,
        "等待重挂后的打包落库",
      );
      assert.equal(injected, true, "not open 注入必须真被消费");
    } finally {
      conn.query = originalQuery;
    }
    // 让循环收手（done 后 finally 释放去重键），避免与下一条用例的守卫
    // 令牌互相干扰。
    await waitUntil(
      () => !isDesktopDbMaintenanceBusy(),
      5_000,
      "等待打包循环收尾后 busy 复位",
    );
    await sleep(200);
  });

  it("组合守卫：busy 期间零候选扫描（不在清理 VACUUM 窗口抢连接），复位后恢复", async () => {
    const runtime = await getDesktopRuntime();
    await seedPackableEntry(runtime, "pbp29-guard");

    const conn = runtime.conn as unknown as ProbeableConn;
    const originalQuery = conn.query.bind(conn);
    let scans = 0;
    conn.query = (sql: string, params?: unknown) => {
      if (isCandidateScan(sql)) {
        scans += 1;
      }
      return originalQuery(sql, params);
    };
    acquireDesktopDbMaintenanceBusy();
    try {
      scheduleDesktopVfsContentPacking();
      // 循环顶守卫命中 → 5s 退避重试，期间不碰库（有活干才有区分度：
      // 空候选时「不扫描」与「扫完即 done」观测上同形）。
      await sleep(1_000);
      assert.equal(
        scans,
        0,
        "busy 置位期间不得发起候选扫描（守卫漏掉 busy 条件会让打包在 VACUUM 窗口抢连接）",
      );

      releaseDesktopDbMaintenanceBusy();
      await waitUntil(
        async () => scans > 0 && (await countPackRows(conn)) > 0,
        20_000,
        "等待 busy 复位后打包恢复",
      );
    } finally {
      conn.query = originalQuery;
      // 兜底：断言提前抛出时本例可能未配对释放，避免 busy 计数泄漏到后续
      // describe（本文件内已无后续用例，仍按纪律兜底）。
      if (isDesktopDbMaintenanceBusy()) {
        releaseDesktopDbMaintenanceBusy();
      }
    }
    await waitUntil(
      () => !isDesktopDbMaintenanceBusy(),
      5_000,
      "等待打包循环收尾后 busy 复位",
    );
  });
});
