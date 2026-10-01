/**
 * db/stats 的 vfsPack 字段契约（T-VP22）：DTO 贯通 + handler 兜底。
 *
 * 独立文件的原因（照 blob-binary-normalization-maintenance.test.ts 的
 * 「独立测试文件承载」先例）：core `getVfsContentPackStatus` 带 3s 采样
 * 节流缓存（WeakMap 按连接实例），若与 db-maintenance-handlers.test.ts
 * 同文件，前序用例的真实采样会在窗口内回放缓存值——query 注入打不穿
 * 缓存，兜底分支假绿。本文件内**兜底用例在前**（进程首次采样即注入
 * 窗口、失败路径不写缓存），贯通用例在后（缓存无值、真采样），判据
 * 可靠。
 *
 * - 兜底（对齐 cr-21③ 的 blobBinary / ic-04 的 messageDecompress 口径）：
 *   候选谓词查询抛错 → `vfsPack === null` 且主统计（fileBytes /
 *   reclaimableBytes）与其余状态行不受影响。
 * - 正常路径：vfsPack 两态本体贯通（pendingGroups / memberCount /
 *   streamBytes / failedGroups 四字段；空库下全 0 收敛态）。
 *
 * @module test/db-maintenance-vfs-pack-stats
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleDbStats } from "../src/main/ipc/handlers/db-maintenance.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("db/stats vfsPack 字段（T-VP22）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-pack-stats-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("候选谓词查询抛错 → vfsPack === null 且主统计/其余状态行仍在（采样降级不拖垮主统计）", async () => {
    const runtime = await getDesktopRuntime();
    const conn = runtime.conn as unknown as {
      query: (sql: string, params?: unknown) => Promise<unknown>;
    };
    const originalQuery = conn.query.bind(conn);
    // 只打掉候选谓词查询（FROM vfs_revision 为其特有；getStorageStats 的
    // PRAGMA / blobBinary 谓词 / messageDecompress 的 kkv 读均不含），
    // 构造 getVfsContentPackStatus 抛错路径。
    conn.query = (sql: string, params?: unknown) => {
      if (typeof sql === "string" && sql.includes("FROM vfs_revision")) {
        return Promise.reject(new Error("注入：vfs 打包状态采样失败"));
      }
      return originalQuery(sql, params);
    };
    try {
      const res = await handleDbStats();
      assert.equal(res.ok, true);
      if (!res.ok) {
        return;
      }
      assert.equal(res.data.vfsPack, null);
      // 主统计与其余状态行不受传染
      assert.ok(res.data.fileBytes > 0);
      assert.ok(res.data.reclaimableBytes >= 0);
      assert.ok(Array.isArray(res.data.blobBinary.tables));
      assert.ok(res.data.messageDecompress != null);
    } finally {
      conn.query = originalQuery;
    }
  });

  it("正常路径：vfsPack 两态本体贯通（空库收敛态四字段全 0）", async () => {
    const res = await handleDbStats();
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    const pack = res.data.vfsPack;
    assert.ok(pack != null, "vfsPack 应为两态本体（非 null）");
    assert.equal(typeof pack!.pendingGroups, "number");
    assert.equal(typeof pack!.memberCount, "number");
    assert.equal(typeof pack!.streamBytes, "number");
    assert.equal(typeof pack!.failedGroups, "number");
    // 空库：无候选 entry、无 pack 行、无坏组快照——收敛态全 0
    assert.deepEqual(pack, {
      pendingGroups: 0,
      memberCount: 0,
      streamBytes: 0,
      failedGroups: 0,
    });
  });
});
