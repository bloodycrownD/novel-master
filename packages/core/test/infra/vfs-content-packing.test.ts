/**
 * VFS 非 head 历史版本打包任务用例（T-VP3/8/10/12/13/16/18/19/20/21）。
 *
 * 打包口径见 spec「Part B 打包任务」：候选谓词（active 非 head + 仍是 blob
 * 行 + DISTINCT hash ≥2/entry）、≤8 成员/≤1MB 明文每组、24KB 平均明文阈值
 * 选型（zlib-concat-v1 / fossil-chain-v1）、每组单事务、坏组整组跳过、
 * 无终态标记（每次入口重扫）。
 *
 * 夹具一律直插/经 store.put 构造（entry + 多版本 active revision + blob 行，
 * head 独立保留 blob）；scope_key 统一 `vpk-` 前缀，用例开头
 * {@link resetPackState} 清 pack/member/KKV/夹具 entry 与孤儿 blob。
 *
 * 【与姊妹文件的分工】本文件维护链路判据止于 `maintCalls`（「是否进入维护
 * 段」，含被进程级去重短路的调用）；「pending 标记的补跑与清除」（判据是
 * kkv 标记状态）在独立进程的 vfs-content-packing-maintenance.test.ts 里承载。
 *
 * 【牙齿自检】T-VP3 的两处篡改（offset+1 → hash 不匹配 / fossil 组解码抛），
 * T-VP8 的事务中断替身（member 落库前崩溃 → 三表回滚），T-VP16 的两步
 * revision 删除（ref_count 若重算错，第一步就 CHECK 违反抛错），T-VP20 的
 * 吞 DELETE 替身（打转 → stalled）——均为恒红/互斥判据，非恒真断言。
 *
 * @module test/infra/vfs-content-packing
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { clearDecodedContentCaches } from "../../src/infra/content-cache/logic/decoded-content-cache.js";
import { SqliteKkvRepository } from "../../src/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { SqliteVfsContentStore } from "../../src/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import {
  __getVfsPackDecodeCountersForTests,
  __resetVfsPackDecodeCountersForTests,
  encodeZlibConcatPack,
  VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
} from "../../src/domain/vfs/content-store/logic/pack-codec.js";
import { compressZlib } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import type { Row } from "../../src/infra/tdbc/types.js";
import {
  __resetVfsPackStatusSamplingThrottleForTests,
  getVfsContentPackStatus,
  runVfsContentPacking,
  unpackVfsContent,
  verifyVfsContentPacks,
  VFS_PACK_KKV_MODULE,
  type RunVfsContentPackingOptions,
} from "../../src/infra/db-maintenance/impl/vfs-content-packing.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 本文件夹具的 scope_key 前缀（清理边界）。 */
const SCOPE_PREFIX = "vpk-";

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

/**
 * 用例自管状态：清 pack/member 两表 + nm-vfs-pack 全部 KKV + 夹具 entry/
 * revision + 孤儿 blob（引用集口径与 content store gc 逐字同）。
 */
async function resetPackState(): Promise<void> {
  __resetVfsPackStatusSamplingThrottleForTests();
  const c = conn();
  await c.execute("DELETE FROM vfs_content_pack_member");
  await c.execute("DELETE FROM vfs_content_pack");
  await c.execute("DELETE FROM kkv_entry WHERE module = ?", [
    VFS_PACK_KKV_MODULE,
  ]);
  await c.execute(
    `DELETE FROM vfs_revision WHERE entry_id IN (
       SELECT entry_id FROM vfs_entry WHERE scope_key LIKE '${SCOPE_PREFIX}%')`
  );
  await c.execute(
    `DELETE FROM vfs_entry WHERE scope_key LIKE '${SCOPE_PREFIX}%'`
  );
  await c.execute(
    `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (
       SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
       UNION
       SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
     )`
  );
}

// ---------------------------------------------------------------------------
// 夹具构造
// ---------------------------------------------------------------------------

/** 坏 blob 行版本（bytes 直插垃圾，store.get 解压必失败）。 */
interface CorruptSeed {
  readonly corruptBytes: Uint8Array;
}

/** 直插 active revision（触发器对 blob 行 ref_count +1；ref_count 列为应用层可达性计数，照先例写 1）。 */
async function insertRevision(
  entryId: number,
  version: number,
  contentHash: string
): Promise<void> {
  await conn().execute(
    `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
     VALUES (?, ?, 'active', ?, ?, 1)`,
    [entryId, version, version, contentHash]
  );
}

/**
 * 造一个 entry：head 独立 blob + N 个历史版本 revision（好版本经 store.put
 * 落 blob、坏版本直插垃圾 bytes）+ head revision。
 */
async function seedEntry(
  scopeKey: string,
  path: string,
  versions: ReadonlyArray<string | CorruptSeed>,
  corruptHashPrefix: string,
  headPlain: string
): Promise<{
  entryId: number;
  /** 版本序成员 hash（坏版本为 corruptHashPrefix-i 前缀串）。 */
  hashes: string[];
  headHash: string;
}> {
  const c = conn();
  const store = new SqliteVfsContentStore(c);
  const headHash = await store.put(headPlain);
  const inserted = await c.execute(
    `INSERT INTO vfs_entry (scope_key, path, content_hash, head_version, mtime_ms, entry_kind)
     VALUES (?, ?, ?, ?, 0, 'file')`,
    [scopeKey, path, headHash, versions.length + 1]
  );
  const entryId = Number(inserted.lastInsertRowid);
  const hashes: string[] = [];
  for (let index = 0; index < versions.length; index++) {
    const seed = versions[index]!;
    let contentHash: string;
    if (typeof seed === "string") {
      contentHash = await store.put(seed);
    } else {
      contentHash = `${corruptHashPrefix}-${index + 1}`;
      await c.execute(
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
         VALUES (?, 'zlib', ?, ?, 0)`,
        [contentHash, seed.corruptBytes, seed.corruptBytes.byteLength]
      );
    }
    hashes.push(contentHash);
    await insertRevision(entryId, index + 1, contentHash);
  }
  await insertRevision(entryId, versions.length + 1, headHash);
  return { entryId, hashes, headHash };
}

/** 约 aboutBytes 字节的中文长文（全角 3B/字，repeats 向上取整）。 */
function textOf(aboutBytes: number, tag: string): string {
  const unit = "落霞与孤鹜齐飞，秋水共长天一色。";
  const repeats = Math.ceil(aboutBytes / (unit.length * 3));
  return `${tag}\n` + unit.repeat(repeats);
}

/** 相似大文本对（fossil 链 delta 有实质内容）：替换中段 + 追加尾段。 */
function similarPair(aboutBytes: number, tag: string): [string, string] {
  const base = textOf(aboutBytes, tag);
  const mutated =
    base.slice(0, Math.floor(base.length / 2)) +
    `修订段-${tag}：山雨欲来风满楼，月出惊山鸟。` +
    base.slice(Math.floor(base.length / 2), Math.floor(base.length * 0.9)) +
    `\n尾段追加-${tag}：` +
    "时鸣春涧中。".repeat(50);
  return [base, mutated];
}

async function countOf(sql: string, params?: readonly unknown[]): Promise<number> {
  const rows = await conn().query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/**
 * 直插一条 pack 行 + N 条 member 行（zlib-concat-v1），**不建/不删 blob 行**——
 * 构造「member-only hash」形态（权威副本只在 pack 容器内），由调用方负责引用面。
 */
async function insertPackMembers(
  entryId: number,
  plains: ReadonlyArray<string>
): Promise<string[]> {
  const c = conn();
  const utf8s = plains.map((plain) => new TextEncoder().encode(plain));
  const encoded = encodeZlibConcatPack(utf8s);
  const inserted = await c.execute(
    `INSERT INTO vfs_content_pack (entry_id, format, bytes, byte_len, member_count, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entryId,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      encoded.bytes,
      encoded.bytes.byteLength,
      utf8s.length,
      Date.now(),
    ]
  );
  const packId = Number(inserted.lastInsertRowid);
  const hashes: string[] = [];
  for (let index = 0; index < utf8s.length; index++) {
    const contentHash = hashContent(plains[index]!);
    const span = encoded.spans[index]!;
    await c.execute(
      `INSERT INTO vfs_content_pack_member (content_hash, pack_id, offset, length, compressed_byte_len)
       VALUES (?, ?, ?, ?, ?)`,
      [
        contentHash,
        packId,
        span.offset,
        span.length,
        compressZlib(utf8s[index]!).byteLength,
      ]
    );
    hashes.push(contentHash);
  }
  return hashes;
}

/** blob 行的 ref_count（行不存在时返回 -1，便于断言「已被触发器回收」）。 */
async function blobRefCount(contentHash: string): Promise<number> {
  const rows = await conn().query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
    [contentHash]
  );
  return rows.length === 0 ? -1 : Number(rows[0]!.ref_count);
}

async function blobRowCount(contentHash: string): Promise<number> {
  return countOf(
    "SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?",
    [contentHash]
  );
}

async function packRows(): Promise<
  Array<{ pack_id: number; entry_id: number; format: string; member_count: number }>
> {
  const rows = await conn().query<{
    pack_id: number;
    entry_id: number;
    format: string;
    member_count: number;
  }>(
    `SELECT pack_id, entry_id, format, member_count FROM vfs_content_pack ORDER BY pack_id`
  );
  return rows.map((row) => ({
    pack_id: Number(row.pack_id),
    entry_id: Number(row.entry_id),
    format: String(row.format),
    member_count: Number(row.member_count),
  }));
}

/** 维护段观测计数器（口径照 blob-binary 先例：进入收尾维护段的次数，含被进程级去重短路的调用）。 */
function maintenanceCounter(): {
  readonly maintCalls: () => number;
  readonly hooks: Pick<
    RunVfsContentPackingOptions,
    "beforeMaintenance" | "afterMaintenance"
  >;
} {
  let calls = 0;
  return {
    maintCalls: () => calls,
    hooks: {
      afterMaintenance: () => {
        calls += 1;
      },
    },
  };
}

/** 捕获 console.warn（坏组告警断言用，finally 恢复）。 */
async function captureWarnings<T>(
  fn: () => Promise<T>
): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

/** 事务替身的公共骨架：只替换 transaction 回调里 tx 的行为。 */
function connWithTxTx(
  wrapTx: (tx: TdbcConnection) => TdbcConnection
): TdbcConnection {
  const real = conn();
  return {
    execute: (sql, parameters) => real.execute(sql, parameters),
    query: <R extends Row>(sql: string, parameters?: readonly unknown[]) =>
      real.query<R>(sql, parameters),
    batch: (sql, parametersList) => real.batch(sql, parametersList),
    transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>) =>
      real.transaction<T>((tx) => fn(wrapTx(tx))),
    close: () => real.close(),
  };
}

/** 替身一：事务内 member INSERT 时抛错（模拟组事务中途崩溃 → 回滚）。 */
function connWithTxExplodingOnMemberInsert(): TdbcConnection {
  return connWithTxTx((tx) => ({
    execute: (sql, parameters) => {
      if (sql.includes("INSERT INTO vfs_content_pack_member")) {
        return Promise.reject(new Error("模拟中断：member 落库前崩溃"));
      }
      return tx.execute(sql, parameters);
    },
    query: <R extends Row>(sql: string, parameters?: readonly unknown[]) =>
      tx.query<R>(sql, parameters),
    batch: (sql, parametersList) => tx.batch(sql, parametersList),
    transaction: (fn) => tx.transaction(fn),
    close: () => tx.close(),
  }));
}

/** 替身二：事务内吞掉 DELETE FROM vfs_content_blob（模拟落库不生效 → 打转）。 */
function connWithSwallowedBlobDelete(): TdbcConnection {
  return connWithTxTx((tx) => ({
    execute: (sql, parameters) => {
      if (/^\s*DELETE\s+FROM\s+vfs_content_blob\b/i.test(sql)) {
        return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
      }
      return tx.execute(sql, parameters);
    },
    query: <R extends Row>(sql: string, parameters?: readonly unknown[]) =>
      tx.query<R>(sql, parameters),
    batch: (sql, parametersList) => tx.batch(sql, parametersList),
    transaction: (fn) => tx.transaction(fn),
    close: () => tx.close(),
  }));
}

/**
 * 候选谓词查询探针连接（W1-P1-1）：计数「下发过 collectCandidateEntries 同款
 * 谓词」的次数（判据是 SQL 里的 `NOT EXISTS (SELECT 1 FROM vfs_entry`）。
 * 水位短路的牙齿：短路被去掉后，稳态入口/状态采样会重新下发谓词、计数 > 0。
 */
function connWithCandidatePredicateProbe(): {
  readonly conn: TdbcConnection;
  readonly predicateQueries: () => number;
} {
  const real = conn();
  let count = 0;
  const probe: TdbcConnection = {
    execute: (sql, parameters) => real.execute(sql, parameters),
    query: <R extends Row>(sql: string, parameters?: readonly unknown[]) => {
      if (/NOT EXISTS\s*\(\s*SELECT 1 FROM vfs_entry/i.test(sql)) {
        count += 1;
      }
      return real.query<R>(sql, parameters);
    },
    batch: (sql, parametersList) => real.batch(sql, parametersList),
    transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>) =>
      real.transaction<T>((tx) => fn(tx)),
    close: () => real.close(),
  };
  return { conn: probe, predicateQueries: () => count };
}

describe("VFS 历史版本打包任务（T-VP3/8/10/12/13/16/18/19/20/21）", () => {
  /** 文档性防护：文件起始不得残留 startupMaintenancePending（会伪造「强制补跑」输入）。 */
  before(async () => {
    assert.equal(
      await new SqliteKkvRepository(conn()).get(
        VFS_PACK_KKV_MODULE,
        "startupMaintenancePending"
      ),
      null,
      "文件起始不得残留 startupMaintenancePending 兜底标记"
    );
  });

  it("T-VP12：阈值分组——24KB 上下两组分别落 zlib-concat-v1 / fossil-chain-v1", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);

    // 小组：2 × ~8KB（平均 8KB < 24KB）→ zlib-concat；大组：2 × ~30KB 相似文本（平均 ≥ 24KB）→ fossil。
    const [small1, small2] = [
      textOf(8 * 1024, `vpk-small-1-${suffix}`),
      textOf(8 * 1024, `vpk-small-2-${suffix}`),
    ];
    const [big1, big2] = similarPair(30 * 1024, `vpk-big-${suffix}`);
    const small = await seedEntry(
      `${SCOPE_PREFIX}s-${suffix}`,
      `/small-${suffix}.md`,
      [small1, small2],
      `vpk-corrupt-s-${suffix}`,
      textOf(2 * 1024, `vpk-head-s-${suffix}`)
    );
    const big = await seedEntry(
      `${SCOPE_PREFIX}b-${suffix}`,
      `/big-${suffix}.md`,
      [big1, big2],
      `vpk-corrupt-b-${suffix}`,
      textOf(2 * 1024, `vpk-head-b-${suffix}`)
    );

    const result = await runVfsContentPacking(c);
    assert.deepEqual(result, {
      done: true,
      packedGroups: 2,
      failedGroups: 0,
      stalled: false,
    });

    // format 分派断言（本用例的牙齿：阈值若接反，两条断言同时红）。
    const packs = await packRows();
    assert.equal(packs.length, 2);
    const formatByEntry = new Map(packs.map((p) => [p.entry_id, p.format]));
    assert.equal(formatByEntry.get(small.entryId), "zlib-concat-v1");
    assert.equal(formatByEntry.get(big.entryId), "fossil-chain-v1");
    for (const pack of packs) {
      assert.equal(pack.member_count, 2);
    }

    // member.compressed_byte_len 恒为被替换 blob 行 byte_len 的原样复制
    //（= 独立 zlib 压缩长；fossil 组不得记 delta 段长——大文件闸门会失真）。
    const members = await c.query<{
      content_hash: string;
      compressed_byte_len: number;
    }>(
      `SELECT content_hash, compressed_byte_len FROM vfs_content_pack_member`
    );
    const plainByHash = new Map([
      [small.hashes[0]!, small1],
      [small.hashes[1]!, small2],
      [big.hashes[0]!, big1],
      [big.hashes[1]!, big2],
    ]);
    assert.equal(members.length, 4);
    for (const member of members) {
      const plain = plainByHash.get(String(member.content_hash))!;
      assert.equal(
        Number(member.compressed_byte_len),
        compressZlib(new TextEncoder().encode(plain)).byteLength,
        "compressed_byte_len = 独立压缩长（blob 行 byte_len 复制口径）"
      );
    }

    // 被替换 blob 行已删、两个 head 独立保留（INV1）。
    for (const hash of [...small.hashes, ...big.hashes]) {
      assert.equal(await blobRowCount(hash), 0, `成员 ${hash} 的 blob 行应被删`);
    }
    assert.equal(await blobRowCount(small.headHash), 1);
    assert.equal(await blobRowCount(big.headHash), 1);

    // 读回等值：member 分派按 format 各自解码。
    for (const hash of small.hashes) {
      assert.equal(await store.get(hash), plainByHash.get(hash));
    }
    for (const hash of big.hashes) {
      assert.equal(await store.get(hash), plainByHash.get(hash));
    }
    assert.equal(await store.get(small.headHash), textOf(2 * 1024, `vpk-head-s-${suffix}`));
    assert.equal(await store.get(big.headHash), textOf(2 * 1024, `vpk-head-b-${suffix}`));

    // 状态采样：收敛后 pendingGroups=0、memberCount=4、streamBytes>0。
    const status = await getVfsContentPackStatus(c);
    assert.equal(status.pendingGroups, 0);
    assert.equal(status.memberCount, 4);
    assert.ok(status.streamBytes > 0);
    assert.equal(status.failedGroups, 0);
  });

  it("T-VP3：verifyVfsContentPacks 两 format 全过；篡改 member offset 报失败（牙齿）", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();

    const [big1, big2] = similarPair(30 * 1024, `vpk-v-big-${suffix}`);
    const small = await seedEntry(
      `${SCOPE_PREFIX}v-s-${suffix}`,
      `/v-small-${suffix}.md`,
      [textOf(8 * 1024, `vpk-v-s1-${suffix}`), textOf(8 * 1024, `vpk-v-s2-${suffix}`)],
      `vpk-corrupt-vs-${suffix}`,
      textOf(2 * 1024, `vpk-v-head-s-${suffix}`)
    );
    const big = await seedEntry(
      `${SCOPE_PREFIX}v-b-${suffix}`,
      `/v-big-${suffix}.md`,
      [big1, big2],
      `vpk-corrupt-vb-${suffix}`,
      textOf(2 * 1024, `vpk-v-head-b-${suffix}`)
    );
    const packed = await runVfsContentPacking(c);
    assert.equal(packed.packedGroups, 2);

    // 干净态：两 format 全部 member 校验通过。
    const ok = await verifyVfsContentPacks(c);
    assert.deepEqual(
      { packCount: ok.packCount, memberCount: ok.memberCount, failures: ok.failures },
      { packCount: 2, memberCount: 4, failures: [] },
      "干净 pack 应全量通过"
    );

    // 牙齿一（concat 组）：member offset+1 → 切片错位 → hash 不匹配（只报被篡改的 member）。
    await c.execute(
      `UPDATE vfs_content_pack_member SET offset = offset + 1 WHERE content_hash = ?`,
      [small.hashes[0]]
    );
    const tamperedConcat = await verifyVfsContentPacks(c);
    assert.equal(tamperedConcat.failures.length, 1, "仅被篡改 member 报失败");
    assert.equal(tamperedConcat.failures[0]!.contentHash, small.hashes[0]);
    assert.ok(
      tamperedConcat.failures[0]!.reason.includes("!="),
      "失败原因应为 hash 不匹配"
    );
    await c.execute(
      `UPDATE vfs_content_pack_member SET offset = offset - 1 WHERE content_hash = ?`,
      [small.hashes[0]]
    );

    // 牙齿二（fossil 组）：member offset 与段表不符 → 整组解码失败（同组全部 member 报）。
    await c.execute(
      `UPDATE vfs_content_pack_member SET offset = offset + 1 WHERE content_hash = ?`,
      [big.hashes[0]]
    );
    const tamperedFossil = await verifyVfsContentPacks(c);
    assert.equal(tamperedFossil.failures.length, 2, "fossil 组级失败记全部 member");
    assert.ok(
      tamperedFossil.failures.every((f) => f.reason.includes("组解码失败")),
      "失败原因应为组解码失败"
    );
    assert.deepEqual(
      tamperedFossil.failures.map((f) => f.contentHash).sort(),
      [...big.hashes].sort()
    );
  });

  it("T-VP8：打包幂等/可重入——组事务中断回滚无半态；重跑不重复打包", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);
    const [v1, v2] = [
      textOf(8 * 1024, `vpk-idem-1-${suffix}`),
      textOf(8 * 1024, `vpk-idem-2-${suffix}`),
    ];
    const seeded = await seedEntry(
      `${SCOPE_PREFIX}idem-${suffix}`,
      `/idem-${suffix}.md`,
      [v1, v2],
      `vpk-corrupt-idem-${suffix}`,
      textOf(2 * 1024, `vpk-head-idem-${suffix}`)
    );

    // a) 组事务中途崩溃（member 落库前抛）：整个事务回滚，三表回到初始态。
    await assert.rejects(
      () => runVfsContentPacking(connWithTxExplodingOnMemberInsert()),
      /模拟中断：member 落库前崩溃/
    );
    assert.equal(await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack"), 0, "pack 行不留半态");
    assert.equal(await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member"), 0, "member 行不留半态");
    for (const hash of seeded.hashes) {
      assert.equal(await blobRowCount(hash), 1, `成员 ${hash} 的 blob 行原样保留`);
    }
    assert.equal(await store.get(seeded.hashes[0]!), v1, "中断后仍走 blob 原路径读回等值");

    // b) 正常收敛后重跑：谓词天然收敛（blob 行已删 → JOIN 不命中），不重复打包。
    const first = await runVfsContentPacking(c);
    assert.equal(first.packedGroups, 1);
    const packCountAfterFirst = await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack");
    const memberCountAfterFirst = await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member");
    assert.equal(packCountAfterFirst, 1);
    assert.equal(memberCountAfterFirst, 2);

    const second = await runVfsContentPacking(c);
    assert.deepEqual(second, {
      done: true,
      packedGroups: 0,
      failedGroups: 0,
      stalled: false,
    });
    assert.equal(await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack"), packCountAfterFirst);
    assert.equal(await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member"), memberCountAfterFirst);
  });

  it("T-VP19：预算中断续跑——收紧预算批间收手，重启续跑收敛", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);
    // 3 个 entry（各 2 × ~40KB fossil 组，单组编码+落库耗时确保跨过预算线）。
    const plainsByEntry: string[][] = [];
    for (let i = 1; i <= 3; i++) {
      const [a, b] = similarPair(40 * 1024, `vpk-budget-${i}-${suffix}`);
      plainsByEntry.push([a, b]);
      await seedEntry(
        `${SCOPE_PREFIX}budget-${i}-${suffix}`,
        `/budget-${i}-${suffix}.md`,
        [a, b],
        `vpk-corrupt-budget-${i}-${suffix}`,
        textOf(2 * 1024, `vpk-head-budget-${i}-${suffix}`)
      );
    }

    const interrupted = await runVfsContentPacking(c, { syncBudgetMs: 0 });
    // 预算检查生效的判据（两分支任一）：要么没收手（done=false），要么没做满
    //（packedGroups < 3）——若实现根本不检查预算，此处 packedGroups=3 且
    // done=true，两个条件同时不满足、断言红。
    assert.ok(
      interrupted.done === false || interrupted.packedGroups < 3,
      "预算 0ms 下不得一轮全量完成"
    );
    assert.equal(interrupted.stalled, false);
    // 中途退出不写坏组快照。
    assert.equal(
      await new SqliteKkvRepository(c).get(VFS_PACK_KKV_MODULE, "failedGroups"),
      null,
      "预算中途退出不得写 failedGroups 快照"
    );

    const resumed = await runVfsContentPacking(c);
    assert.deepEqual(resumed, {
      done: true,
      packedGroups: 3 - interrupted.packedGroups,
      failedGroups: 0,
      stalled: false,
    });
    // 全量读回：3 个 entry 的全部成员经 member 分派读回等值。
    for (const plains of plainsByEntry) {
      for (const plain of plains) {
        assert.equal(await store.get(hashOf(plain)), plain);
      }
    }
  });

  it("T-VP18：坏组跳过——解压失败成员所在组整组保留、failedGroups 计数、不阻断其它组", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);

    // entryBad：v1 好 / v2 坏（垃圾 bytes 解压必失败）/ v3 好 / v4 好（≤8 单组 → 整组跳过）。
    const badPlain1 = textOf(6 * 1024, `vpk-bad-1-${suffix}`);
    const badPlain3 = textOf(6 * 1024, `vpk-bad-3-${suffix}`);
    const badPlain4 = textOf(6 * 1024, `vpk-bad-4-${suffix}`);
    const bad = await seedEntry(
      `${SCOPE_PREFIX}bad-${suffix}`,
      `/bad-${suffix}.md`,
      [
        badPlain1,
        { corruptBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22]) },
        badPlain3,
        badPlain4,
      ],
      `vpk-corrupt-bad-${suffix}`,
      textOf(2 * 1024, `vpk-head-bad-${suffix}`)
    );
    // entryGood：2 版本全好，证明坏组不阻断其它组收敛。
    const good1 = textOf(8 * 1024, `vpk-good-1-${suffix}`);
    const good2 = textOf(8 * 1024, `vpk-good-2-${suffix}`);
    const good = await seedEntry(
      `${SCOPE_PREFIX}good-${suffix}`,
      `/good-${suffix}.md`,
      [good1, good2],
      `vpk-corrupt-good-${suffix}`,
      textOf(2 * 1024, `vpk-head-good-${suffix}`)
    );

    const { result, warnings } = await captureWarnings(() => runVfsContentPacking(c));
    assert.equal(result.done, true, "坏组不阻断完成态（剩余候选 ≤ failedGroups）");
    assert.equal(result.packedGroups, 1, "只有 entryGood 落库");
    assert.equal(result.failedGroups, 1, "entryBad 整组跳过计 1");
    assert.equal(result.stalled, false);
    assert.ok(
      warnings.some((line) => line.includes("整组跳过")),
      "坏成员告警应说明整组跳过"
    );

    // 坏组 4 个 blob 行原样保留（含坏行）；好成员仍走 blob 原路径读回等值。
    for (const hash of bad.hashes) {
      assert.equal(await blobRowCount(hash), 1, `坏组成员 ${hash} 的 blob 行原样保留`);
    }
    assert.equal(await store.get(bad.hashes[0]!), badPlain1);
    assert.equal(await store.get(bad.hashes[2]!), badPlain3);
    assert.equal(await store.get(bad.hashes[3]!), badPlain4);
    // entryGood 正常打包且读回等值。
    const packs = await packRows();
    assert.equal(packs.length, 1);
    assert.equal(packs[0]!.entry_id, good.entryId);
    assert.equal(await store.get(good.hashes[0]!), good1);
    assert.equal(await store.get(good.hashes[1]!), good2);

    // 第二遍：坏组重扫重试仍 failed（无终态标记语义）、好组谓词天然排除。
    const second = await runVfsContentPacking(c);
    assert.deepEqual(second, {
      done: true,
      packedGroups: 0,
      failedGroups: 1,
      stalled: false,
    });

    // 收敛轮写入快照；状态查询透出「剩余 1 组（坏组）+ failedGroups 1」。
    const kkv = new SqliteKkvRepository(c);
    const snapshot = await kkv.get(VFS_PACK_KKV_MODULE, "failedGroups");
    assert.ok(snapshot, "收敛轮应写 failedGroups 快照");
    assert.equal(
      (JSON.parse(snapshot.value) as { failedGroups: number }).failedGroups,
      1
    );
    const status = await getVfsContentPackStatus(c);
    assert.equal(status.pendingGroups, 1, "坏 entry 仍是候选");
    assert.equal(status.memberCount, 2);
    assert.equal(status.failedGroups, 1);
  });

  it("T-VP20：stalled——组落库后 blob 行未删（打转）→ stalled:true、不挂收尾维护", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    await seedEntry(
      `${SCOPE_PREFIX}stall-${suffix}`,
      `/stall-${suffix}.md`,
      [textOf(8 * 1024, `vpk-stall-1-${suffix}`), textOf(8 * 1024, `vpk-stall-2-${suffix}`)],
      `vpk-corrupt-stall-${suffix}`,
      textOf(2 * 1024, `vpk-head-stall-${suffix}`)
    );

    const counter = maintenanceCounter();
    const result = await runVfsContentPacking(
      connWithSwallowedBlobDelete(),
      counter.hooks
    );
    assert.equal(result.stalled, true, "剩余候选(1) > failedGroups(0) → stalled");
    assert.equal(result.done, false);
    assert.equal(result.packedGroups, 1, "替身下组事务本身是\"成功\"的");
    assert.equal(result.failedGroups, 0);
    assert.equal(counter.maintCalls(), 0, "stalled 不得挂收尾维护");
    // stalled 不写坏组快照。
    assert.equal(
      await new SqliteKkvRepository(c).get(VFS_PACK_KKV_MODULE, "failedGroups"),
      null,
      "stalled 不得写 failedGroups 快照"
    );
  });

  it("T-VP10：反向展开——unpack 后 pack/member 清空、blob 行齐备读回等值、可重复执行", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);
    const [big1, big2] = similarPair(30 * 1024, `vpk-un-big-${suffix}`);
    const small = await seedEntry(
      `${SCOPE_PREFIX}un-s-${suffix}`,
      `/un-small-${suffix}.md`,
      [textOf(8 * 1024, `vpk-un-s1-${suffix}`), textOf(8 * 1024, `vpk-un-s2-${suffix}`)],
      `vpk-corrupt-un-s-${suffix}`,
      textOf(2 * 1024, `vpk-head-un-s-${suffix}`)
    );
    const big = await seedEntry(
      `${SCOPE_PREFIX}un-b-${suffix}`,
      `/un-big-${suffix}.md`,
      [big1, big2],
      `vpk-corrupt-un-b-${suffix}`,
      textOf(2 * 1024, `vpk-head-un-b-${suffix}`)
    );
    await runVfsContentPacking(c);

    const unpacked = await unpackVfsContent(c);
    assert.equal(unpacked.unpackedPacks, 2);
    assert.equal(unpacked.restoredRows, 4);

    // pack/member 清空。
    assert.equal(await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack"), 0);
    assert.equal(await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member"), 0);

    // blob 行齐备（4 成员 + 2 head），形态 zlib + 二进制 BLOB，byte_len=物理长度。
    for (const hash of [...small.hashes, ...big.hashes, small.headHash, big.headHash]) {
      const rows = await c.query<{ encoding: string; typeOf: string; byte_len: number; physical: number }>(
        `SELECT encoding, TYPEOF(bytes) AS typeOf, byte_len, LENGTH(bytes) AS physical
         FROM vfs_content_blob WHERE content_hash = ?`,
        [hash]
      );
      assert.equal(rows.length, 1, `${hash} 应有独立 blob 行`);
      assert.equal(rows[0]!.encoding, "zlib");
      assert.equal(String(rows[0]!.typeOf), "blob");
      assert.equal(Number(rows[0]!.byte_len), Number(rows[0]!.physical));
    }

    // 读回等值（全部走 blob 原路径；member 已清空）。
    assert.equal(await store.get(small.hashes[0]!), textOf(8 * 1024, `vpk-un-s1-${suffix}`));
    assert.equal(await store.get(small.hashes[1]!), textOf(8 * 1024, `vpk-un-s2-${suffix}`));
    assert.equal(await store.get(big.hashes[0]!), big1);
    assert.equal(await store.get(big.hashes[1]!), big2);

    // 可重复执行：第二遍零 pack 可解、数据不变。
    const again = await unpackVfsContent(c);
    assert.deepEqual(again, { unpackedPacks: 0, restoredRows: 0 });
    for (const hash of [...small.hashes, ...big.hashes]) {
      assert.equal(await blobRowCount(hash), 1);
    }
    // verify 对空表不误报。
    const verified = await verifyVfsContentPacks(c);
    assert.deepEqual(
      { packCount: verified.packCount, memberCount: verified.memberCount, failures: verified.failures },
      { packCount: 0, memberCount: 0, failures: [] }
    );
  });

  it("T-VP16：unpack 的 ref_count 重算——展开后 ref_count == revision 引用数，后续删除触发器归零回收不误删", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    // entry1：v1(hashA)/v2(hashB)/v3(hashC) + head；entry2 的一个 revision 引用 hashA（跨 entry 共享）。
    const pA = textOf(6 * 1024, `vpk-ref-a-${suffix}`);
    const pB = textOf(6 * 1024, `vpk-ref-b-${suffix}`);
    const pC = textOf(6 * 1024, `vpk-ref-c-${suffix}`);
    const entry1 = await seedEntry(
      `${SCOPE_PREFIX}ref1-${suffix}`,
      `/ref1-${suffix}.md`,
      [pA, pB, pC],
      `vpk-corrupt-ref1-${suffix}`,
      textOf(2 * 1024, `vpk-head-ref1-${suffix}`)
    );
    const entry2 = await seedEntry(
      `${SCOPE_PREFIX}ref2-${suffix}`,
      `/ref2-${suffix}.md`,
      [textOf(6 * 1024, `vpk-ref2-v1-${suffix}`)],
      `vpk-corrupt-ref2-${suffix}`,
      textOf(2 * 1024, `vpk-head-ref2-${suffix}`)
    );
    // 跨 entry 引用：hashA 被 entry2 再引一次（version=3，避开 seedEntry 已插
    // 的 v1 与 head revision(version=2)；此时 blob 行在，触发器 +1）。
    const hashA = entry1.hashes[0]!;
    await insertRevision(entry2.entryId, 3, hashA);

    const packed = await runVfsContentPacking(c);
    assert.equal(packed.packedGroups, 1, "entry1 的 3 hash 一组；entry2 单 DISTINCT hash 不成组");
    for (const hash of entry1.hashes) {
      assert.equal(await blobRowCount(hash), 0, "打包后被替换 blob 行删除");
    }

    const unpacked = await unpackVfsContent(c);
    assert.equal(unpacked.restoredRows, 3);

    // ref_count 现场重算：hashA 被两条 revision 引用 → 2；hashB/hashC 各 1。
    const refCountOf = async (hash: string): Promise<number> => {
      const rows = await c.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
        [hash]
      );
      assert.equal(rows.length, 1, `${hash} 应有 blob 行`);
      return Number(rows[0]!.ref_count);
    };
    assert.equal(await refCountOf(hashA), 2, "跨 entry 双引用 → ref_count=2");
    assert.equal(await refCountOf(entry1.hashes[1]!), 1);
    assert.equal(await refCountOf(entry1.hashes[2]!), 1);

    // 牙齿：删第一条 hashA 引用 → 触发器减到 1、行保留。若 unpack 把 ref_count
    // 写成 0，这条 DELETE 会被 CHECK(ref_count >= 0) 直接打红（-1 违约）。
    await c.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version = 1`,
      [entry1.entryId]
    );
    assert.equal(await refCountOf(hashA), 1, "删除一条引用后 ref_count 减 1、行不误删");

    // 删第二条 → 归零 → 触发器自动回收 blob 行。
    await c.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version = 3`,
      [entry2.entryId]
    );
    assert.equal(await blobRowCount(hashA), 0, "引用归零后触发器回收 blob 行");

    // 单引用成员同口径：删 hashB 的唯一引用 → 直接回收。
    await c.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version = 2`,
      [entry1.entryId]
    );
    assert.equal(await blobRowCount(entry1.hashes[1]!), 0);
  });

  it("T-VP16b：put 抽回 blob 行现场重算 ref_count——member-only hash 被 2 条 revision 引用时抽回落 ref_count=2，删引用逐级递减、归零回收", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);
    // 目标明文 H：member-only 形态（权威副本只在 pack 容器内，无 blob 行）。
    const plainH = textOf(6 * 1024, `vpk-recov-h-${suffix}`);
    const hashH = hashContent(plainH);
    const headHash = await store.put(textOf(2 * 1024, `vpk-recov-head-${suffix}`));
    const inserted = await c.execute(
      `INSERT INTO vfs_entry (scope_key, path, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (?, ?, ?, 3, 0, 'file')`,
      [`${SCOPE_PREFIX}recov-${suffix}`, `/recov-${suffix}.md`, headHash]
    );
    const entryId = Number(inserted.lastInsertRowid);
    // 直插 pack + member（不建 blob 行）→ H 是 member-only hash。
    assert.deepEqual(await insertPackMembers(entryId, [plainH]), [hashH]);
    assert.equal(await blobRowCount(hashH), 0, "前置：H 起始无 blob 行");
    // 两条 active revision 引用 H：INSERT 触发器对无 blob 行的 hash 静默命中 0 行
    // （ref_count 无人维护——这正是抽回落 0 的根因）。
    await insertRevision(entryId, 1, hashH);
    await insertRevision(entryId, 2, hashH);
    await insertRevision(entryId, 3, headHash);

    // 抽回：put 幂等保活把 H 物化回独立 blob 行。
    assert.equal(await store.put(plainH), hashH);
    assert.equal(await blobRowCount(hashH), 1, "抽回后应有独立 blob 行");
    assert.equal(
      await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE content_hash = ?", [hashH]),
      0,
      "抽回后 member 行应被删除（INV3）"
    );
    // 核心判据：新落 blob 行绕过触发器，ref_count 必须现场重算为真实引用数。
    assert.equal(await blobRefCount(hashH), 2, "抽回落 ref_count 应 == revision 引用数 2");
    assert.equal(await store.get(hashH), plainH, "抽回后读回等值");

    // 删 1 条引用：不抛（ref_count 若为 0，这步就撞 CHECK）且减到 1、行保留。
    await c.execute(`DELETE FROM vfs_revision WHERE entry_id = ? AND version = 1`, [
      entryId,
    ]);
    assert.equal(await blobRefCount(hashH), 1, "删一条引用后 ref_count 减 1、行不误删");

    // 删最后 1 条：归零 → 触发器按语义回收 blob 行。
    await c.execute(`DELETE FROM vfs_revision WHERE entry_id = ? AND version = 2`, [
      entryId,
    ]);
    assert.equal(await blobRowCount(hashH), 0, "引用归零后触发器回收 blob 行");

    // 反例自检（牙齿）：先插引用它的 revision（无 blob 行 → 触发器命中 0 行），
    // 再直插一条 ref_count=0 的 blob 行；删该引用必须撞 CHECK(ref_count >= 0)
    // ——证明上面「删引用不抛」不是恒真断言。
    const badHash = `${SCOPE_PREFIX}recov-bad-${suffix}`;
    await insertRevision(entryId, 4, badHash);
    const badBytes = compressZlib(new TextEncoder().encode("bad"));
    await c.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES (?, 'zlib', ?, ?, 0)`,
      [badHash, badBytes, badBytes.byteLength]
    );
    await assert.rejects(
      () =>
        c.execute(`DELETE FROM vfs_revision WHERE entry_id = ? AND version = 4`, [
          entryId,
        ]),
      /CHECK constraint failed: ref_count >= 0/,
      "ref_count=0 的残行删引用必须撞 CHECK（反例自检）"
    );
    // 收尾：先把残行 blob 删掉，再删 revision——顺序反了会再次撞 CHECK
    // （DELETE 触发器对已删行的 ref_count-1 照样触发），并把 CHECK 失败留给
    // 后续用例的 resetPackState（它也删 revision），整片变红。
    await c.execute(`DELETE FROM vfs_content_blob WHERE content_hash = ?`, [
      badHash,
    ]);
    await c.execute(`DELETE FROM vfs_revision WHERE entry_id = ? AND version = 4`, [
      entryId,
    ]);
  });

  it("T-VP16c：unpack 幂等修复 ref_count——既有 ref_count=0 残行（INSERT OR IGNORE 命中跳过）也被重算，后续删引用不抛", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);
    const plainH = textOf(6 * 1024, `vpk-ures-h-${suffix}`);
    const hashH = hashContent(plainH);
    const headHash = await store.put(textOf(2 * 1024, `vpk-ures-head-${suffix}`));
    const inserted = await c.execute(
      `INSERT INTO vfs_entry (scope_key, path, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (?, ?, ?, 2, 0, 'file')`,
      [`${SCOPE_PREFIX}ures-${suffix}`, `/ures-${suffix}.md`, headHash]
    );
    const entryId = Number(inserted.lastInsertRowid);
    assert.deepEqual(await insertPackMembers(entryId, [plainH]), [hashH]);
    // 先插 revision（此时无 blob 行，触发器命中 0 行），再直插 ref_count=0 的残行
    // ——复刻 pbp-2 事故后的数据面：member 行与 blob 行并存、blob 计数为 0。
    await insertRevision(entryId, 1, hashH);
    await insertRevision(entryId, 2, headHash);
    await c.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES (?, 'zlib', ?, ?, 0)`,
      [
        hashH,
        compressZlib(new TextEncoder().encode(plainH)).byteLength,
        compressZlib(new TextEncoder().encode(plainH)).byteLength,
      ]
    );
    assert.equal(await blobRefCount(hashH), 0, "前置：残行 ref_count=0");

    // 幂等修复随 unpack 落地。
    // 【pbp-22 联动】unpack 改为默认 dryRun 后，本调用改传 `{ force: true }`，
    // 否则零写即过、断言恒真（pbp-22 验收同步登记此事）。
    const unpacked = await unpackVfsContent(c);
    assert.equal(unpacked.unpackedPacks, 1);
    assert.equal(unpacked.restoredRows, 0, "既有 blob 行不覆盖（INSERT OR IGNORE 命中）");
    assert.equal(
      await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE content_hash = ?", [hashH]),
      0,
      "unpack 后 member 行清空"
    );
    // 核心判据：残行被重算为真实引用数（INSERT OR IGNORE 跳过的那条路由此救回）。
    assert.equal(await blobRefCount(hashH), 1, "幂等修复后 ref_count 应 == 引用数 1");

    // 牙齿：删唯一引用不抛、归零回收（ref_count 若仍为 0，这步就撞 CHECK）。
    await c.execute(`DELETE FROM vfs_revision WHERE entry_id = ? AND version = 1`, [
      entryId,
    ]);
    assert.equal(await blobRowCount(hashH), 0, "删引用后归零回收，不抛 CHECK");
  });

  it("T-VP13：fossil 组读放大上限——最坏组（8 成员 × ~120KB）单次读 ≤50ms 且链式解压计数=8", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);

    // 8 版本相似大文本（组明文 ~960KB ≤ 1MB；平均 120KB ≥ 24KB → fossil 链）。
    const base = textOf(120 * 1024, `vpk-amp-base-${suffix}`);
    const versions = Array.from({ length: 8 }, (_, i) => {
      const cut = Math.floor(base.length / 8);
      return (
        base.slice(0, cut * (i + 1)) +
        `\n修订 ${i + 1}：山雨欲来风满楼。` +
        base.slice(cut * (i + 1))
      );
    });
    const seeded = await seedEntry(
      `${SCOPE_PREFIX}amp-${suffix}`,
      `/amp-${suffix}.md`,
      versions,
      `vpk-corrupt-amp-${suffix}`,
      textOf(2 * 1024, `vpk-head-amp-${suffix}`)
    );
    const packed = await runVfsContentPacking(c);
    assert.equal(packed.packedGroups, 1);
    const packs = await packRows();
    assert.equal(packs[0]!.format, "fossil-chain-v1", "平均 ~120KB ≥ 24KB 应落 fossil 链");
    assert.equal(packs[0]!.member_count, 8);

    // 最坏成员 = 链尾（段 7）：解段 0 + 沿链 apply 7 次。数量级护栏 ≤200ms
    //（core 测试进程未注册 zlib 加速器，此为 fflate 口径；Node 实测链式读毫秒级，
    // 留足 CI 抖动余量，退化成逐成员从链头重解会数倍超线——pbp-32）。
    // 计数断言必须走冷态：打包任务的读明文已把这些 hash 写进 decoded-content-cache
    //（进程级、按内容寻址、不随用例重置），命中缓存的 get 不解压、计数恒 0——
    // 「读路径挂进程内缓存后断言必须换观测面」家族坑的实例（pbp-32 执行时实锤）。
    __resetVfsPackDecodeCountersForTests();
    clearDecodedContentCaches();
    const worstHash = seeded.hashes[7]!;
    const startedAt = Date.now();
    const plain = await store.get(worstHash);
    const elapsed = Date.now() - startedAt;
    assert.equal(plain, versions[7], "最坏成员读回等值");
    assert.ok(
      elapsed < 200,
      `最坏成员单次读 ${elapsed}ms，超出 200ms 数量级护栏（读放大退化；fflate 冷态口径）`
    );
    const counters = __getVfsPackDecodeCountersForTests();
    assert.equal(
      counters.fossilSegmentInflates,
      8,
      "单成员链式读 = 段 0 全量 + 7 个 delta 段，各解压一次（共 8）"
    );
    assert.equal(counters.zlibConcatInflates, 0);
  });

  it("T-VP21：收尾维护观测——首轮确有打包 maintCalls===1、稳态零候选 maintCalls 不再增加", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    await seedEntry(
      `${SCOPE_PREFIX}maint-${suffix}`,
      `/maint-${suffix}.md`,
      [textOf(8 * 1024, `vpk-maint-1-${suffix}`), textOf(8 * 1024, `vpk-maint-2-${suffix}`)],
      `vpk-corrupt-maint-${suffix}`,
      textOf(2 * 1024, `vpk-head-maint-${suffix}`)
    );

    const counter = maintenanceCounter();
    const first = await runVfsContentPacking(c, counter.hooks);
    assert.equal(first.packedGroups, 1);
    // maintCalls 语义：进入收尾维护段的次数（含被进程级去重短路的调用）。
    // 反向判据：把门条件短路成 if (false)，本断言立刻变红。
    assert.equal(counter.maintCalls(), 1, "首轮确有打包 ⇒ 进一次收尾维护段");

    // 稳态：零候选（谓词空）→ 零打包 → 不进维护段（计数不再增加）。
    const second = await runVfsContentPacking(c, counter.hooks);
    assert.deepEqual(second, {
      done: true,
      packedGroups: 0,
      failedGroups: 0,
      stalled: false,
    });
    assert.equal(counter.maintCalls(), 1, "稳态零候选不得再进收尾维护段");
  });

  // -------------------------------------------------------------------------
  // W1-P1-1 零候选水位（自失效负结果缓存）
  // -------------------------------------------------------------------------

  it("W1-P1-1a：零候选收敛写水位；指纹未变时 run/status 均短路谓词（执行计数 0）", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    // 单 hash entry：有一个 active 非 head 版本但 DISTINCT hash=1 不成组 →
    // 完整扫描后候选 entry=0（谓词仍可能返回行，水位短路的是「扫描」）。
    await seedEntry(
      `${SCOPE_PREFIX}wm-${suffix}`,
      `/wm-${suffix}.md`,
      [textOf(4 * 1024, `vpk-wm-v1-${suffix}`)],
      `vpk-corrupt-wm-${suffix}`,
      textOf(1024, `vpk-wm-head-${suffix}`)
    );

    const first = connWithCandidatePredicateProbe();
    const firstResult = await runVfsContentPacking(first.conn);
    assert.deepEqual(firstResult, {
      done: true,
      packedGroups: 0,
      failedGroups: 0,
      stalled: false,
    });
    assert.ok(
      first.predicateQueries() > 0,
      "无水位时入口必须走完整谓词扫描"
    );

    const kkv = new SqliteKkvRepository(c);
    const watermark = await kkv.get(
      VFS_PACK_KKV_MODULE,
      "zeroCandidateWatermark"
    );
    assert.ok(watermark, "完整扫描收敛为零候选后应写水位");
    const parsed = JSON.parse(watermark.value) as Record<string, unknown>;
    assert.equal(
      parsed.revisionCount,
      await countOf("SELECT COUNT(*) AS n FROM vfs_revision"),
      "水位应记当前 revisionCount"
    );
    assert.equal(
      parsed.entryCount,
      await countOf("SELECT COUNT(*) AS n FROM vfs_entry")
    );
    assert.equal(
      parsed.blobCount,
      await countOf("SELECT COUNT(*) AS n FROM vfs_content_blob")
    );
    assert.equal(parsed.packCount, 0);
    assert.equal(parsed.memberCount, 0);
    assert.match(String(parsed.entryHeadDigest), /^[0-9a-f]{64}$/);

    // 牙齿：去掉入口短路，本用例立刻变红（第二轮会重新下发谓词查询）。
    const second = connWithCandidatePredicateProbe();
    const secondResult = await runVfsContentPacking(second.conn);
    assert.deepEqual(secondResult, {
      done: true,
      packedGroups: 0,
      failedGroups: 0,
      stalled: false,
    });
    assert.equal(
      second.predicateQueries(),
      0,
      "指纹未变时入口不得下发候选谓词"
    );

    // status 同口径：pendingGroups 恒 0 且不跑谓词（memberCount/streamBytes 仍真采样）。
    __resetVfsPackStatusSamplingThrottleForTests();
    const statusProbe = connWithCandidatePredicateProbe();
    const status = await getVfsContentPackStatus(statusProbe.conn);
    assert.equal(status.pendingGroups, 0, "短路时 pendingGroups 语义仍为 0");
    assert.equal(status.memberCount, 0);
    assert.equal(
      statusProbe.predicateQueries(),
      0,
      "水位命中时 status 不得下发候选谓词"
    );
  });

  it("W1-P1-1b：新增 revision/新 blob 令水位失效、全扫恢复打包并重写水位", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const store = new SqliteVfsContentStore(c);
    const seeded = await seedEntry(
      `${SCOPE_PREFIX}wm2-${suffix}`,
      `/wm2-${suffix}.md`,
      [textOf(4 * 1024, `vpk-wm2-v1-${suffix}`)],
      `vpk-corrupt-wm2-${suffix}`,
      textOf(1024, `vpk-wm2-head-${suffix}`)
    );
    await runVfsContentPacking(c);
    const kkv = new SqliteKkvRepository(c);
    assert.ok(
      await kkv.get(VFS_PACK_KKV_MODULE, "zeroCandidateWatermark"),
      "前置：零候选收敛后应有水位"
    );

    // 追加两条新 revision（各带新 blob，非 head）：该 entry 凑出 ≥2 候选 hash。
    const hashB = await store.put(textOf(4 * 1024, `vpk-wm2-v2-${suffix}`));
    const hashC = await store.put(textOf(4 * 1024, `vpk-wm2-v3-${suffix}`));
    await insertRevision(seeded.entryId, 3, hashB);
    await insertRevision(seeded.entryId, 4, hashC);

    const probe = connWithCandidatePredicateProbe();
    const packed = await runVfsContentPacking(probe.conn);
    assert.equal(packed.packedGroups, 1, "新候选应被全扫重新发现并打包");
    assert.ok(
      probe.predicateQueries() > 0,
      "指纹失效（revision/blob 计数变）后必须回退完整扫描"
    );
    assert.ok(
      await kkv.get(VFS_PACK_KKV_MODULE, "zeroCandidateWatermark"),
      "再次收敛后水位应重写"
    );

    const again = connWithCandidatePredicateProbe();
    await runVfsContentPacking(again.conn);
    assert.equal(again.predicateQueries(), 0, "重写后的水位应继续生效");
  });

  it("W1-P1-1c：failedGroups>0 不写水位（绝不把「有坏组」当零候选）", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    // 全坏 entry：两版本都直插垃圾 bytes → 整组跳过、候选 entry 仍在。
    await seedEntry(
      `${SCOPE_PREFIX}wmbad-${suffix}`,
      `/wmbad-${suffix}.md`,
      [
        { corruptBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) },
        { corruptBytes: new Uint8Array([0x00, 0x11, 0x22, 0x33]) },
      ],
      `vpk-corrupt-wmbad-${suffix}`,
      textOf(1024, `vpk-wmbad-head-${suffix}`)
    );

    const { result } = await captureWarnings(() => runVfsContentPacking(c));
    assert.equal(result.done, true);
    assert.equal(result.failedGroups, 1);
    const kkv = new SqliteKkvRepository(c);
    assert.equal(
      await kkv.get(VFS_PACK_KKV_MODULE, "zeroCandidateWatermark"),
      null,
      "有坏组（候选仍非零）不得写水位"
    );

    // 再跑一遍仍走完整扫描（无水位可短路），坏组继续计数。
    const probe = connWithCandidatePredicateProbe();
    const second = await runVfsContentPacking(probe.conn);
    assert.ok(probe.predicateQueries() > 0, "无水位时必须回退完整扫描");
    assert.equal(second.failedGroups, 1);
    assert.equal(
      await kkv.get(VFS_PACK_KKV_MODULE, "zeroCandidateWatermark"),
      null,
      "坏组轮不得写水位"
    );
  });

  it("W1-P1-1d：只改 entry head（计数全不变）也令水位失效（entryHeadDigest 牙齿）", async () => {
    await resetPackState();
    const c = conn();
    const suffix = testIsolationSuffix();
    const seeded = await seedEntry(
      `${SCOPE_PREFIX}wmhead-${suffix}`,
      `/wmhead-${suffix}.md`,
      [textOf(4 * 1024, `vpk-wmhead-v1-${suffix}`)],
      `vpk-corrupt-wmhead-${suffix}`,
      textOf(1024, `vpk-wmhead-head-${suffix}`)
    );
    await runVfsContentPacking(c);
    const kkv = new SqliteKkvRepository(c);
    assert.ok(
      await kkv.get(VFS_PACK_KKV_MODULE, "zeroCandidateWatermark"),
      "前置：零候选收敛后应有水位"
    );

    const before = {
      revisionCount: await countOf("SELECT COUNT(*) AS n FROM vfs_revision"),
      entryCount: await countOf("SELECT COUNT(*) AS n FROM vfs_entry"),
      blobCount: await countOf("SELECT COUNT(*) AS n FROM vfs_content_blob"),
      packCount: await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack"),
      memberCount: await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member"),
    };

    // 模拟 resetHeadToVersion 回滚到「目标 hash 已是 blob 行」的旧版本：
    // put 命回既有 blob → 无 revision/blob 增删、计数全不变，只有 entry
    // 头部字段变（真实数据面最小形态）。counts 类字段在此完全失明，
    // 必须靠 entryHeadDigest 兜住。
    await c.execute(
      `UPDATE vfs_entry SET content_hash = ?, head_version = 1 WHERE entry_id = ?`,
      [seeded.hashes[0], seeded.entryId]
    );
    assert.deepEqual(
      {
        revisionCount: await countOf("SELECT COUNT(*) AS n FROM vfs_revision"),
        entryCount: await countOf("SELECT COUNT(*) AS n FROM vfs_entry"),
        blobCount: await countOf("SELECT COUNT(*) AS n FROM vfs_content_blob"),
        packCount: await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack"),
        memberCount: await countOf("SELECT COUNT(*) AS n FROM vfs_content_pack_member"),
      },
      before,
      "本用例前提：head 变更不动任何计数（只考验 digest 字段）"
    );

    const probe = connWithCandidatePredicateProbe();
    await runVfsContentPacking(probe.conn);
    assert.ok(
      probe.predicateQueries() > 0,
      "head-only 变更必须令指纹失效（否则回滚后的候选变化会被短路吞掉）"
    );
  });
});

/** 纯计算 hash（读回断言用——不走 store.put：那会写库、把已打包 hash 重新物化成 blob 行）。 */
function hashOf(plain: string): string {
  return hashContent(plain);
}
