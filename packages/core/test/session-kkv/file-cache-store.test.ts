import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  RULE_SNAPSHOT_CANON_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { serializeFileCachePayload } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import {
  compressFileCacheBodyForBlob,
  hashFileCachePayload,
} from "../../src/domain/session-kkv/logic/file-cache-blob-codec.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import { VFS_CONTENT_ENCODING_ZLIB_B64 } from "../../src/domain/vfs/content-store/logic/blob-bytes-codec.js";
import { VFS_CONTENT_ENCODING_ZLIB } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import type { TdbcConnection } from "@novel-master/core";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 构造 quick-sqlite 时代写入的 base64 文本行内容（bytes 列的 TEXT 形态）。 */
function legacyB64Text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * 夹具版「hash + 压缩」组合：直插 SQL 造存量 blob / entry 行所需的
 * contentHash、压缩 bytes 与 mtimeMs。原 codec 导出 encodeFileCacheValue
 * 已删（repository 只用拆分后的两函数），本 helper 是它在测试侧的等价物。
 */
function encodeFileCacheValueForFixture(value: string): {
  contentHash: string;
  encoding: string;
  bytes: Uint8Array;
  byteLen: number;
  mtimeMs: number;
} | null {
  const hashed = hashFileCachePayload(value);
  if (hashed == null) {
    return null;
  }
  const blob = compressFileCacheBodyForBlob(hashed.body);
  return {
    contentHash: hashed.contentHash,
    encoding: blob.encoding,
    bytes: blob.bytes,
    byteLen: blob.byteLen,
    mtimeMs: hashed.mtimeMs,
  };
}

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

describe("file-cache-blob-codec 拆分（先哈希后压缩）", () => {
  it("hashFileCachePayload：hash/mtime/body 三件套；非 payload 形态返回 null", () => {
    const value = serializeFileCachePayload({body: "正文", mtimeMs: 42});
    const hashed = hashFileCachePayload(value);
    assert.notEqual(hashed, null);
    assert.equal(hashed!.mtimeMs, 42);
    assert.equal(hashed!.body, "正文");
    assert.equal(
      hashed!.contentHash,
      hashContent("正文"),
      "hash 与 vfs 共享 hashContent 同源（sha256(body)，mtime 不参与）"
    );
    assert.equal(hashFileCachePayload("not-a-payload"), null);
  });

  it("compressFileCacheBodyForBlob：zlib 二进制形态（encoding/bytes 一致）", () => {
    const blob = compressFileCacheBodyForBlob("正文");
    assert.equal(blob.encoding, VFS_CONTENT_ENCODING_ZLIB);
    assert.equal(blob.byteLen, blob.bytes.byteLength);
  });

  it("T-R-skip：blob 已存在时重复 set 仍逐字节还原（存在性检查路径不破坏写合同）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `skip-${testIsolationSuffix()}`;
    const value = serializeFileCachePayload({body: "压缩后回填的常见形态", mtimeMs: 7});
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", value);
    // 清 entry 模拟压缩/置位清域（blob 表全库共享、clearDomain 只删 entry），
    // 再 set 同内容 → 走「blob 已存在跳过压缩」路径。
    await sk.clearDomain(sid, SESSION_KKV_DOMAIN_FILE_CACHE);
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", value);
    const got = await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md");
    assert.equal(got, value);
    assert.equal(await blobCountByHash(ctx.conn, hashFileCachePayload(value)!.contentHash), 1);
  });

  it("T-R-skip2 免重压缩 DB 契约：同内容两会话各 set 一次，blob 单份、两 entry 均在", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const s1 = `skip2a-${testIsolationSuffix()}`;
    const s2 = `skip2b-${testIsolationSuffix()}`;
    const key = "full:/skip2.md";
    const value = serializeFileCachePayload({
      body: `skip2-body-${testIsolationSuffix()}`,
      mtimeMs: 9,
    });

    await sk.set(s1, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);
    // 第二次 set 同 hash：存在性检查命中即短路，压缩产物根本不产生、不落行。
    await sk.set(s2, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);

    // DB 可观测契约：blob 按内容单份存储。本文件共享一个内存库（早前用例
    // 已写入 blob 行），全表 COUNT(*) 恰为 1 的写法不可用，按 hash 计数——
    // body 带 testIsolationSuffix 唯一，按 hash 计数与全表计数等价。
    const hash = hashFileCachePayload(value)!.contentHash;
    assert.equal(await blobCountByHash(ctx.conn, hash), 1, "第二次 set 未产生新 blob 行");
    assert.notEqual(await currentEntryHash(ctx.conn, s1, key), null, "s1 的 entry 引用行在");
    assert.notEqual(await currentEntryHash(ctx.conn, s2, key), null, "s2 的 entry 引用行在");
    // 观测极限备注：INSERT OR IGNORE 本身也保证同 hash 不落新行，「压缩被
    // 跳过」与「压缩后被 IGNORE」在 DB 层不可区分；本断言钉死的是单份
    // 存储契约 + 两会话引用都在，是无 spy 约束下最强的可观测形态。
  });
});

describe("getMany 批量读（两条 IN 查询替代逐键两跳）", () => {
  it("T-M1 多键混合命中/未命中：命中逐字节还原、miss 键不进结果", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m1-${testIsolationSuffix()}`;
    const v1 = serializeFileCachePayload({ body: "甲文件内容", mtimeMs: 1 });
    const v2 = serializeFileCachePayload({ body: "乙文件内容", mtimeMs: 2 });
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", v1);
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/b.md", v2);

    const got = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, [
      "full:/a.md",
      "full:/b.md",
      "full:/missing.md",
      "full:/a.md", // 重复键去重
    ]);
    assert.equal(got.size, 2);
    assert.equal(got.get("full:/a.md"), v1);
    assert.equal(got.get("full:/b.md"), v2);
    assert.equal(got.has("full:/missing.md"), false);
  });

  it("T-M2 与单键 get 结果一致（含 mtime 还原）；空键数组返回空 Map", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m2-${testIsolationSuffix()}`;
    const value = serializeFileCachePayload({ body: "中文正文", mtimeMs: 1758576000123 });
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "header:/c.md", value);
    const single = await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "header:/c.md");
    const batch = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, ["header:/c.md"]);
    assert.equal(batch.get("header:/c.md"), single);

    const empty = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, []);
    assert.equal(empty.size, 0);
  });

  it("T-M3 非 file_cache 域走旧表批量（rule_snapshot canon 等普通域）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m3-${testIsolationSuffix()}`;
    await sk.set(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, "[]");
    await sk.set(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, "other", "x");
    const got = await sk.getMany(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, [
      RULE_SNAPSHOT_CANON_KEY,
      "other",
      "nope",
    ]);
    assert.equal(got.size, 2);
    assert.equal(got.get(RULE_SNAPSHOT_CANON_KEY), "[]");
    assert.equal(got.get("other"), "x");
  });

  it("T-M4 超 400 键跨片：种 450 键全量 getMany，450 全命中且值正确", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m4-${testIsolationSuffix()}`;
    const suffix = testIsolationSuffix();
    const keys: string[] = [];
    const expected = new Map<string, string>();
    for (let i = 0; i < 450; i++) {
      const key = `full:/bulk-${i}.md`;
      const value = serializeFileCachePayload({
        body: `m4-body-${suffix}-${i}`,
        mtimeMs: i,
      });
      keys.push(key);
      expected.set(key, value);
      await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);
    }

    // 450 键 > GET_MANY_CHUNK_SIZE(400)：实现内部切成 400 + 50 两片，
    // 两片的命中与 miss 归并都要正确——此处全量命中，逐键核对值。
    const got = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, keys);
    assert.equal(got.size, 450);
    for (const [key, value] of expected) {
      assert.equal(got.get(key), value, `键 ${key} 未命中或值不符`);
    }
  });

  it("T-M5 entry 行在而 blob 行被删：getMany 该键 miss，不回退旧表", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m5-${testIsolationSuffix()}`;
    const key = "full:/no-blob.md";
    const value = serializeFileCachePayload({
      body: `m5-body-${testIsolationSuffix()}`,
      mtimeMs: 1,
    });

    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);
    const hash = await currentEntryHash(ctx.conn, sid, key);
    assert.notEqual(hash, null);

    // 埋哨兵旧表行：若实现错误地把「entry 在而 blob 缺失」的键回退旧表，
    // 会读到哨兵值——正确语义是与单键 get 同口径的 miss（上层自愈重读）。
    await ctx.conn.execute(
      "INSERT INTO session_kkv_entry (session_id, domain, key, value) VALUES (?, ?, ?, ?)",
      [sid, SESSION_KKV_DOMAIN_FILE_CACHE, key, "sentinel-legacy-value"]
    );
    await ctx.conn.execute(
      "DELETE FROM session_file_cache_blob WHERE content_hash = ?",
      [hash!]
    );

    const got = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, [key]);
    assert.equal(got.size, 0, "blob 行缺失按 miss 处理，不得回退旧表读哨兵值");
  });

  it("T-M6 blob 行 bytes 非法 zlib：该键 miss 且不影响同批其他键", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m6-${testIsolationSuffix()}`;
    const corruptKey = "full:/corrupt-batch.md";
    const healthyKey = "full:/healthy-batch.md";
    const corruptValue = serializeFileCachePayload({
      body: `m6-corrupt-${testIsolationSuffix()}`,
      mtimeMs: 1,
    });
    const healthyValue = serializeFileCachePayload({
      body: `m6-healthy-${testIsolationSuffix()}`,
      mtimeMs: 2,
    });

    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, corruptKey, corruptValue);
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, healthyKey, healthyValue);
    const corruptHash = await currentEntryHash(ctx.conn, sid, corruptKey);
    assert.notEqual(corruptHash, null);

    // 破坏手法照 T-R8：合法 base64 文本但解出的字节不是 zlib 流（解压必失败），
    // 这里用 UPDATE 把真实 set 落下的 blob 行改坏，贴近「存量行损坏」形态。
    const badB64 = legacyB64Text(Uint8Array.of(0x00, 0x01, 0x02, 0x03));
    await ctx.conn.execute(
      "UPDATE session_file_cache_blob SET encoding = ?, bytes = ?, byte_len = ? WHERE content_hash = ?",
      [VFS_CONTENT_ENCODING_ZLIB_B64, badB64, badB64.length, corruptHash!]
    );
    await ctx.conn.execute(
      "INSERT INTO session_kkv_entry (session_id, domain, key, value) VALUES (?, ?, ?, ?)",
      [sid, SESSION_KKV_DOMAIN_FILE_CACHE, corruptKey, "sentinel-legacy-value"]
    );

    const got = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, [
      corruptKey,
      healthyKey,
    ]);
    assert.equal(got.size, 1, "坏行只 miss 自己，不拖垮同批其他键");
    assert.equal(got.has(corruptKey), false, "decode 失败按 miss，不回退旧表哨兵值");
    assert.equal(got.get(healthyKey), healthyValue);
  });

  it("T-M7 新旧表混合：新表键命中 + 旧表键经 missing 回退 getManyLegacy 命中", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `m7-${testIsolationSuffix()}`;
    // 非 FileCachePayload 形态的 value 走退化路径落在旧表（session_kkv_entry）。
    const legacyKey = "full:/old-table.md";
    const legacyValue = `legacy-raw-${testIsolationSuffix()}::not-a-payload`;
    const newKey = "full:/new-table.md";
    const newValue = serializeFileCachePayload({
      body: `m7-body-${testIsolationSuffix()}`,
      mtimeMs: 5,
    });

    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, legacyKey, legacyValue);
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, newKey, newValue);

    const got = await sk.getMany(sid, SESSION_KKV_DOMAIN_FILE_CACHE, [
      newKey,
      legacyKey,
    ]);
    assert.equal(got.size, 2);
    assert.equal(got.get(newKey), newValue, "新表键两跳 IN 查询命中");
    assert.equal(got.get(legacyKey), legacyValue, "旧表键经 missing 回退 getManyLegacy 命中");
  });
});

describe("session file_cache 分流存储（两新表）", () => {
  it("T-R1 set→get 逐字节还原（中文 body、任意 mtimeMs）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r1-${testIsolationSuffix()}`;
    const value = serializeFileCachePayload({
      body: '【第一章】夜色渐深，少年推开客栈的木门……\n\t第二行带转义 "引号" 与 \\ 反斜杠',
      mtimeMs: 1758576000123,
    });

    await sk.set(
      sid,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/小说/第一章.md",
      value
    );
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

    assert.deepEqual(await sk.listKeys(sid, SESSION_KKV_DOMAIN_FILE_CACHE), [
      "full:/a.md",
      "header:/b.md",
    ]);

    await sk.clearSession(sid);

    assert.deepEqual(await sk.listKeys(sid, SESSION_KKV_DOMAIN_FILE_CACHE), []);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md"),
      null
    );
    assert.equal(
      await sk.get(
        sid,
        SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
        RULE_SNAPSHOT_CANON_KEY
      ),
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
      serializeFileCachePayload({
        body: `heal-${testIsolationSuffix()}`,
        mtimeMs: 1,
      })
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
    assert.equal(await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key), value);

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
      await sk
        .listKeys(sid, SESSION_KKV_DOMAIN_FILE_CACHE)
        .then((keys) => keys.sort()),
      [blobKey, key].sort()
    );
  });

  it("T-BB1 编码组合（hash+压缩）恒落二进制：bytes 为 Uint8Array、encoding=zlib、byteLen 为二进制长度", () => {
    const value = serializeFileCachePayload({
      body: `new-write-binary-${testIsolationSuffix()}-中文`,
      mtimeMs: 1758576000456,
    });

    const encoded = encodeFileCacheValueForFixture(value);
    assert.notEqual(encoded, null);
    assert.equal(encoded!.encoding, VFS_CONTENT_ENCODING_ZLIB);
    assert.ok(encoded!.bytes instanceof Uint8Array);
    assert.equal(typeof encoded!.bytes, "object");
    // byte_len 是落库字节的物理长度，不是 base64 文本长度。
    assert.equal(encoded!.byteLen, encoded!.bytes.byteLength);
  });

  it("T-BB1b set 落库：blob 行为 encoding=zlib 二进制（TYPEOF(bytes)=blob，byte_len 物理长度）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r7b-${testIsolationSuffix()}`;
    const key = "full:/new-binary.md";
    const value = serializeFileCachePayload({
      body: `new-binary-body-${testIsolationSuffix()}-中文`,
      mtimeMs: 1758576000456,
    });

    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);
    assert.equal(await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key), value);

    const hash = await currentEntryHash(ctx.conn, sid, key);
    assert.notEqual(hash, null);
    const rows = await ctx.conn.query<{
      encoding: string;
      bytes: Uint8Array;
      byte_len: number;
      bytes_type: string;
    }>(
      "SELECT encoding, bytes, byte_len, TYPEOF(bytes) AS bytes_type FROM session_file_cache_blob WHERE content_hash = ?",
      [hash!]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.encoding, VFS_CONTENT_ENCODING_ZLIB);
    assert.equal(rows[0]!.bytes_type, "blob");
    assert.ok(rows[0]!.bytes instanceof Uint8Array);
    assert.equal(Number(rows[0]!.byte_len), rows[0]!.bytes.byteLength);
  });

  it("T-R7 存量 zlib-b64 文本行：get 还原原文（RN 旧版落库形态）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r7-${testIsolationSuffix()}`;
    const key = "full:/rn-b64.md";
    const value = serializeFileCachePayload({
      body: `rn-b64-body-${testIsolationSuffix()}-中文`,
      mtimeMs: 1758576000456,
    });

    // 夹具编码（hash+压缩组合）恒落二进制，存量 b64 文本行只能用直插 SQL
    // 构造：复用组合取 contentHash，把二进制 bytes 转成 base64 文本模拟 RN
    // 旧版落库形态。
    const encoded = encodeFileCacheValueForFixture(value);
    assert.notEqual(encoded, null);
    const b64 = legacyB64Text(encoded!.bytes);

    // 手工 INSERT 模拟 RN 存量库：blob 行（TEXT bytes）+ entry 引用行。
    await ctx.conn.execute(
      "INSERT INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (?, ?, ?, ?)",
      [encoded!.contentHash, VFS_CONTENT_ENCODING_ZLIB_B64, b64, b64.length],
    );
    await ctx.conn.execute(
      "INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms) VALUES (?, ?, ?, ?)",
      [sid, key, encoded!.contentHash, encoded!.mtimeMs]
    );

    // 前置形态断言：夹具若误建成二进制，读路径兜底分支同样能还原，
    // 用例会绿但没测到存量 base64 文本这条路——先把形态钉死再谈还原
    // （照 T-BB3 的写法；encoding 顺手写死为 zlib-b64 字面量，与夹具
    // 写入所引常量解耦，常量值漂移时此处先红）。
    const shapeRows = await ctx.conn.query<{
      encoding: string;
      bytes_type: string;
    }>(
      "SELECT encoding, TYPEOF(bytes) AS bytes_type FROM session_file_cache_blob WHERE content_hash = ?",
      [encoded!.contentHash]
    );
    assert.equal(shapeRows.length, 1);
    assert.equal(shapeRows[0]!.encoding, "zlib-b64");
    assert.equal(String(shapeRows[0]!.bytes_type), "text", "前置形态确为 TEXT");

    assert.equal(await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key), value);
  });

  it("T-R9 同 hash 复用不改写存量行：set 命中 INSERT OR IGNORE，存量 zlib-b64 文本行原样保留", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r9-${testIsolationSuffix()}`;
    const key = "full:/reuse-same-hash.md";
    const value = serializeFileCachePayload({
      body: `reuse-body-${testIsolationSuffix()}-中文`,
      mtimeMs: 1758576000321,
    });

    // 构造手法照 T-R7 的直插：先落一行 encoding=zlib-b64 + TEXT 形态的
    // 存量 blob 行，连同对应 entry 引用行（无引用行的 blob 会被 GC 扫掉）。
    const encoded = encodeFileCacheValueForFixture(value);
    assert.notEqual(encoded, null);
    const b64 = legacyB64Text(encoded!.bytes);
    await ctx.conn.execute(
      "INSERT INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (?, ?, ?, ?)",
      [encoded!.contentHash, VFS_CONTENT_ENCODING_ZLIB_B64, b64, b64.length],
    );
    await ctx.conn.execute(
      "INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms) VALUES (?, ?, ?, ?)",
      [sid, key, encoded!.contentHash, encoded!.mtimeMs]
    );

    // 再对同一 contentHash 调 sk.set（同一 value 编码出同一 hash）：blob 写入
    // 必须命中 INSERT OR IGNORE 复用存量行，而不是把已归一前的旧形态改写。
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key, value);

    assert.equal(await blobCountByHash(ctx.conn, encoded!.contentHash), 1, "同 hash 复用：blob 表仍只有 1 行");
    const rows = await ctx.conn.query<{
      encoding: string;
      byte_len: number;
      bytes_type: string;
    }>(
      "SELECT encoding, byte_len, TYPEOF(bytes) AS bytes_type FROM session_file_cache_blob WHERE content_hash = ?",
      [encoded!.contentHash]
    );
    assert.equal(rows[0]!.encoding, "zlib-b64", "encoding 未被改写");
    assert.equal(String(rows[0]!.bytes_type), "text", "TYPEOF(bytes) 未被改写");
    assert.equal(Number(rows[0]!.byte_len), b64.length, "byte_len 未被改写");

    // 反向判据：把实现里的 INSERT OR IGNORE 改成 INSERT OR REPLACE 时本用例
    // 变红——存量 b64 文本行会被新二进制形态整行替换（encoding→zlib、
    // TYPEOF→blob、byte_len 变短），上面三条形态断言先崩。
    assert.equal(await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key), value);
  });

  it("T-BB3 历史脏形态：encoding=zlib 但存 base64 文本，get 还原原文（归一任务跑之前的存量）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `bb3-${testIsolationSuffix()}`;
    const key = "full:/dirty-zlib-text.md";
    const value = serializeFileCachePayload({
      body: `dirty-zlib-text-${testIsolationSuffix()}-中文`,
      mtimeMs: 1758576000789,
    });

    // 与 T-R7 的差别只在 encoding：这里是 quick-sqlite 时代「encoding=zlib
    // 但列里存 base64 文本」的脏形态（归一谓词的 TYPEOF 分支），读路径
    // 必须同样能还原——归一任务跑之前它就是库里的常态。
    const encoded = encodeFileCacheValueForFixture(value);
    assert.notEqual(encoded, null);
    const b64 = legacyB64Text(encoded!.bytes);

    await ctx.conn.execute(
      "INSERT INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (?, ?, ?, ?)",
      [encoded!.contentHash, VFS_CONTENT_ENCODING_ZLIB, b64, b64.length]
    );
    // entry 引用行必须一并插：无引用行的 blob 会被 file_cache GC 扫掉。
    await ctx.conn.execute(
      "INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms) VALUES (?, ?, ?, ?)",
      [sid, key, encoded!.contentHash, encoded!.mtimeMs]
    );

    const rows = await ctx.conn.query<{ bytes_type: string }>(
      "SELECT TYPEOF(bytes) AS bytes_type FROM session_file_cache_blob WHERE content_hash = ?",
      [encoded!.contentHash]
    );
    assert.equal(String(rows[0]!.bytes_type), "text", "前置形态确为 TEXT");

    assert.equal(await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key), value);
  });

  it("T-R8 手工 INSERT 坏字节 blob 行（zlib-b64）：get 返回 null 不抛（解压失败自愈）", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `r8-${testIsolationSuffix()}`;
    const key = "full:/corrupt.md";

    // 坏字节：合法 base64 文本，但解出的字节不是 zlib 流（解压必失败）——
    // 覆盖存量 b64 形态 get 的解压失败分支（T-R6 只覆盖 blob 行整行缺失）。
    const badBytes = legacyB64Text(Uint8Array.of(0x00, 0x01, 0x02, 0x03));
    const encoded = encodeFileCacheValueForFixture(
      serializeFileCachePayload({ body: "unused", mtimeMs: 1 }),
    );
    assert.notEqual(encoded, null);

    await ctx.conn.execute(
      "INSERT INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (?, ?, ?, ?)",
      [
        encoded!.contentHash,
        VFS_CONTENT_ENCODING_ZLIB_B64,
        badBytes,
        badBytes.length,
      ]
    );
    await ctx.conn.execute(
      "INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms) VALUES (?, ?, ?, ?)",
      [sid, key, encoded!.contentHash, encoded!.mtimeMs]
    );

    // repository 捕获解码/解压失败按 miss 自愈返回 null，不向调用方抛异常。
    assert.equal(await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, key), null);
  });
});
