/**
 * Desktop 消息正文解压调度服务接线用例（ic-fix-spec ic-01c / ic-02 与
 * cr-fix-spec cr-03 的反向任务侧验收）。
 *
 * - cr-03/ic-01c：**旧 pending 欠账清偿**的维护段（VACUUM）执行瞬间
 *   busy=true、结束复位；VACUUM 抛错（afterMaintenance 的 finally 语义）
 *   也必须复位。反向任务自身**不挂** VACUUM（增容无 freelist 可归还），
 *   维护段只在消费正向遗留的 `nm-message-content/startupMaintenancePending`
 *   时触发一次——故本用例的前置是先把该标记置上。
 * - 反向任务不挂 VACUUM：搬完一整轮不产生任何 VACUUM 语句。
 * - ic-02：轮内「connection is not open」不算失败收手——退避后下一轮
 *   重取 runtime 重挂继续搬运（旧实现整循环一个 try、catch 即永久退出）。
 *
 * 夹具口径：存量压缩行不经生产写路径（`encodeMessageContent` 已随 Step 3
 * 删除、`batchInsert` 已写明文）——用 node:zlib 的 `deflateSync` + 裸
 * `INSERT` 直造（zlib 容器格式，与 fflate `unzlibSync` 兼容）。
 *
 * @module test/message-content-decompression-service
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { getMessageDecompressStatus } from "@novel-master/core";
import { runDesktopMessageContentDecompressLoop } from "../src/main/services/message-content-decompression.service.js";
import { isDesktopDbMaintenanceBusy } from "../src/main/services/db-maintenance-busy.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** 反向任务完成标记 module 段（key 为 "decompressDone"；core 常量未从主入口导出，此处取字面量）。 */
const DECOMPRESS_MODULE = "nm-message-decompress";
/** 正向任务遗留的 pending 欠账标记（module/key 同款字面量）。 */
const LEGACY_MODULE = "nm-message-content";
const LEGACY_PENDING_KEY = "startupMaintenancePending";

/** 裸 INSERT 造一条存量压缩形态行（不经生产写路径）。 */
async function insertCompressedRow(
  conn: { execute: (sql: string, ...rest: unknown[]) => Promise<unknown> },
  id: string,
  sessionId: string,
  seq: number,
  text: string,
): Promise<void> {
  const blob = deflateSync(
    Buffer.from(
      JSON.stringify({ blocks: [{ type: "text", text }] }),
      "utf8",
    ),
  );
  await conn.execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, content_encoding,
       content_blob, created_at_ms, hidden
     ) VALUES (?, ?, ?, 'user', '', 'zlib', ?, ?, 0)`,
    [id, sessionId, seq, blob, Date.now()],
  );
}

const isVacuum = (sql: string): boolean => /^\s*VACUUM\b/i.test(sql);

describe("desktop 消息正文解压调度服务（cr-03 / ic-02）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-decompress-svc-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("cr-03/ic-01c：旧 pending 欠账清偿的维护段 VACUUM 瞬间 busy=true；VACUUM 抛错后 busy 仍复位（finally 语义）", async () => {
    const runtime = await getDesktopRuntime();
    // 清两侧标记自管状态（完成标记 + 正向遗留 pending）。
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [DECOMPRESS_MODULE, LEGACY_MODULE],
    );
    // 置正向遗留的 pending 标记：反向任务入口据此补跑一次去重维护——
    // 这是本任务唯一会进维护段的路径（自身不挂 VACUUM）。
    await runtime.conn.execute(
      "INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, '1')",
      [LEGACY_MODULE, LEGACY_PENDING_KEY],
    );

    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
    };
    const originalExecute = conn.execute.bind(conn);
    let busyAtVacuum: boolean | undefined;
    // 探针必须透传其余实参（KKV 置标记等带参语句），否则会以
    // 「Too few parameter」打爆主流程，维护段根本走不到 VACUUM。
    conn.execute = async (sql: string, ...rest: unknown[]) => {
      if (isVacuum(sql)) {
        busyAtVacuum = isDesktopDbMaintenanceBusy();
        // 构造 VACUUM 抛错（磁盘满/库被锁的真实失败形态）：
        // 证 afterMaintenance 的 finally 语义——抛错也必须复位 busy。
        throw new Error("注入：VACUUM 失败（模拟磁盘满）");
      }
      return originalExecute(sql, ...rest);
    };
    try {
      // 空库：谓词空 → 置完成标记；维护段由旧 pending 欠账触发，
      // VACUUM 抛错由 core 吞掉只 warn。
      await runDesktopMessageContentDecompressLoop();
    } finally {
      conn.execute = originalExecute;
    }
    assert.equal(busyAtVacuum, true, "VACUUM 执行瞬间 busy 必须为 true");
    assert.equal(
      isDesktopDbMaintenanceBusy(),
      false,
      "VACUUM 抛错后 busy 必须复位（afterMaintenance 的 finally 语义）",
    );
    const status = await getMessageDecompressStatus(runtime.conn);
    assert.equal(status.done, true, "维护失败不影响搬运完成态");
    const pending = await runtime.conn.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
      [LEGACY_MODULE, LEGACY_PENDING_KEY],
    );
    assert.equal(
      Number(pending[0]!.n),
      1,
      "维护抛错（返回非 null 的前提不成立）→ 旧 pending 欠账标记保留，下个冷启动再补跑",
    );
  });

  it("反向任务自身不挂 VACUUM：无旧 pending 的库搬完不产生任何 VACUUM 语句", async () => {
    const runtime = await getDesktopRuntime();
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [DECOMPRESS_MODULE, LEGACY_MODULE],
    );
    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id = 'ic-vac-session'",
    );

    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    const originalExecute = conn.execute.bind(conn);
    let vacuumCount = 0;
    conn.execute = async (sql: string, ...rest: unknown[]) => {
      if (isVacuum(sql)) {
        vacuumCount += 1;
      }
      return originalExecute(sql, ...rest);
    };
    conn.query = (sql: string, params?: unknown) => {
      if (isVacuum(sql)) {
        vacuumCount += 1;
      }
      return originalQuery(sql, params);
    };

    // 造一条存量压缩行：谓词命中 → 真搬（非空跑短路）。
    await insertCompressedRow(
      conn,
      "ic-vac-msg-1",
      "ic-vac-session",
      1,
      "不挂 VACUUM 夹具",
    );

    try {
      await runDesktopMessageContentDecompressLoop();
    } finally {
      conn.execute = originalExecute;
      conn.query = originalQuery;
    }
    assert.equal(
      vacuumCount,
      0,
      "解压是增容、无 freelist 可归还：搬完不得下发任何 VACUUM",
    );
    const status = await getMessageDecompressStatus(runtime.conn);
    assert.equal(status.done, true, "压缩行应已解回明文并置完成标记");
    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id = 'ic-vac-session'",
    );
  });

  it("ic-02：轮内连接被关（not open）退避重挂，不永久退出", async () => {
    const runtime = await getDesktopRuntime();
    // 清完成标记与旧 pending 标记：让解压任务真发谓词分批 SELECT。
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [DECOMPRESS_MODULE, LEGACY_MODULE],
    );
    // 造一条存量压缩行（谓词命中）：空库的「谓词空=等价完成」会让
    // done 断言恒真（ic-09 同族坑）——有活干才能区分「重挂后收敛」与
    // 「catch 即 return 的永久退出」。
    await insertCompressedRow(
      runtime.conn as unknown as {
        execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      },
      randomUUID(),
      randomUUID(),
      1,
      "ic-02 重挂夹具",
    );

    const conn = runtime.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    let injected = false;
    conn.query = (sql: string, params?: unknown) => {
      // 谓词分批 SELECT（rowid 游标 + LIMIT 100）：与入口自愈探测
      // （SELECT 1 ... LIMIT 1）、收尾 COUNT（无 LIMIT）区分开，只把
      // not open 注入给批查询。
      if (
        !injected &&
        typeof sql === "string" &&
        sql.includes("FROM chat_message") &&
        sql.includes("content_blob") &&
        sql.includes("rowid") &&
        /LIMIT/i.test(sql)
      ) {
        injected = true;
        return Promise.reject(new Error("connection is not open"));
      }
      return originalQuery(sql, params);
    };
    try {
      // 旧实现（循环外取 runtime + 整循环一个 try）：catch 即永久退出，
      // 压缩行永不被搬运 → 下方 done 断言红。新实现：warn + 退避 1s →
      // 下一轮重取 runtime → 搬运收敛完成。
      await runDesktopMessageContentDecompressLoop();
    } finally {
      conn.query = originalQuery;
    }
    assert.equal(injected, true, "not open 注入必须真被消费");
    const status = await getMessageDecompressStatus(runtime.conn);
    assert.equal(status.done, true, "重挂后解压任务必须完成收敛");
    assert.equal(isDesktopDbMaintenanceBusy(), false);
    const left = await runtime.conn.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chat_message WHERE content_blob IS NOT NULL",
    );
    assert.equal(Number(left[0]!.n), 0, "谓词（content_blob IS NOT NULL）必须归零");
  });
});