/**
 * T-VP1/2a/2b/4/5/6/6b/11/14/15：vfs_content_pack 读路径收口（content store 六方法
 * + findContentSizeByPath 回退 + 打包后 head 不变式）。pack/member 行分两种来路——
 * T-VP1/2/4/5/6/6b/14 由测试直接 INSERT 构造；T-VP2b 真跑一轮
 * `runVfsContentPacking` 走写侧。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import {
  __getVfsPackDecodeCountersForTests,
  __resetVfsPackDecodeCountersForTests,
  decodeFossilChainSpans,
  decodeZlibConcatSpans,
  encodeFossilChainPack,
  encodeZlibConcatPack,
  parseFossilSegmentTable,
  VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
  VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
  type VfsPackFormat,
} from "@/domain/vfs/content-store/logic/pack-codec.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import { compressZlib } from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { runVfsContentPacking } from "@/infra/db-maintenance/impl/vfs-content-packing.js";
import { CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES } from "@/domain/character-card/logic/character-card-limits.js";
import { loadOrFillFileCache } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import type { TdbcConnection } from "@novel-master/core";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

// ---------------------------------------------------------------------------
// 构造工具
// ---------------------------------------------------------------------------

interface PackedMember {
  readonly contentHash: string;
  readonly plain: string;
  /** 独立 zlib 压缩长 = 被替换 blob 行 byte_len 的复制口径（两 format 同）。 */
  readonly compressedByteLen: number;
  /** 成员区间（pack：明文切片；fossil：段区间）。 */
  readonly spanOffset: number;
  readonly spanLength: number;
}

/**
 * 直接 INSERT 一条 pack + N 条 member 行（模拟 Step 10 打包落库后的形态；
 * 不建/不删 blob 行，由调用方负责）。
 */
async function insertPackRows(
  conn: TdbcConnection,
  entryId: number,
  format: VfsPackFormat,
  plains: ReadonlyArray<string>
): Promise<{ packId: number; members: PackedMember[] }> {
  const utf8s = plains.map((plain) => new TextEncoder().encode(plain));
  const encoded =
    format === VFS_PACK_FORMAT_ZLIB_CONCAT_V1
      ? encodeZlibConcatPack(utf8s)
      : encodeFossilChainPack(utf8s);
  await conn.execute(
    `INSERT INTO vfs_content_pack (entry_id, format, bytes, byte_len, member_count, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entryId,
      format,
      encoded.bytes,
      encoded.bytes.byteLength,
      utf8s.length,
      Date.now(),
    ],
  );
  const idRows = await conn.query<{ pack_id: number }>(
    `SELECT last_insert_rowid() AS pack_id`,
  );
  const packId = Number(idRows[0]!.pack_id);

  const members: PackedMember[] = [];
  for (let index = 0; index < utf8s.length; index++) {
    const plain = plains[index]!;
    const span = encoded.spans[index]!;
    const contentHash = hashContent(plain);
    const compressedByteLen = compressZlib(utf8s[index]!).byteLength;
    await conn.execute(
      `INSERT INTO vfs_content_pack_member (content_hash, pack_id, offset, length, compressed_byte_len)
       VALUES (?, ?, ?, ?, ?)`,
      [contentHash, packId, span.offset, span.length, compressedByteLen],
    );
    members.push({
      contentHash,
      plain,
      compressedByteLen,
      spanOffset: span.offset,
      spanLength: span.length,
    });
  }
  return { packId, members };
}

/** 直插 active revision（status='active' 引用 content_hash；触发器对无 blob 行的 hash 静默 0 行命中）。 */
async function insertActiveRevision(
  conn: TdbcConnection,
  entryId: number,
  version: number,
  contentHash: string,
): Promise<void> {
  await conn.execute(
    `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
     VALUES (?, ?, 'active', ?, ?, 1)`,
    [entryId, version, Date.now(), contentHash],
  );
}

async function entryIdOf(
  conn: TdbcConnection,
  scopeKey: string,
  path: string,
): Promise<number> {
  const rows = await conn.query<{ entry_id: number }>(
    `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
    [scopeKey, path],
  );
  return Number(rows[0]!.entry_id);
}

async function countRows(
  conn: TdbcConnection,
  sql: string,
  params: ReadonlyArray<unknown>,
): Promise<number> {
  const rows = await conn.query<{ n: number }>(sql, params);
  return Number(rows[0]!.n);
}

/**
 * 包一层连接，探针「命中两张内容表（vfs_content_blob / vfs_content_pack_member）」
 * 的单语句实际绑定变量数与 `?` 占位符个数——用来锁 `findExistingBlobHashes` 的
 * 单语句变量数（老版 SQLite 的 999 上限）。
 */
function createBlobHashQueryProbe(conn: TdbcConnection): {
  conn: TdbcConnection;
  statements: Array<{ boundParams: number; placeholders: number }>;
} {
  const statements: Array<{ boundParams: number; placeholders: number }> = [];
  const probe: TdbcConnection = {
    execute: (sql, parameters) => conn.execute(sql, parameters),
    batch: (sql, parametersList) => conn.batch(sql, parametersList),
    transaction: (fn) => conn.transaction(fn),
    close: () => conn.close(),
    query: async (sql, parameters) => {
      if (
        sql.includes("vfs_content_blob") &&
        sql.includes("vfs_content_pack_member")
      ) {
        statements.push({
          boundParams: parameters?.length ?? 0,
          placeholders: sql.split("?").length - 1,
        });
      }
      return conn.query(sql, parameters);
    },
  };
  return { conn: probe, statements };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** 中文长文语料（跨版本共享基线 + 局部修改 + 追加，让 delta 段有实质内容）。 */
function fossilVersions(suffix: string): string[] {
  const v0 = `序章-${suffix}\n` + `风起于青萍之末。`.repeat(400);
  const v1 =
    v0.replace(`青萍之末`, `青萍之末，浪成于微澜之间`) +
    `\n一稿补记：` + `山雨欲来风满楼。`.repeat(60);
  const v2 = v1 + `\n二稿续写：` + `月出惊山鸟，时鸣春涧中。`.repeat(90);
  return [v0, v1, v2];
}

/** 互不相似的独立语料（pack 组用）。 */
function plainChunk(tag: string, suffix: string, repeat: number): string {
  return `${tag}-${suffix}\n` + `落霞与孤鹜齐飞，秋水共长天一色。`.repeat(repeat);
}

// ---------------------------------------------------------------------------
// 坏 delta 段构造（pbp-1 防御夹具）
// ---------------------------------------------------------------------------

/** fossil-delta 的 z-base64 数字表（`putInt` 编码 delta 头/指令里的无符号整数）。 */
const Z_DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

/**
 * 编码一个 fossil delta 无符号整数（与 fossil-delta 的 `Writer.putInt` 同款：
 * z-base64、大端先出）。
 */
function putDeltaInt(value: number): number[] {
  if (value === 0) {
    return [Z_DIGITS.charCodeAt(0)];
  }
  const reversed: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 64)) {
    reversed.push(Z_DIGITS.charCodeAt(rest % 64));
  }
  return reversed.reverse();
}

/**
 * 手工伪造一条 fossil delta：头部自述 `limit`（输出规模）为超大值，正文全是
 * 高度重复的 copy 指令（`cnt @ ofst ,`），zlib 压缩比 ~1000:1 —— 压缩后只有
 * 几百字节的坏段，`applyDelta` 却会照着自述 limit 分配出数十 MB 输出。
 *
 * 尾部 checksum 故意填 0：真实 applyDelta 会在分配完之后抛 `bad checksum`——但
 * 那时堆已经吃掉了（catch 不掉的堆耗尽才是 P0 本体）。读侧闸门应在 apply 之前
 * 就拦下。
 */
function forgedOversizeDelta(
  declaredLimit: number,
  sourceLength: number,
  copyCount: number
): Uint8Array {
  const parts: number[] = [...putDeltaInt(declaredLimit), 0x0a];
  for (let i = 0; i < copyCount; i++) {
    parts.push(...putDeltaInt(sourceLength), 0x40, ...putDeltaInt(0), 0x2c);
  }
  parts.push(...putDeltaInt(0), 0x3b);
  return Uint8Array.from(parts);
}

/**
 * 手工拼一条两段 fossil pack 流（段 0 = zlib(正常 base 明文)，段 1 = zlib(伪造
 * 超限 delta)），返回流字节 + 段 1 的区间（供 `decodeFossilChainSpans` 作 span）。
 */
function buildTwoSegmentFossilPack(
  basePlain: Uint8Array,
  segment1Plain: Uint8Array
): { bytes: Uint8Array; segment1Span: { offset: number; length: number } } {
  const segment0 = compressZlib(basePlain);
  const segment1 = compressZlib(segment1Plain);
  const header = new Uint8Array(4 + 4 * 2);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 2, true);
  headerView.setUint32(4, segment0.byteLength, true);
  headerView.setUint32(8, segment1.byteLength, true);
  const total = header.byteLength + segment0.byteLength + segment1.byteLength;
  const bytes = new Uint8Array(total);
  bytes.set(header, 0);
  bytes.set(segment0, header.byteLength);
  bytes.set(segment1, header.byteLength + segment0.byteLength);
  return {
    bytes,
    segment1Span: {
      offset: header.byteLength + segment0.byteLength,
      length: segment1.byteLength,
    },
  };
}

// ---------------------------------------------------------------------------
// T-VP11：fossil 链编解码回环（纯 logic 层，构造语料固化）
// ---------------------------------------------------------------------------

describe("pack-codec: T-VP11 fossil 链编解码回环", () => {
  /** 固化语料：3 段中文版本链 + 1 段确定性伪随机字节（非 UTF-8，钉字节级全等）。 */
  function buildCorpus(): Uint8Array[] {
    const textVersions = fossilVersions(`tvp11-fixed`);
    const plains = textVersions.map((text) => new TextEncoder().encode(text));
    // xorshift32 确定性伪随机字节段（种子固化，含 0x00-0xFF 全值域）。
    let state = 0x9e3779b9;
    const randomBytes = new Uint8Array(2048);
    for (let i = 0; i < randomBytes.byteLength; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      randomBytes[i] = state & 0xff;
    }
    plains.push(randomBytes);
    return plains;
  }

  it("段表布局：4B 段数（LE）+ N×4B 段压缩长（LE）+ 段数据连排", () => {
    const corpus = buildCorpus();
    const { bytes, spans } = encodeFossilChainPack(corpus);

    const table = parseFossilSegmentTable(bytes);
    assert.equal(table.segmentCount, corpus.length);
    assert.equal(table.segments.length, corpus.length);

    // 各段压缩长与「段 0 全量 zlib / 段 i delta 再 zlib」的编码定义逐段一致。
    const headerLength = 4 + 4 * corpus.length;
    let cursor = headerLength;
    for (let i = 0; i < corpus.length; i++) {
      // 各段长度只在段 0 有「独立重算」的期望值（zlib(首成员明文)），段 i 是
      // createDelta(前驱→当前) 再压缩，拿「独立压缩长」当期望是错的——高熵目标下
      // delta 甚至略大于单独压缩（corpus 末段即如此）。故这里只钉段区间的连排
      // 位置，逐段长度的语义正确性由下一条「逐层 apply 明文全等」承担。
      const segment = table.segments[i]!;
      assert.equal(segment.offset, cursor, `段 ${i} offset 应连排`);
      cursor += segment.length;
    }
    assert.equal(cursor, bytes.byteLength, "段数据总长应铺满流");
    // spans（member 行口径）与段表推导逐段一致。
    for (let i = 0; i < corpus.length; i++) {
      assert.deepEqual(spans[i], table.segments[i]);
    }
    // 段 0 = zlib(首成员明文全量)（可独立重算验证，无实现自证）。
    assert.equal(
      table.segments[0]!.length,
      compressZlib(corpus[0]!).byteLength,
    );
  });

  it("逐层 apply 后明文与原件逐字节全等（整组 + 单成员取中间段）", () => {
    const corpus = buildCorpus();
    const { bytes, spans } = encodeFossilChainPack(corpus);

    const all = decodeFossilChainSpans(bytes, spans);
    assert.equal(all.length, corpus.length);
    for (let i = 0; i < corpus.length; i++) {
      assert.ok(
        bytesEqual(all[i]!, corpus[i]!),
        `成员 ${i} 应与原件逐字节全等`,
      );
    }

    // 单成员取中间段（段 2）：解段 0 → 沿链 apply 两次。
    const alone = decodeFossilChainSpans(bytes, [spans[2]!])[0]!;
    assert.ok(bytesEqual(alone, corpus[2]!));
  });

  it("zlib-concat 回环：整组一次解压 + 明文切片逐字节全等", () => {
    const corpus = buildCorpus();
    const { bytes, spans } = encodeZlibConcatPack(corpus);
    const decoded = decodeZlibConcatSpans(bytes, spans);
    for (let i = 0; i < corpus.length; i++) {
      assert.ok(bytesEqual(decoded[i]!, corpus[i]!));
    }
  });

  it("防御分支：段表截断 / 段数闸门（byteLength<4、段数 0、段数 0xFFFFFFFF、长度区不完整）/ member offset 错位 / member length 不符 / 切片越界均抛错（恒红判据支撑）", () => {
    const corpus = buildCorpus();

    const fossil = encodeFossilChainPack(corpus);
    // 流截断 1 字节：段长合计与流长不符。
    assert.throws(() =>
      parseFossilSegmentTable(fossil.bytes.subarray(0, fossil.bytes.byteLength - 1)),
    );
    // offset 界内但不在段表（headerLength-1 必小于首段 offset）。
    const table = parseFossilSegmentTable(fossil.bytes);
    assert.throws(() =>
      decodeFossilChainSpans(fossil.bytes, [
        { offset: 4 + 4 * table.segmentCount - 1, length: 1 },
      ]),
    );

    // —— pbp-19：段表防御分支四条 + 「段表长度区不完整」，逐条钉错误文案 ——
    // 判据钉文案而不是「只要抛就算过」：byteLength<4 那条若把闸门删掉，
    // DataView.getUint32 越界同样会抛 RangeError，只断言 throws 会成恒绿。
    // 1) 流短到连段数头都读不到。
    assert.throws(
      () => parseFossilSegmentTable(new Uint8Array(3)),
      /连段数头都读不到/,
    );

    /** 复制一份可写流字节并改写段数（不污染 encode 产物本体）。 */
    const withSegmentCount = (bytes: Uint8Array, count: number): Uint8Array => {
      const copy = bytes.slice();
      new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(
        0,
        count,
        true,
      );
      return copy;
    };

    // 2) 段数置 0：进段长累加前先被「段数为 0」拦。
    assert.throws(
      () => parseFossilSegmentTable(withSegmentCount(fossil.bytes, 0)),
      /段表段数为 0/,
    );

    // 3) 段数置 0xFFFFFFFF：headerLength 溢出到 ~17GB，闸门必须在**按段数分配
    //    段数组之前**拦下——同一步断言堆增量 <20MB，证明没有巨大分配。
    const heapBefore = process.memoryUsage().heapUsed;
    assert.throws(
      () => parseFossilSegmentTable(withSegmentCount(fossil.bytes, 0xffffffff)),
      /段表长度区不完整/,
    );
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    assert.ok(
      heapDeltaBytes < 20 * 1024 * 1024,
      `段数闸门应在分配段数组之前拦下，堆增量应 <20MB，实际 ${(heapDeltaBytes / 1024 / 1024).toFixed(1)}MB`,
    );

    // 4) offset 对、length 不符：不得被「offset 命中段表」蒙混过去。
    assert.throws(
      () =>
        decodeFossilChainSpans(fossil.bytes, [
          {
            offset: table.segments[1]!.offset,
            length: table.segments[1]!.length - 1,
          },
        ]),
      /member length 与段表不符/,
    );

    // 5) 段表长度区不完整：段数头读得到、N×4B 段长区读不全（流只剩头 4 字节）。
    assert.throws(
      () => parseFossilSegmentTable(fossil.bytes.subarray(0, 4)),
      /段表长度区不完整/,
    );

    const concat = encodeZlibConcatPack(corpus);
    // 切片长度越过解压后明文总长。
    const totalPlain = corpus.reduce((sum, p) => sum + p.byteLength, 0);
    assert.throws(() =>
      decodeZlibConcatSpans(concat.bytes, [
        { offset: 0, length: totalPlain + 1 },
      ]),
    );
  });

  it("T-VP11a 防御：delta 自述输出规模超上限的坏段在 apply 前被拦（堆增量 <50MB）", () => {
    // 坏段：段 0 正常（64KB 同值字节，压缩后极小），段 1 是手工伪造的 delta——
    // 头声明 limit=4_000_000_000，正文 400 条重复 copy 指令（若放行即 26MB 输出、
    // 数百 MB 堆），zlib 压缩后整段只有几百字节。
    const sourceLength = 64 * 1024;
    const basePlain = new Uint8Array(sourceLength).fill(0x41);
    const forged = forgedOversizeDelta(4_000_000_000, sourceLength, 400);
    const { bytes, segment1Span } = buildTwoSegmentFossilPack(basePlain, forged);

    // 夹具自检：坏段确实小到「几百字节」量级（放大比靠指令重复而非体积）。
    assert.ok(
      segment1Span.length < 2048,
      `伪造坏段压缩后应仅数百字节，实际 ${segment1Span.length}`,
    );

    const heapBefore = process.memoryUsage().heapUsed;
    assert.throws(
      () => decodeFossilChainSpans(bytes, [segment1Span]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /超过上限/);
        assert.match(error.message, /段 1/);
        return true;
      },
    );
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    assert.ok(
      heapDeltaBytes < 50 * 1024 * 1024,
      `闸门应在 apply 之前拦下，堆增量应 <50MB，实际 ${(heapDeltaBytes / 1024 / 1024).toFixed(1)}MB`,
    );
  });
});

// ---------------------------------------------------------------------------
// store 六方法 + findContentSizeByPath
// ---------------------------------------------------------------------------

describe("vfs content pack: store 读路径（T-VP1/2a/2b/4/5/6/6b/14/15）", () => {
  it("T-VP1: 打包后逐版本读回等值（pack 与 fossil 两 format；含同组重复 hash 共享成员）", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp1-scope-${suffix}`;

    // —— zlib-concat 组：v1/v3 同明文（同 hash 共享 member），head 独立保留 blob ——
    const pA = plainChunk(`pack-a`, suffix, 120);
    const pB = plainChunk(`pack-b`, suffix, 90);
    const pHead = plainChunk(`pack-head`, suffix, 60);
    const hA = hashContent(pA);
    const hB = hashContent(pB);
    const hHead = await store.put(pHead);

    const pathPack = `/tvp1/pack-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, pathPack, hHead);
    const entryIdPack = await entryIdOf(conn, sk, pathPack);
    await insertActiveRevision(conn, entryIdPack, 1, hA);
    await insertActiveRevision(conn, entryIdPack, 2, hB);
    await insertActiveRevision(conn, entryIdPack, 3, hA); // 重复 hash：两 revision 共享同一 member
    await insertActiveRevision(conn, entryIdPack, 4, hHead);

    const pack = await insertPackRows(
      conn,
      entryIdPack,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [pA, pB],
    );
    await conn.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash IN (?, ?)`,
      [hA, hB],
    );

    assert.equal(await store.get(hA), pA);
    assert.equal(await store.get(hB), pB);
    assert.equal(await store.get(hHead), pHead, "head 仍走 blob 原路径");
    // 一 hash 一 member 行（主键保证）；重复 hash 不产生第二行。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE pack_id = ?`,
        [pack.packId],
      ),
      2,
    );

    // —— fossil 组：三版本链（局部修改 + 追加），head 独立保留 blob ——
    const [f0, f1, f2] = fossilVersions(suffix);
    const hf0 = hashContent(f0);
    const hf1 = hashContent(f1);
    const hf2 = hashContent(f2);
    const pHeadF = plainChunk(`fossil-head`, suffix, 40);
    const hHeadF = await store.put(pHeadF);

    const pathFossil = `/tvp1/fossil-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, pathFossil, hHeadF);
    const entryIdFossil = await entryIdOf(conn, sk, pathFossil);
    await insertActiveRevision(conn, entryIdFossil, 1, hf0);
    await insertActiveRevision(conn, entryIdFossil, 2, hf1);
    await insertActiveRevision(conn, entryIdFossil, 3, hf2);
    await insertActiveRevision(conn, entryIdFossil, 4, hHeadF);

    await insertPackRows(
      conn,
      entryIdFossil,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      [f0, f1, f2],
    );
    await conn.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash IN (?, ?, ?)`,
      [hf0, hf1, hf2],
    );

    assert.equal(await store.get(hf0), f0);
    assert.equal(await store.get(hf1), f1);
    assert.equal(await store.get(hf2), f2);
    assert.equal(await store.get(hHeadF), pHeadF);

    // 混组批量读回（getMany 的 member 聚合路径）。
    const many = await store.getMany([hA, hB, hHead, hf0, hf1, hf2, hHeadF]);
    assert.equal(many.size, 7);
    assert.equal(many.get(hA), pA);
    assert.equal(many.get(hB), pB);
    assert.equal(many.get(hHead), pHead);
    assert.equal(many.get(hf0), f0);
    assert.equal(many.get(hf1), f1);
    assert.equal(many.get(hf2), f2);
    assert.equal(many.get(hHeadF), pHeadF);
  });

  it("T-VP2a: blob 命中优先于 member（head 永不被 member 分派；member 垃圾 offset 互斥夹具不干扰）", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp2-scope-${suffix}`;

    const pHead = plainChunk(`head-only`, suffix, 80);
    const hHead = await store.put(pHead);
    const path = `/tvp2/head-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, path, hHead);
    const entryId = await entryIdOf(conn, sk, path);

    // 互斥夹具：head hash 同时被塞进 member 行、offset 是必然越界的垃圾值——
    // 若实现错走 member 分派，这里会抛「区间越界」或解出脏明文（恒红）。
    const { packId } = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [plainChunk(`filler`, suffix, 5)],
    );
    await conn.execute(
      `INSERT INTO vfs_content_pack_member (content_hash, pack_id, offset, length, compressed_byte_len)
       VALUES (?, ?, ?, ?, ?)`,
      [hHead, packId, 0x40000000, 1, 1],
    );
    // 夹具有效性自检：member 行确实存在（保证下面断言测的是「blob 优先」而非「member 不存在」）。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE content_hash = ?`,
        [hHead],
      ),
      1,
    );
    // live head 永不被打包的读侧体现：blob 表始终有 head 行、get 命中即返回。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [hHead],
      ),
      1,
    );

    assert.equal(await store.get(hHead), pHead);
    assert.equal((await store.getMany([hHead])).get(hHead), pHead);
  });

  // T-VP2 的打包后全量不变式（pbp-31）：谓词排除 head → 打包只搬非 head 历史
  // 版本 → 跑完后每个 entry 的 head 都还有权威副本。
  //
  // 【口径澄清】判据取 blob 全集，落 blob 的 head 是 **T-VP2 的正常形态判据**；
  // 跨 entry 归首遇（UNION member 判已存在 → tree-copy/seed 快路径）造成的
  // member-only head 由 spec 放宽后的宽松式 INV1 覆盖，不在本用例口径内——
  // 本夹具的 head 一律经 store.put 落 blob 行，不含该形态（末尾的反向验证专门
  // 造一次该形态，只为证明谓词有判别力，随后立即清掉）。
  it("T-VP2b: 打包任务跑完后所有 entry head 均有 blob 行（正常形态判据）", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp2b-scope-${suffix}`;

    // 夹具：head 独立 blob + 两个历史版本（各自 blob 行 + active 非 head revision）。
    const pHead = plainChunk(`vp2b-head`, suffix, 60);
    const hHead = await store.put(pHead);
    const path = `/tvp2b/entry-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, path, hHead);
    const entryId = await entryIdOf(conn, sk, path);
    const historyHashes: string[] = [];
    for (let version = 1; version <= 2; version++) {
      const contentHash = await store.put(
        plainChunk(`vp2b-v${version}`, suffix, 40 + version),
      );
      await insertActiveRevision(conn, entryId, version, contentHash);
      historyHashes.push(contentHash);
    }
    await conn.execute(
      `UPDATE vfs_entry SET head_version = 3 WHERE entry_id = ?`,
      [entryId],
    );

    const result = await runVfsContentPacking(conn);
    assert.equal(result.done, true, "本轮应正常收敛（非打转）");
    assert.ok(
      result.packedGroups >= 1,
      `两个历史版本应至少落 1 组 pack，实际 ${result.packedGroups}`,
    );
    // 历史版本的 blob 行已被换成 member 行（谓词排除了 head 的证据）。
    for (const contentHash of historyHashes) {
      assert.equal(
        await countRows(
          conn,
          `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE content_hash = ?`,
          [contentHash],
        ),
        1,
        `历史版本 ${contentHash} 应落 member 行`,
      );
      assert.equal(
        await countRows(
          conn,
          `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
          [contentHash],
        ),
        0,
        "已收编成员的原 blob 行应被删",
      );
    }

    // 全库扫描：不得存在「head 有 content_hash 却没有 blob 权威副本」的 entry。
    const headWithoutBlob = `SELECT COUNT(*) AS n FROM vfs_entry
      WHERE content_hash IS NOT NULL
        AND content_hash NOT IN (SELECT content_hash FROM vfs_content_blob)`;
    assert.equal(
      await countRows(conn, headWithoutBlob, []),
      0,
      "打包跑完后所有 entry head 都应有 blob 行",
    );

    // 反向验证（谓词判别力）：造一个 head 指向 member-only hash 的 entry，同一
    // 谓词必须立刻报出 1——否则上面那句 ===0 只是「库里本来就没有脏 head」的
    // 恒真断言。造完即清，不给后续用例留 member-only head 污染。
    const pRogue = plainChunk(`vp2b-rogue`, suffix, 20);
    const rogueHash = hashContent(pRogue);
    const { packId } = await insertPackRows(
      conn,
      /* entryId 对 pack 行只是归属标注，这里用夹具自己的 entry */
      entryId,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [pRogue],
    );
    const roguePath = `/tvp2b/rogue-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, roguePath, rogueHash);
    assert.equal(
      await countRows(conn, headWithoutBlob, []),
      1,
      "member-only head 必须被谓词报出（判别力自检）",
    );
    await conn.execute(`DELETE FROM vfs_entry WHERE scope_key = ? AND path = ?`, [
      sk,
      roguePath,
    ]);
    await conn.execute(`DELETE FROM vfs_content_pack_member WHERE pack_id = ?`, [
      packId,
    ]);
    await conn.execute(`DELETE FROM vfs_content_pack WHERE pack_id = ?`, [packId]);
    assert.equal(
      await countRows(conn, headWithoutBlob, []),
      0,
      "夹具清理后全库应回到不变式",
    );
  });

  it("T-VP4: GC 语义——无引用 pack 回收 / 成员被引用整包保留 / 孤儿 member 回收 / ref_count 触发器互不干扰", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp4-scope-${suffix}`;
    const path = `/tvp4/anchor-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, path, await store.put(plainChunk(`anchor`, suffix, 3)));
    const entryId = await entryIdOf(conn, sk, path);

    // packX：3 成员全部无引用 → member 全删 + 空 pack 删。
    const packX = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [
        plainChunk(`x1`, suffix, 30),
        plainChunk(`x2`, suffix, 30),
        plainChunk(`x3`, suffix, 30),
      ],
    );

    // packY：3 成员全部被 revision 引用（打包后稳态）→ 整包原样保留。
    const packY = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      fossilVersions(`${suffix}-y`),
    );
    for (const member of packY.members) {
      await insertActiveRevision(conn, entryId, 100 + packY.members.indexOf(member), member.contentHash);
    }

    // packZ：2 成员中 1 个被引用、1 个无引用 → 孤儿 member 删、被引用 member 留、packZ 非空保留。
    const packZ = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [plainChunk(`z1`, suffix, 20), plainChunk(`z2`, suffix, 20)],
    );
    const [zKept, zOrphan] = packZ.members;
    await insertActiveRevision(conn, entryId, 200, zKept.contentHash);

    await store.gc();

    const memberCount = (packId: number, hash?: string) =>
      countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE pack_id = ?${
          hash != null ? ` AND content_hash = ?` : ``
        }`,
        hash != null ? [packId, hash] : [packId],
      );
    const packExists = (packId: number) =>
      countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack WHERE pack_id = ?`,
        [packId],
      );

    assert.equal(await memberCount(packX.packId), 0, "无引用 pack 的 member 应全删");
    assert.equal(await packExists(packX.packId), 0, "空 pack 应被回收");
    assert.equal(await memberCount(packY.packId), 3, "全成员被引用的 pack 应整包保留");
    assert.equal(await packExists(packY.packId), 1);
    assert.equal(await memberCount(packZ.packId, zOrphan.contentHash), 0, "孤儿 member 应被回收");
    assert.equal(await memberCount(packZ.packId, zKept.contentHash), 1, "被引用 member 应保留");
    assert.equal(await packExists(packZ.packId), 1, "非空 pack 不因部分成员孤儿而回收");

    // —— ref_count 触发器与 pack 删除互不干扰 ——
    // hBlob 走 blob 行（触发器维护 ref_count）；hPack 走 member（触发器静默 0 行）。
    // 删除两条 revision 后：触发器自动删 hBlob 的 blob 行；gc 再收走 hPack 孤儿
    // member 与空 packV——全程无异常、终态正确。
    const pBlob = plainChunk(`trig-blob`, suffix, 25);
    const hBlob = await store.put(pBlob);
    const packV = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      [plainChunk(`trig-pack`, suffix, 25)],
    );
    const hPack = packV.members[0]!.contentHash;
    await insertActiveRevision(conn, entryId, 300, hBlob);
    await insertActiveRevision(conn, entryId, 301, hPack);

    await conn.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version IN (300, 301)`,
      [entryId],
    );
    // 触发器把 hBlob 的 blob 行 ref_count 归零自动删除（不触碰 pack 表）。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [hBlob],
      ),
      0,
    );
    assert.equal(await memberCount(packV.packId), 1, "删 revision 不直接影响 member");

    await store.gc();
    assert.equal(await memberCount(packV.packId), 0, "hPack 变孤儿后随 gc 回收");
    assert.equal(await packExists(packV.packId), 0, "packV 随空组回收");
  });

  it("T-VP5: ensureBlob(hash,null) 与 findExistingBlobHashes 对已打包 hash 判已存在", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const suffix = testIsolationSuffix();

    const [f0, f1] = fossilVersions(suffix);
    const { members } = await insertPackRows(
      conn,
      /* entryId 无引用语义，占位即可 */ 987654321,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      [f0, f1],
    );
    // 夹具自检：两个 hash 的 blob 行确实不存在（「已存在」只能由 member 判出）。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash IN (?, ?)`,
        members.map((m) => m.contentHash),
      ),
      0,
    );

    // seed / fork-copy / backfill / tree-copy 的 fallback=null 探测路径：不抛即「已存在」。
    assert.equal(await store.ensureBlob(members[0]!.contentHash, null), members[0]!.contentHash);
    assert.equal(await store.ensureBlob(members[1]!.contentHash, null), members[1]!.contentHash);

    const hMissing = hashContent(`tvp5-missing-${suffix}`);
    const existing = await store.findExistingBlobHashes([
      members[0]!.contentHash,
      members[1]!.contentHash,
      hMissing,
    ]);
    assert.equal(existing.size, 2);
    assert.ok(existing.has(members[0]!.contentHash));
    assert.ok(existing.has(members[1]!.contentHash));
    assert.ok(!existing.has(hMissing), "真缺失的 hash 不得误报已存在（互斥）");

    // 恒红判据：缺失 hash 的 ensureBlob(null) 必抛原错误。
    await assert.rejects(
      () => store.ensureBlob(hMissing, null),
      /vfs_content_blob 缺失且无可回退明文/,
    );
  });

  it("T-VP5b: findExistingBlobHashes chunk 满载 500 全判已存在，单语句绑定变量 ≤500（老 Android SQLite 999 上限）", async () => {
    const { conn } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    // —— 夹具：1 个 pack + 500 条 member 行（blob 行一律不建，「已存在」只能
    // 由 member 判出）。member 的 offset/length 不参与本用例的探测路径，
    // 直接填合法值即可。
    const [f0] = fossilVersions(suffix);
    const { packId } = await insertPackRows(
      conn,
      /* entryId 无引用语义，占位即可 */ 987654322,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      [f0],
    );
    const bulkHashes = Array.from(
      { length: 500 },
      (_, index) => hashContent(`tvp5b-bulk-${suffix}-${index}`),
    );
    await conn.batch(
      `INSERT INTO vfs_content_pack_member (content_hash, pack_id, offset, length, compressed_byte_len)
       VALUES (?, ?, ?, ?, ?)`,
      bulkHashes.map((contentHash) => [contentHash, packId, 0, 1, 1]),
    );
    // 夹具自检：500 条 bulk member 行确实落库，且对应 blob 行不存在。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE pack_id = ?
         AND content_hash IN (${bulkHashes.map(() => `?`).join(`,`)})`,
        [packId, ...bulkHashes],
      ),
      500,
    );
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash IN (${bulkHashes
          .map(() => `?`)
          .join(`,`)})`,
        [...bulkHashes],
      ),
      0,
    );

    // —— 探针：包一层 conn，只数「命中两张内容表」的单语句实际绑定变量数。
    const probe = createBlobHashQueryProbe(conn);
    const store = new SqliteVfsContentStore(probe.conn);

    // 满载 chunk（500 个已打包 hash）——恰好一条语句。
    const full = await store.findExistingBlobHashes(bulkHashes);
    assert.equal(full.size, 500, "chunk 满载的 500 个已打包 hash 应全判已存在");
    for (const contentHash of bulkHashes) {
      assert.ok(full.has(contentHash));
    }
    assert.deepEqual(probe.statements, [
      { boundParams: 500, placeholders: 500 },
    ]);

    // 再加 1 个真缺失的 hash → 逼出第二条（长度为 1 的）chunk 语句，两条都 ≤500。
    probe.statements.length = 0;
    const hMissing = hashContent(`tvp5b-missing-${suffix}`);
    const mixed = await store.findExistingBlobHashes([...bulkHashes, hMissing]);
    assert.equal(mixed.size, 500);
    assert.ok(!mixed.has(hMissing), "真缺失的 hash 不得误报已存在（互斥）");

    // 防回归牙齿：单语句绑定变量数 ≤500（老版 SQLite 的 SQLITE_MAX_VARIABLE_NUMBER
    // 默认 999；早先两个 IN 各绑一份 chunk = 1000 变量，越线必红）。占位符个数与
    // 绑参个数相等一并断言，防止「有人改成字面量内插」绕过这条。
    assert.equal(probe.statements.length, 2, "501 个 hash 应切两条语句");
    for (const statement of probe.statements) {
      assert.ok(
        statement.boundParams <= 500,
        `单语句绑定变量数须 ≤500，实测 ${statement.boundParams}`,
      );
      assert.equal(statement.placeholders, statement.boundParams);
    }
  });

  it("T-VP6: findContentSizeByPath 回退 member.compressed_byte_len（fossil 组不回退 delta 长度）", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp6-scope-${suffix}`;

    // fossil 组取非首成员做 head hash：其段是 delta 段，压缩长 ≠ 独立压缩长——
    // 若闸门回退了 delta 长度，size 断言立即失配（互斥夹具）。
    const [f0, f1, f2] = fossilVersions(suffix);
    const { members } = await insertPackRows(
      conn,
      987654321,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      [f0, f1, f2],
    );
    const member2 = members[2]!;
    // 夹具互斥性自检：压缩口径值确实不同于段（delta）压缩长。
    assert.notEqual(member2.compressedByteLen, member2.spanLength);

    const pathFossil = `/tvp6/fossil-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, pathFossil, member2.contentHash);
    const sizeFossil = await entryRepo.findContentSizeByPath(sk, pathFossil);
    assert.ok(sizeFossil != null);
    assert.equal(sizeFossil!.kind, "blobCompressedBytes");
    assert.equal(
      sizeFossil!.size,
      member2.compressedByteLen,
      "应返回原 blob 行 byte_len 的复制值（非 delta 段长）",
    );

    // blob 行存在时优先 blob：byte_len 取 X、member 造 Y≠X 的垃圾值，实现必须读 X。
    const pBoth = plainChunk(`both`, suffix, 50);
    const hBoth = await store.put(pBoth);
    const bothByteLen = compressZlib(new TextEncoder().encode(pBoth)).byteLength;
    const { packId } = await insertPackRows(
      conn,
      987654321,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [plainChunk(`filler`, suffix, 5)],
    );
    await conn.execute(
      `INSERT INTO vfs_content_pack_member (content_hash, pack_id, offset, length, compressed_byte_len)
       VALUES (?, ?, ?, ?, ?)`,
      [hBoth, packId, 0, 1, bothByteLen + 999],
    );
    const pathBoth = `/tvp6/both-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, pathBoth, hBoth);
    const sizeBoth = await entryRepo.findContentSizeByPath(sk, pathBoth);
    assert.ok(sizeBoth != null);
    assert.equal(sizeBoth!.size, bothByteLen, "blob 行存在时不得回退 member");

    // 真 hash 无 blob 亦无 member → 维持 null（探测不到）。
    const pathGhost = `/tvp6/ghost-${suffix}.md`;
    const hGhost = hashContent(`tvp6-ghost-${suffix}`);
    await entryRepo.insertWithContentHash(sk, pathGhost, hGhost);
    assert.equal(await entryRepo.findContentSizeByPath(sk, pathGhost), null);
  });

  // T-VP6 的后半句（pbp-13）：member 回退值必须恒等于「被替换 blob 行的byte_len
  // 复制值」。这条口径是读取侧降级闸门（超限文件走占位、不整读正文）唯一的输入
  // ——一旦回退成段长/delta 长度，闸门按压缩侧 4× 折算的口径就失真，超大文件被
  // 放行、正文整读打进 native OOM。blob 形态的占位已由 load-or-fill-file-cache.
  // test.ts 与 assemble-workplace-display.test.ts 覆盖，本条只补 pack/member 形态。
  it("T-VP6b: pack/member 形态下 compressed_byte_len 超闸门仍走占位、闸门内读真文（消费端 loadOrFillFileCache）", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp6b-scope-${suffix}`;
    const gate = CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES;

    const anchorPath = `/tvp6b/anchor-${suffix}.md`;
    await entryRepo.insertWithContentHash(
      sk,
      anchorPath,
      await store.put(plainChunk(`tvp6b-anchor`, suffix, 3)),
    );
    const entryId = await entryIdOf(conn, sk, anchorPath);

    // 一个 pack 组、两个成员（都无 blob 行 = member-only 形态）。
    const pOver = plainChunk(`tvp6b-over`, suffix, 50);
    const pUnder = plainChunk(`tvp6b-under`, suffix, 50);
    const { members } = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      [pOver, pUnder],
    );
    const [memberOver, memberUnder] = members;
    const hashOver = memberOver!.contentHash;
    const hashUnder = memberUnder!.contentHash;

    // 超限组：compressed_byte_len 抬到闸门之上。该列的真实语义就是「这份内容
    // 作为独立 blob 行时的 byte_len」，抬到闸门之上即模拟「超大文件被打包」。
    const overBytes = gate + 1;
    await conn.execute(
      `UPDATE vfs_content_pack_member SET compressed_byte_len = ? WHERE content_hash = ?`,
      [overBytes, hashOver],
    );
    // 对照组互斥性自检：独立压缩长必在闸门之下。
    assert.ok(
      memberUnder!.compressedByteLen < gate,
      `对照组压缩长 ${memberUnder!.compressedByteLen} 应远低于闸门 ${gate}`,
    );
    // 夹具互斥性自检：两个 hash 都不得有 blob 行（否则探测走 blob 早返回）。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash IN (?, ?)`,
        [hashOver, hashUnder],
      ),
      0,
    );

    const pathOver = `/tvp6b/over-${suffix}.md`;
    const pathUnder = `/tvp6b/under-${suffix}.md`;
    await entryRepo.insertWithContentHash(sk, pathOver, hashOver);
    await entryRepo.insertWithContentHash(sk, pathUnder, hashUnder);

    // —— 探测层：回退值口径（承 T-VP6，这里落在超限侧）——
    const sizeOver = await entryRepo.findContentSizeByPath(sk, pathOver);
    assert.ok(sizeOver != null);
    assert.equal(sizeOver!.kind, "blobCompressedBytes");
    assert.equal(
      sizeOver!.size,
      overBytes,
      "member 回退值必须是 compressed_byte_len（不是段长）",
    );
    assert.ok(sizeOver!.size > gate, "超限组必须真的过闸门");
    const sizeUnder = await entryRepo.findContentSizeByPath(sk, pathUnder);
    assert.ok(sizeUnder != null);
    assert.equal(sizeUnder!.size, memberUnder!.compressedByteLen);
    assert.ok(
      sizeUnder!.size <= gate,
      `对照组不得超闸门（实测 ${sizeUnder!.size} vs ${gate}）`,
    );

    // —— 消费端：workplace 读取侧降级 ——
    // vfs 用仓库真身搭一个只实现 read/findContentSize 的薄壳：探测值真的来自
    // findContentSizeByPath（含 member 回退），read 真的经 content store 解成员。
    let readCalls = 0;
    const vfs = {
      async findContentSize(target: string) {
        return entryRepo.findContentSizeByPath(sk, target);
      },
      async read(target: string) {
        readCalls += 1;
        const entry = await entryRepo.findByPath(sk, target);
        if (entry == null) {
          throw new Error(`vfs_not_found: ${target}`);
        }
        return {
          path: target,
          content: entry.content,
          version: entry.version,
          mtimeMs: entry.mtimeMs,
        };
      },
    } as unknown as VfsService;

    const sessionId = `tvp6b-${suffix}`;
    const sessionKkv = createMemorySessionKkv();
    const placeholder = await loadOrFillFileCache({
      sessionId,
      sessionKkv,
      vfs,
      path: pathOver,
      status: "full",
    });
    assert.equal(
      placeholder.body,
      `（文件过大，已跳过，约 ${overBytes * 4} 字符）`,
      "member 形态的超限文件必须走占位（数字取compressed_byte_len 的 4× 折算）",
    );
    assert.equal(readCalls, 0, "超限组不得触发全文读取");
    assert.equal(
      await sessionKkv.get(
        sessionId,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        fileCacheKey("full", pathOver),
      ),
      null,
      "占位结果不得写进 file_cache",
    );

    const under = await loadOrFillFileCache({
      sessionId,
      sessionKkv,
      vfs,
      path: pathUnder,
      status: "full",
    });
    assert.equal(under.body, pUnder, "闸门内的 member 文件应读到真实明文");
    assert.equal(readCalls, 1);
  });

  it("get 缺失文案不变：既无 blob 行也无 member 行时维持原错误", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const suffix = testIsolationSuffix();
    const hGhost = hashContent(`no-blob-no-member-${suffix}`);
    await assert.rejects(
      () => store.get(hGhost),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `vfs_content_blob 缺失: ${hGhost}`);
        return true;
      },
    );
  });

  it("T-VP14: 抽回死区——put 抽回 fossil 组首成员后 blob/member 双侧读回全等、pack 流字节不变", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `tvp14-scope-${suffix}`;

    const [f0, f1, f2] = fossilVersions(suffix);
    const path = `/tvp14/entry-${suffix}.md`;
    const hAnchor = await store.put(plainChunk(`anchor`, suffix, 3));
    await entryRepo.insertWithContentHash(sk, path, hAnchor);
    const entryId = await entryIdOf(conn, sk, path);

    const { packId, members } = await insertPackRows(
      conn,
      entryId,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      [f0, f1, f2],
    );
    const [m0, m1, m2] = members;
    await insertActiveRevision(conn, entryId, 1, m0.contentHash);
    await insertActiveRevision(conn, entryId, 2, m1.contentHash);
    await insertActiveRevision(conn, entryId, 3, m2.contentHash);

    const beforeRows = await conn.query<{ bytes: Uint8Array }>(
      `SELECT bytes FROM vfs_content_pack WHERE pack_id = ?`,
      [packId],
    );
    const bytesBefore = beforeRows[0]!.bytes;

    // 抽回：put 幂等保活把首成员抽回独立 blob 行当 head（resetHeadToVersion 场景）。
    assert.equal(await store.put(f0), m0.contentHash);

    // 恒红判据 1：member 表必须删掉 h0（不删则 count=1）。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE content_hash = ?`,
        [m0.contentHash],
      ),
      0,
      "put 抽回后同 hash member 行应被删除",
    );
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [m0.contentHash],
      ),
      1,
      "抽回后 blob 行应存在",
    );
    // 同组剩余成员 member 行不受牵连。
    assert.equal(
      await countRows(
        conn,
        `SELECT COUNT(*) AS n FROM vfs_content_pack_member WHERE pack_id = ?`,
        [packId],
      ),
      2,
    );

    // 恒红判据 2：pack 流字节逐字节不变（死区段留在流里等整组 GC，永不改写）。
    const afterRows = await conn.query<{ bytes: Uint8Array }>(
      `SELECT bytes FROM vfs_content_pack WHERE pack_id = ?`,
      [packId],
    );
    assert.ok(bytesEqual(bytesBefore, afterRows[0]!.bytes), "pack 流字节应不变");

    // 双侧读回全等：h0 走 blob 路径；h1/h2 沿段链（含已成死区的段 0 作 base）。
    assert.equal(await store.get(m0.contentHash), f0);
    assert.equal(await store.get(m1.contentHash), f1);
    assert.equal(await store.get(m2.contentHash), f2);

    const many = await store.getMany([
      m0.contentHash,
      m1.contentHash,
      m2.contentHash,
    ]);
    assert.equal(many.get(m0.contentHash), f0);
    assert.equal(many.get(m1.contentHash), f1);
    assert.equal(many.get(m2.contentHash), f2);
  });

  it("T-VP15: 混合 getMany 跨 blob/pack/fossil 三源——pack 组只解压一次、fossil 组复用链式中间结果", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const suffix = testIsolationSuffix();

    const pB = plainChunk(`blob-src`, suffix, 70);
    const hB = await store.put(pB);

    const packPlains = [
      plainChunk(`m1`, suffix, 45),
      plainChunk(`m2`, suffix, 55),
    ];
    const pack = await insertPackRows(
      conn,
      987654321,
      VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
      packPlains,
    );

    const fossilPlains = fossilVersions(suffix);
    const fossil = await insertPackRows(
      conn,
      987654321,
      VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
      fossilPlains,
    );

    __resetVfsPackDecodeCountersForTests();
    const many = await store.getMany([
      hB,
      ...pack.members.map((m) => m.contentHash),
      ...fossil.members.map((m) => m.contentHash),
    ]);

    assert.equal(many.size, 6);
    assert.equal(many.get(hB), pB);
    for (let i = 0; i < packPlains.length; i++) {
      assert.equal(many.get(pack.members[i]!.contentHash), packPlains[i]);
    }
    for (let i = 0; i < fossilPlains.length; i++) {
      assert.equal(many.get(fossil.members[i]!.contentHash), fossilPlains[i]);
    }

    const counters = __getVfsPackDecodeCountersForTests();
    // 恒红判据：若 pack 组逐成员解压 → 2；若 fossil 组逐成员从链头重解 → 1+2+3=6。
    assert.equal(
      counters.zlibConcatInflates,
      1,
      `pack 组应整组只解压一次，实际 ${counters.zlibConcatInflates}`,
    );
    assert.equal(
      counters.fossilSegmentInflates,
      fossilPlains.length,
      `fossil 组应按段数解压（链式中间结果复用），实际 ${counters.fossilSegmentInflates}`,
    );
  });
});
