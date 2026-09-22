import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { serializeFileCachePayload } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import { runDeferredFileCacheGc } from "../../src/domain/session-kkv/logic/deferred-file-cache-gc.js";
import type { TdbcConnection } from "@novel-master/core";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 直查 entry 引用行，拿当前 content_hash。 */
async function currentEntryHash(
  conn: TdbcConnection,
  sessionId: string,
  key: string
): Promise<string | null> {
  const rows = await conn.query<{ content_hash: string }>(
    "SELECT content_hash FROM session_file_cache_entry WHERE session_id = ? AND key = ?",
    [sessionId, key]
  );
  return rows.length === 0 ? null : String(rows[0]!.content_hash);
}

/** 直查 blob 表按 hash 的行数。 */
async function blobCountByHash(
  conn: TdbcConnection,
  contentHash: string
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM session_file_cache_blob WHERE content_hash = ?",
    [contentHash]
  );
  return Number(rows[0]!.n);
}

describe("file_cache 缓存 blob 延期 GC", () => {
  it("T-G1 手工制造孤儿 blob：GC 回收无引用行，被引用 blob 保留", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const sk = createSessionKkvService(conn);
    const s1 = `g1a-${testIsolationSuffix()}`;
    const s2 = `g1b-${testIsolationSuffix()}`;
    const s3 = `g1c-${testIsolationSuffix()}`;
    const key = "full:/gc.md";
    const sharedBody = `g1-shared-${testIsolationSuffix()}`;
    const soloBody = `g1-solo-${testIsolationSuffix()}`;

    await sk.set(
      s1,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: sharedBody, mtimeMs: 1 })
    );
    await sk.set(
      s2,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: sharedBody, mtimeMs: 2 })
    );
    await sk.set(
      s3,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: soloBody, mtimeMs: 3 })
    );
    const sharedHash = await currentEntryHash(conn, s1, key);
    const soloHash = await currentEntryHash(conn, s3, key);

    // 手工删掉 s1 的引用行：shared blob 仍被 s2 引用，不是孤儿
    await conn.execute(
      "DELETE FROM session_file_cache_entry WHERE session_id = ?",
      [s1]
    );
    assert.equal(await runDeferredFileCacheGc(conn), 0);
    assert.equal(await blobCountByHash(conn, sharedHash!), 1);
    assert.equal(await blobCountByHash(conn, soloHash!), 1);

    // 再删掉 s2 的引用行：shared blob 成孤儿，GC 回收；solo blob 保留
    await conn.execute(
      "DELETE FROM session_file_cache_entry WHERE session_id = ?",
      [s2]
    );
    assert.equal(await runDeferredFileCacheGc(conn), 1);
    assert.equal(await blobCountByHash(conn, sharedHash!), 0);
    assert.equal(await blobCountByHash(conn, soloHash!), 1);
    // 幂等：重复执行删 0 行
    assert.equal(await runDeferredFileCacheGc(conn), 0);
  });

  it("T-G2 sessions.delete 真删链路调度 GC 且不影响仍引用同 blob 的其他会话", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const sk = createSessionKkvService(conn);
    const project = await ctx.projects.create(`P-g2-${testIsolationSuffix()}`);
    const s1 = await ctx.sessions.create(project.id);
    const s2 = await ctx.sessions.create(project.id);
    const s3 = await ctx.sessions.create(project.id);
    const key = "full:/del.md";
    const sharedBody = `g2-shared-${testIsolationSuffix()}`;
    const soloBody = `g2-solo-${testIsolationSuffix()}`;

    await sk.set(
      s1.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: sharedBody, mtimeMs: 1 })
    );
    await sk.set(
      s2.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: sharedBody, mtimeMs: 2 })
    );
    await sk.set(
      s3.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: soloBody, mtimeMs: 3 })
    );
    const sharedHash = await currentEntryHash(conn, s1.id, key);
    const soloHash = await currentEntryHash(conn, s3.id, key);

    // 删独占 body 的 s3：删除事务提交后 GC 被调度，独占 blob 应已被回收
    await ctx.sessions.delete(s3.id);
    assert.equal(await blobCountByHash(conn, soloHash!), 0);

    // 删共享 body 的 s1：s2 仍引用 shared blob，GC 不得误删，s2 命中不受影响
    await ctx.sessions.delete(s1.id);
    assert.equal(await currentEntryHash(conn, s1.id, key), null);
    assert.equal(await blobCountByHash(conn, sharedHash!), 1);
    assert.equal(
      await sk.get(s2.id, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      serializeFileCachePayload({ body: sharedBody, mtimeMs: 2 })
    );
  });
});
