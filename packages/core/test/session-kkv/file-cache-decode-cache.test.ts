/**
 * session-kkv file_cache 解压产物缓存集成用例（进程内统一层的读链之二）。
 *
 * 手法与 vfs 侧同款（投毒 + 反向锁，说明见
 * `test/vfs/content-store-decode-cache.test.ts` 文件头）：blob 行换成
 * 解压必失败的字节——读到了原正文就只可能来自内存层。
 *
 * 另有两个本链独有的口径断言：
 * - **payload 是「内存正文 + entry 行 mtime」现拼**：只缓存解压产物（正文），
 *   不缓存整条 payload——改 entry 行的 mtime 后命中项必须看到新 mtime；
 * - **全命中时连 blob 表 SQL 都不发**（SQL 计数连接，workplace 批次读形态）。
 *
 * @module test/session-kkv/file-cache-decode-cache
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  parseFileCachePayload,
  serializeFileCachePayload,
} from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { clearDecodedContentCaches } from "@/infra/content-cache/logic/decoded-content-cache.js";
import {
  openSqlCountingNovelMasterTestConnection,
  type SqlCounter,
} from "../helpers/sql-counting-connection.js";
import type { NovelMasterTestContext } from "../helpers/novel-master.js";
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

/** 把 file_cache blob 行的指定 hash 换成解压必失败的字节。 */
async function corruptFileCacheBlob(
  conn: { execute(sql: string, params?: readonly unknown[]): Promise<unknown> },
  contentHash: string
): Promise<void> {
  await conn.execute(
    `UPDATE session_file_cache_blob SET bytes = ?, encoding = 'zlib'
     WHERE content_hash = ?`,
    [new Uint8Array([1, 2, 3]), contentHash]
  );
}

/** 取某会话 file_cache 键当前指向的 content_hash。 */
async function entryHash(
  conn: { query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> },
  sessionId: string,
  key: string
): Promise<string> {
  const rows = await conn.query<{ content_hash: string }>(
    `SELECT content_hash FROM session_file_cache_entry
     WHERE session_id = ? AND key = ?`,
    [sessionId, key]
  );
  assert.equal(rows.length, 1, "entry 引用行应存在");
  return String(rows[0]!.content_hash);
}

describe("file_cache × 进程内解压产物层", () => {
  it("第二次 get 走内存：blob 被投毒仍读到原正文；mtime 取自 entry 行现拼", async () => {
    clearDecodedContentCaches();
    const { conn } = getNovelMasterTestContext();
    const sessionKkv = createSessionKkvService(conn);
    const sessionId = `s-${testIsolationSuffix()}`;
    const key = `full:/正文-${testIsolationSuffix()}.md`;
    const body = `文件正文-${testIsolationSuffix()}：${"段落内容\n".repeat(70)}`;

    await sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body, mtimeMs: 1000 })
    );
    const first = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key
    );
    assert.equal(parseFileCachePayload(first!)!.body, body);

    const hash = await entryHash(conn, sessionId, key);
    await corruptFileCacheBlob(conn, hash);

    // mtime 改成另一个值：缓存的是正文、mtime 每次从 entry 行现拿
    await conn.execute(
      `UPDATE session_file_cache_entry SET mtime_ms = 2000
       WHERE session_id = ? AND key = ?`,
      [sessionId, key]
    );
    const second = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key
    );
    const payload = parseFileCachePayload(second!)!;
    assert.equal(payload.body, body, "正文命中内存层（blob 已投毒）");
    assert.equal(payload.mtimeMs, 2000, "mtime 是行上的新值，不是缓存里的旧值");

    // 反向锁：清池后再读 → 投毒的 blob 解压失败 → 按 miss 自愈返回 null
    clearDecodedContentCaches();
    assert.equal(
      await sessionKkv.get(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      null
    );
  });

  it("getMany：部分命中时命中项不吃投毒、未命中项照常解压", async () => {
    clearDecodedContentCaches();
    const { conn } = getNovelMasterTestContext();
    const sessionKkv = createSessionKkvService(conn);
    const sessionId = `s-${testIsolationSuffix()}`;
    const cachedKey = `full:/已读-${testIsolationSuffix()}.md`;
    const freshKey = `full:/未读-${testIsolationSuffix()}.md`;
    const cachedBody = `已读正文-${testIsolationSuffix()}`;
    const freshBody = `未读正文-${testIsolationSuffix()}`;

    await sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      cachedKey,
      serializeFileCachePayload({ body: cachedBody, mtimeMs: 11 })
    );
    await sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      freshKey,
      serializeFileCachePayload({ body: freshBody, mtimeMs: 22 })
    );

    // 只把 cachedKey 读一次（进池），freshKey 保持未读
    const single = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      cachedKey
    );
    assert.equal(parseFileCachePayload(single!)!.body, cachedBody);
    const cachedHash = await entryHash(conn, sessionId, cachedKey);
    await corruptFileCacheBlob(conn, cachedHash);

    const batch = await sessionKkv.getMany(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, [
      cachedKey,
      freshKey,
    ]);
    assert.equal(
      parseFileCachePayload(batch.get(cachedKey)!)!.body,
      cachedBody,
      "命中项走内存（blob 已投毒）"
    );
    assert.equal(
      parseFileCachePayload(batch.get(freshKey)!)!.body,
      freshBody,
      "未命中项照常读库解压"
    );
  });

  it("全命中时连 blob 表 SQL 都不发（workplace 批次读形态）", async () => {
    clearDecodedContentCaches();
    const ctx = countingCtx!;
    const sessionKkv = createSessionKkvService(ctx.conn);
    const sessionId = `s-count-${testIsolationSuffix()}`;
    const keys = [1, 2, 3].map((n) => `full:/f${n}-${testIsolationSuffix()}.md`);
    for (const [index, key] of keys.entries()) {
      await sessionKkv.set(
        sessionId,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        key,
        serializeFileCachePayload({
          body: `第 ${index} 个文件正文-${testIsolationSuffix()}`,
          mtimeMs: index,
        })
      );
    }

    // 第一次读：entry 行 + blob 行各一趟
    ctx.counter.clear();
    const first = await sessionKkv.getMany(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      keys
    );
    assert.equal(first.size, 3);
    assert.equal(
      ctx.counter.countBySubstring("FROM session_file_cache_blob"),
      1,
      "首读（池空）要发一趟 blob 批量查询"
    );

    // 第二次读：正文全在内存 → blob 查询一条都不发（entry 行照查，它是身份来源）。
    // 按键逐条比对（Map 迭代序不是缓存语义的一部分）。
    ctx.counter.clear();
    const second = await sessionKkv.getMany(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      keys
    );
    assert.equal(second.size, first.size);
    for (const [key, value] of first) {
      assert.equal(second.get(key), value);
    }
    assert.equal(
      ctx.counter.countBySubstring("FROM session_file_cache_blob"),
      0,
      "全命中还发 blob 查询 = 内存层没接上（本用例的牙齿）"
    );
    assert.equal(
      ctx.counter.countBySubstring("FROM session_file_cache_entry"),
      1,
      "entry 行查询保留（hash/mtime 的身份来源）"
    );
  });
});
