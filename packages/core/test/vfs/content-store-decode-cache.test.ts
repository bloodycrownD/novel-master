/**
 * vfs content-store 解压产物缓存集成用例（进程内统一层的读链之一）。
 *
 * 手法说明（三条用例共用的「投毒 + 反向锁」）：把 blob 行的字节改成垃圾——
 * 若真去解压必失败。于是
 * - 读到了原正文 ⇒ 只可能来自内存层（真命中）；
 * - 清空内存层后再读必然失败/读不到 ⇒ 证明上一次确实是内存命中，
 *   而不是「库里恰好还是好数据」的巧合（反向锁，防恒真断言）。
 *
 * @module test/vfs/content-store-decode-cache
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  parseFileCachePayload,
  serializeFileCachePayload,
} from "@/domain/workplace/logic/rule-snapshot-codec.js";
import {
  clearDecodedContentCaches,
  decodedContentCacheStats,
} from "@/infra/content-cache/logic/decoded-content-cache.js";
import {
  openSqlCountingNovelMasterTestConnection,
  type SqlCounter,
} from "../helpers/sql-counting-connection.js";
import type { NovelMasterTestContext } from "../helpers/novel-master.js";
import type { TdbcConnection } from "@novel-master/core";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

// SQL 计数用例要一条自己的连接（fixture 的 ctx.conn 未装饰）。
let countingCtx:
  | (NovelMasterTestContext & { readonly counter: SqlCounter })
  | undefined;
before(async () => {
  countingCtx = await openSqlCountingNovelMasterTestConnection();
});
after(async () => {
  await countingCtx!.conn.close();
  countingCtx = undefined;
});

/** 把某张 blob 表的指定 hash 行换成解压必失败的字节。 */
async function corruptBlobRow(
  conn: TdbcConnection,
  table: "vfs_content_blob" | "session_file_cache_blob",
  contentHash: string
): Promise<void> {
  await conn.execute(
    `UPDATE ${table} SET bytes = ?, encoding = 'zlib' WHERE content_hash = ?`,
    [new Uint8Array([1, 2, 3]), contentHash]
  );
}

describe("vfs content-store × 进程内解压产物层", () => {
  it("第二次 get 走内存：blob 行被投毒仍读到原正文；清池后必失败（反向锁）", async () => {
    clearDecodedContentCaches();
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const plain = `vfs 正文-${testIsolationSuffix()}：${"行内容\n".repeat(80)}`;
    const hash = await store.put(plain);

    // 第一次读：真解压，同时回填内存层
    assert.equal(await store.get(hash), plain);
    const afterFirst = decodedContentCacheStats().find(
      (s) => s.name === "content-body"
    );
    assert.ok(afterFirst != null && afterFirst.entries > 0, "首读后应已入池");

    await corruptBlobRow(conn, "vfs_content_blob", hash);
    assert.equal(
      await store.get(hash),
      plain,
      "第二次读命中内存层（没有碰被投毒的 blob）"
    );

    // 反向锁：清掉内存层再读 → 必须撞上脏数据（证明上一条不是巧合）
    clearDecodedContentCaches();
    await assert.rejects(() => store.get(hash));
  });

  it("getMany：内存命中的 hash 参与结果但不解压，未命中的照常读库", async () => {
    clearDecodedContentCaches();
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const cachedPlain = `命中正文-${testIsolationSuffix()}`;
    const freshPlain = `未命中正文-${testIsolationSuffix()}`;
    const cachedHash = await store.put(cachedPlain);
    const freshHash = await store.put(freshPlain);

    assert.equal(await store.get(cachedHash), cachedPlain); // 只把第一条读进池
    await corruptBlobRow(conn, "vfs_content_blob", cachedHash);

    const result = await store.getMany([cachedHash, freshHash, cachedHash]);
    assert.equal(result.get(cachedHash), cachedPlain, "命中项来自内存");
    assert.equal(result.get(freshHash), freshPlain, "未命中项照常解压");
    assert.equal(result.size, 2, "重复入参自然去重");
  });

  it("全命中时连 blob 表 SQL 都不发（getMany 的零查询形态）", async () => {
    clearDecodedContentCaches();
    const ctx = countingCtx!;
    const store = new SqliteVfsContentStore(ctx.conn);
    const plains = [1, 2, 3].map((n) => `计数正文-${n}-${testIsolationSuffix()}`);
    const hashes: string[] = [];
    for (const plain of plains) {
      hashes.push(await store.put(plain));
    }

    // 首读（池空）：一趟 blob IN 查询
    ctx.counter.clear();
    const first = await store.getMany(hashes);
    assert.equal(first.size, 3);
    assert.equal(
      ctx.counter.countBySubstring("FROM vfs_content_blob"),
      1,
      "首读要发一趟 blob 批量查询"
    );

    // 二读：全在内存 → 一条 SQL 都不发（getMany 的 toLoad 为空，循环不进）。
    // 按键逐条比对（两次读的 Map 迭代序可能不同：首读按 SQL 行序落值，
    // 二读按入参序落值——不是缓存语义的一部分，别拿 entries 顺序当断言）。
    ctx.counter.clear();
    const second = await store.getMany(hashes);
    assert.equal(second.size, first.size);
    for (const [hash, plain] of first) {
      assert.equal(second.get(hash), plain);
    }
    assert.equal(
      ctx.counter.countBySubstring("FROM vfs_content_blob"),
      0,
      "全命中还发 blob 查询 = 内存层没接上（本用例的牙齿）"
    );
  });

  it("统一层：同一正文在 vfs 与 file_cache 两条存储里共享同一条内存条目", async () => {
    clearDecodedContentCaches();
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const sessionKkv = createSessionKkvService(conn);
    const body = `共享正文-${testIsolationSuffix()}：${"章节正文\n".repeat(60)}`;

    // 两条存储各有自己的 hash 算法，但都是 hashContent(明文)——前提本身有牙
    const vfsHash = await store.put(body);
    const sessionId = `s-${testIsolationSuffix()}`;
    const key = `full:/share-${testIsolationSuffix()}.md`;
    await sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body, mtimeMs: 42 })
    );
    const entryRows = await conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM session_file_cache_entry
       WHERE session_id = ? AND key = ?`,
      [sessionId, key]
    );
    assert.equal(
      String(entryRows[0]!.content_hash),
      vfsHash,
      "两套存储对同一正文算出同一个 hash（共池的前提）"
    );

    // 经 vfs 读一次 → 正文入池
    assert.equal(await store.get(vfsHash), body);
    // 再把 file_cache 侧的 blob 投毒：若 file_cache 读链自己去解压必失败
    await corruptBlobRow(conn, "session_file_cache_blob", vfsHash);

    const raw = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key
    );
    assert.notEqual(raw, null);
    const payload = parseFileCachePayload(raw!);
    assert.equal(payload!.body, body, "file_cache 读链直接吃了 vfs 侧解出来的正文");
    assert.equal(payload!.mtimeMs, 42, "mtime 仍来自 entry 行，不进内存池");

    // 反向锁：清池后 file_cache 读链自己解压 → 解压失败按 miss 自愈（返回 null）
    clearDecodedContentCaches();
    assert.equal(
      await sessionKkv.get(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      null,
      "投毒行真的坏（清池后读不到），上一条命中确属内存层"
    );
  });
});
