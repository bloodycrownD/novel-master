import assert from "node:assert/strict";
import { rmSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  createDbMaintenanceService,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "@/domain/session-kkv/model/session-kkv-domains.js";
import { serializeFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import type { DbMaintenanceService } from "@/infra/db-maintenance/index.js";

/**
 * T-DM 系列必须用**临时文件库**：`:memory:` 库的 VACUUM 是 no-op、
 * freelist 无意义，无法验证物理空间回收。临时目录经 node:os tmpdir() +
 * mkdtemp 随机后缀生成（严禁硬编码 /tmp——session-copy.perf.ts 硬编码
 * 路径在 Windows 上挂掉的前车之鉴），after 钩子统一清理。
 */

const tmpDir = mkdtempSync(join(tmpdir(), "nm-db-maintenance-"));
const dbPath = join(tmpDir, "maintenance.db");
let conn: TdbcConnection;
let maintenance: DbMaintenanceService;

before(async () => {
  registerBetterSqlite3Driver();
  // 文件库 open 形态照 test/helpers/novel-master.ts：URL 与 options 双写
  // filename，Windows 绝对路径塞进 URL 的解析歧义由 options 覆盖兜底。
  conn = await open(`tdbc:sqlite:file:${dbPath}`, {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: dbPath,
  });
  await bootstrapNovelMaster(conn);
  maintenance = createDbMaintenanceService(conn);
});

after(async () => {
  // 先关连接再删目录：Windows 上文件句柄未释放时 rmSync 会 EBUSY。
  await conn.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 直查某会话 entry 引用行的 content_hash 全集。 */
async function entryHashes(sessionId: string): Promise<string[]> {
  const rows = await conn.query<{ content_hash: string }>(
    "SELECT content_hash FROM session_file_cache_entry WHERE session_id = ?",
    [sessionId]
  );
  return rows.map((r) => String(r.content_hash));
}

/** 直查 blob 表总行数。 */
async function blobTotalRows(): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM session_file_cache_blob"
  );
  return Number(rows[0]?.n ?? 0);
}

describe("数据库维护（infra/db-maintenance）", () => {
  it("T-DM1 文件库：写入→删除产生 freelist→maintenance 回收（freelist 归零、体积下降、缓存 GC 生效）", async () => {
    const sk = createSessionKkvService(conn);
    const bulkSession = "dm1-bulk";
    const keepSession = "dm1-keep";

    // 制造体积：40 个互不相同的大 body（body 唯一才不会被去重合并，
    // 每个 16KB 约占 4 页），另加 1 个 keep 会话的独立 body 验证被引用
    // blob 不被误删。
    const bulkKey = "full:/dm1-bulk.md";
    for (let i = 0; i < 40; i++) {
      const body = `dm1-${String(i).padStart(4, "0")}-` + "x".repeat(16 * 1024);
      await sk.set(
        bulkSession,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        `${bulkKey}:${i}`,
        serializeFileCachePayload({ body, mtimeMs: i })
      );
    }
    await sk.set(
      keepSession,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/dm1-keep.md",
      serializeFileCachePayload({
        body: "dm1-keep-body",
        mtimeMs: 42,
      })
    );
    assert.equal(await blobTotalRows(), 41);

    // 删除部分数据产生 freelist：先删 bulk 全部 entry 引用行（40 个 blob
    // 成孤儿），再手动直删其中一半孤儿 blob（约 80 页释放进 freelist）；
    // 剩下一半孤儿 blob 留给 maintenance 链路里的缓存 GC 回收。
    const bulkHashes = await entryHashes(bulkSession);
    assert.equal(bulkHashes.length, 40);
    await conn.execute(
      "DELETE FROM session_file_cache_entry WHERE session_id = ?",
      [bulkSession]
    );
    for (const hash of bulkHashes.slice(0, 20)) {
      await conn.execute(
        "DELETE FROM session_file_cache_blob WHERE content_hash = ?",
        [hash]
      );
    }
    assert.equal(await blobTotalRows(), 21);

    // getStorageStats 与 PRAGMA 直读一致，且已产生可回收空间。
    const stats = await maintenance.getStorageStats();
    const fl = await conn.query<{ freelist_count: number }>(
      "PRAGMA freelist_count"
    );
    const pc = await conn.query<{ page_count: number }>("PRAGMA page_count");
    const ps = await conn.query<{ page_size: number }>("PRAGMA page_size");
    assert.ok(stats.freelistPages > 0, "删除数据后 freelist 应大于 0");
    assert.equal(stats.freelistPages, Number(fl[0]?.freelist_count ?? -1));
    assert.equal(stats.pageCount, Number(pc[0]?.page_count ?? -1));
    assert.equal(stats.pageSize, Number(ps[0]?.page_size ?? -1));
    assert.equal(stats.reclaimableBytes, stats.freelistPages * stats.pageSize);

    const fileSizeBefore = statSync(dbPath).size;

    const result = await maintenance.runDatabaseMaintenance();

    // VACUUM 后 freelist 归零（PRAGMA 直读复核），库文件体积严格下降
    //（已前置断言 freelist > 0，VACUUM 归还空闲页后必然缩小，`<` 是安全断言）。
    assert.equal(result.after.freelistPages, 0);
    const flAfter = await conn.query<{ freelist_count: number }>(
      "PRAGMA freelist_count"
    );
    assert.equal(Number(flAfter[0]?.freelist_count ?? -1), 0);
    const fileSizeAfter = statSync(dbPath).size;
    assert.ok(
      fileSizeAfter < fileSizeBefore,
      `VACUUM 后文件体积应严格下降：before=${fileSizeBefore} after=${fileSizeAfter}`
    );
    assert.ok(result.reclaimedBytes > 0);

    // 缓存 GC 在维护链路里被调用：剩余 20 个孤儿 blob 全部回收，只剩
    // keep 会话仍被引用的 1 个 blob。
    assert.equal(await blobTotalRows(), 1);
    const keepHashes = await entryHashes(keepSession);
    assert.equal(keepHashes.length, 1);
    assert.equal(
      await sk.get(
        keepSession,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        "full:/dm1-keep.md"
      ),
      serializeFileCachePayload({ body: "dm1-keep-body", mtimeMs: 42 })
    );
  });

  it("T-DM2 事务中调用 runDatabaseMaintenance 得到错误而非静默", async () => {
    // TdbcConnection 无事务状态探测 API（端口仅 execute/query/batch/
    // transaction/close），服务层不做主动探测；实测 DELETE journal 下事务内
    // wal_checkpoint 不报错，防护完全落在 VACUUM 的原生报错上（SQLite
    // 拒绝事务内 VACUUM），此处断言事务中调用得到 reject 而非静默成功。
    //
    // 注意用 transaction 回调传入的 tx 连接构造服务——真实误用场景就是
    // 调用方把事务连接喂给维护链路；若误用外层 conn，execute 会撞上
    // transaction 持有的连接互斥锁形成等待（better-sqlite3 驱动 mutex
    // 不支持重入），测的不是"SQLite 拒绝事务内 VACUUM"这个防护本身。
    await assert.rejects(() =>
      conn.transaction(async (tx) => {
        await createDbMaintenanceService(tx).runDatabaseMaintenance();
      })
    );
  });
});
