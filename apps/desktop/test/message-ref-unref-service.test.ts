/**
 * Desktop 引用化回迁调度服务接线用例。
 *
 * 覆盖三件事（与解压兄弟任务测试同款观测面思路，但观测点换成「谓词是否
 * 归零 / 标记是否置位 / 批查询发生了几次」）：
 * - **不挂 VACUUM**：回迁是增容（明文包比占位空串大得多），库里没有可归还的
 *   freelist 页——搬完整轮不得下发任何 VACUUM。
 * - **deferred 停手**：解压兄弟任务标记未置时 core 返回 `deferred=true`，
 *   调度层必须 warn 后 return **本进程收手**（若误当预算耗尽 `sleep(0)`
 *   续轮，谓词批查询会被反复下发；断言批查询次数 === 1）。
 * - **stalled 停手**：驱动写回静默不生效（注入 transaction 返回
 *   `changes: 0`）→ 收尾残留校验判定 stalled，调度层同样只跑一轮。
 * - **rebootstrap 重挂**：轮内「connection is not open」不算失败收手——
 *   退避后下一轮重取 runtime 自然收敛。
 *
 * 夹具口径：存量引用行不经生产写路径（v1.5.30 写侧恒产全文），裸 `INSERT`
 * 直造；源 revision 不造（引用键指向不存在的 entryId → 落错误占位后退出
 * 谓词，足够驱动「谓词归零 + 标记置位」的观测面）。
 *
 * @module test/message-ref-unref-service
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  MESSAGE_REF_UNREF_KKV_KEY,
  MESSAGE_REF_UNREF_KKV_MODULE,
  getMessageRefUnrefStatus,
} from "@novel-master/core";
import { runDesktopMessageRefUnrefLoop } from "../src/main/services/message-ref-unref.service.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** 解压兄弟任务完成标记（core 主入口未导出其 KKV 常量，取字面量）。 */
const DECOMPRESS_MODULE = "nm-message-decompress";
const DECOMPRESS_KEY = "decompressDone";

const isVacuum = (sql: string): boolean => /^\s*VACUUM\b/i.test(sql);

/** 造一条**真**引用行（带 contentRef 键），指向一个不存在的 revision。 */
async function insertRealRefRow(
  conn: { execute: (sql: string, ...rest: unknown[]) => Promise<unknown> },
  tag: string,
): Promise<string> {
  const id = randomUUID();
  const json = JSON.stringify({
    blocks: [
      {
        type: "tool_result",
        toolUseId: `tu-${tag}`,
        content: "",
        contentRef: {
          path: "/ghost-desktop.txt",
          entryId: 900001,
          version: 1,
          contentHash: "f".repeat(64),
          totalBytes: 1,
          offset: 1,
          returnedLines: 1,
          totalLines: 1,
          truncated: false,
        },
      },
    ],
  });
  await conn.execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, created_at_ms, hidden
     ) VALUES (?, ?, ?, 'assistant', ?, ?, 0)`,
    [id, `desktop-unref-${tag}`, Math.floor(Math.random() * 100000), json, Date.now()],
  );
  return id;
}

async function markDecompressDone(conn: {
  execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await conn.execute(
    "INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?) ON CONFLICT(module, key) DO UPDATE SET value = excluded.value",
    [DECOMPRESS_MODULE, DECOMPRESS_KEY, JSON.stringify({ at: "t" })],
  );
}

async function predicateCount(conn: {
  query: (sql: string, params?: unknown) => Promise<unknown>;
}): Promise<number> {
  const rows = (await conn.query(
    `SELECT COUNT(*) AS n FROM chat_message
     WHERE content_json LIKE '%"contentRef"%' AND content_blob IS NULL`,
  )) as Array<{ n: number }>;
  return Number(rows[0]!.n);
}

describe("desktop 引用化回迁调度服务", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-unref-svc-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("正常收敛：谓词归零 + 完成标记置位，且不挂 VACUUM", async () => {
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await markDecompressDone(conn);
    const id = await insertRealRefRow(conn, "ok");

    const originalQuery = conn.query.bind(conn);
    const originalExecute = conn.execute.bind(conn);
    let vacuumCount = 0;
    let batchSelectCount = 0;
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
      if (
        typeof sql === "string" &&
        sql.includes("FROM chat_message") &&
        sql.includes("contentRef") &&
        sql.includes("rowid")
      ) {
        batchSelectCount += 1;
      }
      return originalQuery(sql, params);
    };
    try {
      await runDesktopMessageRefUnrefLoop();
    } finally {
      conn.execute = originalExecute;
      conn.query = originalQuery;
    }

    assert.equal(vacuumCount, 0, "回迁是增容、无 freelist 可归还：不得下发 VACUUM");
    assert.equal(await predicateCount(conn), 0, "谓词必须归零");
    assert.ok(batchSelectCount >= 1, "谓词批查询必须真发过（有活干）");
    const status = await getMessageRefUnrefStatus(runtime.conn);
    assert.equal(status.done, true, "完成标记必须置位");
    const row = (await conn.query(
      "SELECT content_json FROM chat_message WHERE id = ?",
      [id],
    )) as Array<{ content_json: string }>;
    assert.equal(
      String(row[0]!.content_json).includes('"contentRef"'),
      false,
      "回填后正文不得再有 contentRef 键",
    );

    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
  });

  it("deferred：解压任务未完成 → warn 后本进程收手（不零延迟续轮、不置标记）", async () => {
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await insertRealRefRow(conn, "deferred");

    const originalQuery = conn.query.bind(conn);
    let batchSelectCount = 0;
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((a) => String(a)).join(" "));
    };
    conn.query = (sql: string, params?: unknown) => {
      if (
        typeof sql === "string" &&
        sql.includes("FROM chat_message") &&
        sql.includes("contentRef") &&
        sql.includes("rowid")
      ) {
        batchSelectCount += 1;
      }
      return originalQuery(sql, params);
    };
    try {
      // 若实现误把 deferred 当「预算耗尽」sleep(0) 续轮，这里会一直转下去
      // （谓词批查询次数一路涨、测试超时 = 红）。
      await runDesktopMessageRefUnrefLoop();
    } finally {
      conn.query = originalQuery;
      console.warn = originalWarn;
    }

    assert.equal(
      batchSelectCount,
      2,
      "deferred 必须本进程停手：一轮循环恰好两次谓词批查询（第 2 次空批收尾），不得续轮",
    );
    assert.ok(
      warns.some((w) => w.includes("让位停手")),
      `deferred 必须留 warn 线索，实际 warn：${warns.join(" | ")}`,
    );
    const marker = (await conn.query(
      "SELECT value FROM kkv_entry WHERE module = ? AND key = ?",
      [MESSAGE_REF_UNREF_KKV_MODULE, MESSAGE_REF_UNREF_KKV_KEY],
    )) as unknown[];
    assert.equal(marker.length, 0, "deferred 不得置完成标记");
    assert.equal(
      await predicateCount(conn),
      0,
      "正文已回填（占位）→ 谓词归零，但标记仍不置",
    );

    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
  });

  it("stalled：驱动写回静默不生效 → 收尾残留校验拦停，只跑一轮", async () => {
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      query: (sql: string, params?: unknown) => Promise<unknown>;
      transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    };
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await markDecompressDone(conn);
    await insertRealRefRow(conn, "stalled");

    const originalTransaction = conn.transaction.bind(conn);
    const originalQuery = conn.query.bind(conn);
    let batchSelectCount = 0;
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((a) => String(a)).join(" "));
    };
    conn.transaction = async () => ({ changes: 0 }) as never;
    conn.query = (sql: string, params?: unknown) => {
      if (
        typeof sql === "string" &&
        sql.includes("FROM chat_message") &&
        sql.includes("contentRef") &&
        sql.includes("rowid")
      ) {
        batchSelectCount += 1;
      }
      return originalQuery(sql, params);
    };
    try {
      await runDesktopMessageRefUnrefLoop();
    } finally {
      conn.transaction = originalTransaction;
      conn.query = originalQuery;
      console.warn = originalWarn;
    }

    assert.equal(
      batchSelectCount,
      2,
      "stalled 必须本进程停手：一轮循环恰好两次谓词批查询（第 2 次空批收尾），不得续轮",
    );
    assert.ok(
      warns.some((w) => w.includes("残留")),
      `stalled 必须留 warn 线索，实际 warn：${warns.join(" | ")}`,
    );
    assert.equal(
      await predicateCount(conn),
      1,
      "写回未生效 → 行仍留在谓词里（未谎报完成）",
    );
    const marker = (await conn.query(
      "SELECT value FROM kkv_entry WHERE module = ? AND key = ?",
      [MESSAGE_REF_UNREF_KKV_MODULE, MESSAGE_REF_UNREF_KKV_KEY],
    )) as unknown[];
    assert.equal(marker.length, 0, "stalled 不得置完成标记");

    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
  });

  it("rebootstrap：轮内连接被关（not open）退避重挂，收敛完成", async () => {
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      execute: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await markDecompressDone(conn);
    await insertRealRefRow(conn, "rebootstrap");

    const originalQuery = conn.query.bind(conn);
    let injected = false;
    conn.query = (sql: string, params?: unknown) => {
      if (
        !injected &&
        typeof sql === "string" &&
        sql.includes("FROM chat_message") &&
        sql.includes("contentRef") &&
        sql.includes("rowid") &&
        /LIMIT/i.test(sql)
      ) {
        injected = true;
        return Promise.reject(new Error("connection is not open"));
      }
      return originalQuery(sql, params);
    };
    try {
      await runDesktopMessageRefUnrefLoop();
    } finally {
      conn.query = originalQuery;
    }

    assert.equal(injected, true, "not open 注入必须真被消费");
    assert.equal(await predicateCount(conn), 0, "重挂后回迁必须收敛");
    const status = await getMessageRefUnrefStatus(runtime.conn);
    assert.equal(status.done, true);

    await runtime.conn.execute(
      "DELETE FROM chat_message WHERE session_id LIKE 'desktop-unref-%'",
    );
    await runtime.conn.execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_REF_UNREF_KKV_MODULE, DECOMPRESS_MODULE],
    );
  });
});
