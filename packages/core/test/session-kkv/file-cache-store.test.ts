import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  RULE_SNAPSHOT_CANON_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { serializeFileCachePayload } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import type { TdbcConnection } from "@novel-master/core";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 直查 entry 引用行，拿当前 content_hash（断言引用转移用）。 */
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

/** 直查 blob 表按 hash 的行数（断言单份存储 / 旧 blob 保留用）。 */
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

describe("session file_cache 分流存储（两新表）", () => {
  it("T-R1 set→get 逐字节还原（中文 body、任意 mtimeMs）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r1-${testIsolationSuffix()}`;
    const value = serializeFileCachePayload({
      body: "【第一章】夜色渐深，少年推开客栈的木门……\n\t第二行带转义 \"引号\" 与 \\ 反斜杠",
      mtimeMs: 1758576000123,
    });

    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/小说/第一章.md", value);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/小说/第一章.md"),
      value
    );
  });

  it("T-R2 两会话 set 同 body 不同 mtime：blob 表恰一行，两 entry 各自还原各自 mtime", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const s1 = `r2a-${testIsolationSuffix()}`;
    const s2 = `r2b-${testIsolationSuffix()}`;
    const body = `shared-body-${testIsolationSuffix()}`;
    const key = "full:/shared.md";

    await sk.set(
      s1,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body, mtimeMs: 111 })
    );
    await sk.set(
      s2,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body, mtimeMs: 222 })
    );

    const hash = await currentEntryHash(ctx.conn, s1, key);
    assert.notEqual(hash, null);
    assert.equal(await blobCountByHash(ctx.conn, hash!), 1);

    assert.equal(
      await sk.get(s1, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      serializeFileCachePayload({ body, mtimeMs: 111 })
    );
    assert.equal(
      await sk.get(s2, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      serializeFileCachePayload({ body, mtimeMs: 222 })
    );
  });

  it("T-R3 同 key 两次 set 不同 body：entry 引用转移新 hash，旧 blob 保留", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r3-${testIsolationSuffix()}`;
    const key = "full:/evict.md";
    const oldBody = `old-body-${testIsolationSuffix()}`;
    const newBody = `new-body-${testIsolationSuffix()}`;

    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: oldBody, mtimeMs: 1 })
    );
    const oldHash = await currentEntryHash(ctx.conn, sid, key);

    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: newBody, mtimeMs: 2 })
    );
    const newHash = await currentEntryHash(ctx.conn, sid, key);

    assert.notEqual(oldHash, null);
    assert.notEqual(newHash, null);
    assert.notEqual(oldHash, newHash);
    // entry 已指向新 hash，旧 blob 行保留待 GC（不误删）
    assert.equal(await blobCountByHash(ctx.conn, oldHash!), 1);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      serializeFileCachePayload({ body: newBody, mtimeMs: 2 })
    );
  });

  it("T-R4 clearDomain(file_cache) 只删该会话 entry 行，blob 与其他会话 entry 不动", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const s1 = `r4a-${testIsolationSuffix()}`;
    const s2 = `r4b-${testIsolationSuffix()}`;
    const body = `keep-body-${testIsolationSuffix()}`;
    const key = "full:/keep.md";

    await sk.set(
      s1,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body, mtimeMs: 1 })
    );
    await sk.set(
      s2,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body, mtimeMs: 2 })
    );
    const hash = await currentEntryHash(ctx.conn, s1, key);

    await sk.clearDomain(s1, SESSION_KKV_DOMAIN_FILE_CACHE);

    assert.equal(await currentEntryHash(ctx.conn, s1, key), null);
    assert.notEqual(await currentEntryHash(ctx.conn, s2, key), null);
    assert.equal(await blobCountByHash(ctx.conn, hash!), 1);
    assert.equal(
      await sk.get(s2, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      serializeFileCachePayload({ body, mtimeMs: 2 })
    );
  });

  it("T-R5 clearSession 删全部 entry 行；listKeys 返回键集合", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r5-${testIsolationSuffix()}`;

    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "header:/b.md",
      serializeFileCachePayload({ body: "b", mtimeMs: 1 })
    );
    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/a.md",
      serializeFileCachePayload({ body: "a", mtimeMs: 2 })
    );
    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
      "[]"
    );

    assert.deepEqual(
      await sk.listKeys(sid, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["full:/a.md", "header:/b.md"]
    );

    await sk.clearSession(sid);

    assert.deepEqual(await sk.listKeys(sid, SESSION_KKV_DOMAIN_FILE_CACHE), []);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md"),
      null
    );
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY),
      null
    );
  });

  it("T-R6 直查删掉 blob 行后 get 返回 null 不抛异常（自愈路径）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r6-${testIsolationSuffix()}`;
    const key = "full:/heal.md";

    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload({ body: `heal-${testIsolationSuffix()}`, mtimeMs: 1 })
    );
    const hash = await currentEntryHash(ctx.conn, sid, key);
    assert.notEqual(hash, null);

    await ctx.conn.execute(
      "DELETE FROM session_file_cache_blob WHERE content_hash = ?",
      [hash!]
    );

    const got = await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key);
    assert.equal(got, null);
  });

  it("非 FileCachePayload 形态的 value 走旧表退化路径 get 逐字节还原", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `legacy-${testIsolationSuffix()}`;
    const key = "full:/legacy.md";
    // codec 对非合法 FileCachePayload JSON 返回 null → repository 退回旧表存储
    const value = "not-a-json-payload::raw";

    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key),
      value
    );

    // 存储位置断言：旧表有行，新表 entry 无引用行
    const legacyRows = await ctx.conn.query<{ value: string }>(
      "SELECT value FROM session_kkv_entry WHERE session_id = ? AND domain = ? AND key = ?",
      [sid, SESSION_KKV_DOMAIN_FILE_CACHE, key]
    );
    assert.equal(legacyRows.length, 1);
    assert.equal(legacyRows[0]!.value, value);
    assert.equal(await currentEntryHash(ctx.conn, sid, key), null);

    // 退化行的 key 必须并入 listKeys（T-CC4/T-IC3 以裸字符串预置缓存的
    // 既有口径：任意字符串 set 后 listKeys 都要能列出，含新旧表混存合并）。
    const blobKey = `full:/blob-${testIsolationSuffix()}.md`;
    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      blobKey,
      JSON.stringify({ body: "blob-body", mtimeMs: 1 })
    );
    assert.deepEqual(
      await sk.listKeys(sid, SESSION_KKV_DOMAIN_FILE_CACHE).then((keys) => keys.sort()),
      [blobKey, key].sort()
    );
  });
});
