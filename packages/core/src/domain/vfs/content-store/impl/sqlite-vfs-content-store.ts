/**
 * SQLite 实现的 {@link VfsContentStore}。
 *
 * @module domain/vfs/content-store/impl/sqlite-vfs-content-store
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SqlValue } from "@/infra/tdbc/types.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import { hashContent } from "../logic/hash-content.js";
import { decodePackMembers, type VfsPackSpan } from "../logic/pack-codec.js";
import {
  asUint8Array,
  compressZlib,
  decodeCompressedBytes,
  decompressZlib,
  tightBytes,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../logic/zlib-codec.js";
import {
  lookupDecodedContentBody,
  rememberDecodedContentBody,
} from "@/infra/content-cache/logic/decoded-content-cache.js";
import type { VfsContentStore } from "../vfs-content-store.port.js";

/**
 * {@link SqliteVfsContentStore.getMany} 的分块大小：500 既能一次性覆盖多数扫描结果，
 * 又避免单条 SQL 绑参过多带来的额外开销。提至模块级，便于全局调整。
 */
const CONTENT_GETMANY_CHUNK_SIZE = 500;

/**
 * TDBC 后端的内容寻址存储。
 *
 * 写侧统一落 `zlib` 二进制 BLOB：op-sqlite 的 blob 绑参语义已在真机验证
 * （见 tdbc-driver-op-sqlite/bindings），不再有 `zlib-b64` 文本分支。
 * 读侧仍由 {@link decodeCompressedBytes} 兼容存量 `zlib-b64` / `zlib` + base64
 * 文本两种历史形态。
 *
 * 打包扩展（vfs_content_pack / vfs_content_pack_member）：`content_hash → 明文`
 * 的权威副本可能在独立 blob 行、也可能在 pack 容器内。读取一律 blob 表优先
 * （热路径零改动），未命中再查 member 按 format 分派解码；`put` 物化 blob 行时
 * 抽回同 hash 的 member 行（一 hash 至多一处权威副本，INV3）。
 */
export class SqliteVfsContentStore implements VfsContentStore {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async put(plain: string): Promise<string> {
    const contentHash = hashContent(plain);
    const existing = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash }
    );
    if (existing.length > 0) {
      // 同 hash 复用已有行，不改 encoding / bytes：存量行可能是 `zlib-b64`
      // 文本形态，读侧认得了就没必要为省空间顺手改写。
      // 防御性抽回：异常态下 blob 行与 member 行并存时删 member，保 INV3
      //（一 hash 至多一处权威副本）。
      await this.deleteMemberRow(contentHash);
      return contentHash;
    }

    // 回滚抽回语义：resetHeadToVersion / revive-deleted-entry 的 put 幂等保活把
    // 已打包历史版本抽回独立 blob 行当 head，故先删同 hash 的 member 行再落
    // blob 行（pack 流内该段成死区，等整组无成员随空 pack GC，流字节永不改写）。
    // 先删后插的中间崩溃窗口是「无权威副本」，可接受：put 幂等，重放一次即自愈
    // （member 已删则按全新内容插回，ref_count 由本分支的重算子查询兜住）。
    // 抽回信号（member 行存在）同时决定 ref_count 初值口径：绕过 revision 触发
    // 器新建的 blob 行必须现场重算，否则该 hash 早已被若干 revision 引用、初值 0
    // 会让后续删引用撞 CHECK(ref_count >= 0)、无 CHECK 时误删仍被引用的行。
    // 全新内容（member 未命中）沿用 DEFAULT 0 原语句——vfs_revision 无
    // content_hash 索引，COUNT 子查询是全表扫，不得无条件挂进 put 热路径。
    const wasPacked = await this.deleteMemberRow(contentHash);

    const utf8 = new TextEncoder().encode(plain);
    const compressed = compressZlib(utf8);
    const bytes = tightBytes(compressed);
    const params = {
      contentHash,
      encoding: VFS_CONTENT_ENCODING_ZLIB,
      bytes,
      byteLen: bytes.byteLength,
    };
    if (wasPacked) {
      await executeTemplate(
        this.conn,
        this.parser,
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
         VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen},
           (SELECT COUNT(*) FROM vfs_revision WHERE content_hash = #{contentHash}))`,
        params
      );
    } else {
      await executeTemplate(
        this.conn,
        this.parser,
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
         VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})`,
        params
      );
    }
    return contentHash;
  }

  async get(contentHash: string): Promise<string> {
    // 进程内解压产物层（infra/content-cache）：内容是内容寻址的，同 hash
    // 必同正文，命中即免掉「读压缩字节 + inflate」两笔钱。本层的键与
    // session-kkv file_cache 的 content_hash 同一个算法（hashContent(明文)），
    // 两套存储共享同一份内存条目。
    const cached = lookupDecodedContentBody(contentHash);
    if (cached != null) {
      return cached;
    }
    const rows = await queryTemplate<{
      encoding: string;
      bytes: SqlValue;
    }>(
      this.conn,
      this.parser,
      `SELECT encoding, bytes FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash }
    );
    if (rows.length > 0) {
      // blob 命中走原路径（热路径零改动），member 行不参与。
      const row = rows[0]!;
      const encoding = String(row.encoding);
      const compressed = decodeCompressedBytes(
        encoding,
        row.bytes,
        "vfs_content_blob.bytes"
      );
      const plainUtf8 = decompressZlib(compressed);
      const plain = new TextDecoder().decode(plainUtf8);
      rememberDecodedContentBody(contentHash, plain);
      return plain;
    }

    // blob 未命中 → 查 member（JOIN pack 取 format + bytes）按 format 分派解码。
    const memberRows = await queryTemplate<{
      offset: number;
      length: number;
      format: string;
      bytes: SqlValue;
    }>(
      this.conn,
      this.parser,
      `SELECT m.offset, m.length, p.format, p.bytes
       FROM vfs_content_pack_member m
       JOIN vfs_content_pack p ON p.pack_id = m.pack_id
       WHERE m.content_hash = #{contentHash}`,
      { contentHash }
    );
    if (memberRows.length === 0) {
      // 文案被测试与调用方依赖（resolveScanRows 同款），一个字不能改。
      throw new Error(`vfs_content_blob 缺失: ${contentHash}`);
    }
    const member = memberRows[0]!;
    const packBytes = asUint8Array(member.bytes, "vfs_content_pack.bytes");
    const plainUtf8 = decodePackMembers(String(member.format), packBytes, [
      { offset: Number(member.offset), length: Number(member.length) },
    ])[0]!;
    const plain = new TextDecoder().decode(plainUtf8);
    // member 的 content_hash 与 blob 同一个键空间（hashContent(明文)），
    // 解码产物同样进进程内缓存层。
    rememberDecodedContentBody(contentHash, plain);
    return plain;
  }

  async getMany(hashes: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (hashes.length === 0) {
      return result;
    }
    // 先走内存层，只把 miss 的 hash 投进 SQL（见 get 的说明）。去重是
    // 顺手的：IN 查询对重复值本来就无害，但 miss 列表去重后分片更干净。
    const toLoad: string[] = [];
    const seen = new Set<string>();
    for (const hash of hashes) {
      const cached = lookupDecodedContentBody(hash);
      if (cached != null) {
        result.set(hash, cached);
        continue;
      }
      if (!seen.has(hash)) {
        seen.add(hash);
        toLoad.push(hash);
      }
    }
    for (
      let offset = 0;
      offset < toLoad.length;
      offset += CONTENT_GETMANY_CHUNK_SIZE
    ) {
      const chunk = toLoad.slice(offset, offset + CONTENT_GETMANY_CHUNK_SIZE);
      const placeholders = chunk.map(() => `?`).join(`,`);
      const rows = await this.conn.query<{
        content_hash: string;
        encoding: string;
        bytes: SqlValue;
      }>(
        `SELECT content_hash, encoding, bytes FROM vfs_content_blob WHERE content_hash IN (${placeholders})`,
        chunk
      );
      for (const row of rows) {
        const encoding = String(row.encoding);
        const compressed = decodeCompressedBytes(
          encoding,
          row.bytes,
          "vfs_content_blob.bytes"
        );
        const plainUtf8 = decompressZlib(compressed);
        const plain = new TextDecoder().decode(plainUtf8);
        const contentHash = String(row.content_hash);
        rememberDecodedContentBody(contentHash, plain);
        result.set(contentHash, plain);
      }
      // blob 未命中的 hash 落 member 侧批量解析；全部命中时零额外查询。
      const missing = chunk.filter((hash) => !result.has(hash));
      if (missing.length > 0) {
        await this.appendPackMemberPlaintexts(missing, result);
      }
    }
    return result;
  }

  /**
   * 把 blob 侧未命中的 hash 从 pack 容器批量解析进 result。
   *
   * member 命中按 pack_id 聚合、pack 流每组只取回一次：zlib-concat 组整组只解压
   * 一次，fossil 组沿链一次走到所需最大段号、中间明文组内共享（详见 pack-codec）。
   * 缺失 hash 不出现在结果中（调用方 resolveScanRows 的缺失升级语义不变）。
   */
  private async appendPackMemberPlaintexts(
    missing: ReadonlyArray<string>,
    result: Map<string, string>
  ): Promise<void> {
    const missList = [...new Set(missing)];
    const memberPlaceholders = missList.map(() => `?`).join(`,`);
    const memberRows = await this.conn.query<{
      content_hash: string;
      pack_id: number;
      offset: number;
      length: number;
    }>(
      `SELECT content_hash, pack_id, offset, length
       FROM vfs_content_pack_member
       WHERE content_hash IN (${memberPlaceholders})`,
      missList
    );
    if (memberRows.length === 0) {
      return;
    }
    const packIds = [...new Set(memberRows.map((row) => Number(row.pack_id)))];
    const packPlaceholders = packIds.map(() => `?`).join(`,`);
    const packRows = await this.conn.query<{
      pack_id: number;
      format: string;
      bytes: SqlValue;
    }>(
      `SELECT pack_id, format, bytes FROM vfs_content_pack WHERE pack_id IN (${packPlaceholders})`,
      packIds
    );
    const packById = new Map<
      number,
      { format: string; bytes: SqlValue }
    >(
      packRows.map((row) => [
        Number(row.pack_id),
        { format: String(row.format), bytes: row.bytes },
      ])
    );

    const membersByPack = new Map<
      number,
      Array<{ contentHash: string; span: VfsPackSpan }>
    >();
    for (const row of memberRows) {
      const packId = Number(row.pack_id);
      const list = membersByPack.get(packId) ?? [];
      list.push({
        contentHash: String(row.content_hash),
        span: { offset: Number(row.offset), length: Number(row.length) },
      });
      membersByPack.set(packId, list);
    }

    const decoder = new TextDecoder();
    for (const [packId, members] of membersByPack) {
      const pack = packById.get(packId);
      if (pack == null) {
        throw new Error(
          `vfs_content_pack 缺失（member 引用了不存在的 pack）: ${packId}`
        );
      }
      const packBytes = asUint8Array(pack.bytes, "vfs_content_pack.bytes");
      const plains = decodePackMembers(
        pack.format,
        packBytes,
        members.map((member) => member.span)
      );
      members.forEach((member, index) => {
        const plain = decoder.decode(plains[index]!);
        rememberDecodedContentBody(member.contentHash, plain);
        result.set(member.contentHash, plain);
      });
    }
  }

  /**
   * 探测哪些 hash 已有权威副本（blob 行 **或** pack member 行）。
   *
   * @remarks 分块（`CHUNK_SIZE = 500`）逐块查询，IN 过滤外提到 UNION 子查询外层，
   * 故单语句只绑**一份** chunk（500 变量）——早先两个 IN 各绑一份共 1000 变量，
   * 越过老版 SQLite 的 999 变量上限（`SQLITE_MAX_VARIABLE_NUMBER` 在 3.32 前默认
   * 999，Android 系统 SQLite 到 API 31 仍是 3.28 一线），老 Android 机型必踩。
   */
  async findExistingBlobHashes(
    hashes: ReadonlyArray<string>
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (hashes.length === 0) {
      return result;
    }
    const CHUNK_SIZE = 500;
    for (let offset = 0; offset < hashes.length; offset += CHUNK_SIZE) {
      const chunk = hashes.slice(offset, offset + CHUNK_SIZE);
      const placeholders = chunk.map(() => `?`).join(`,`);
      // UNION member 表判定「已存在」：seed / fork-copy / backfill / tree-copy 等
      // 消费方对已打包 hash 不得误报缺失。
      //
      // 【绑参单份】IN 过滤外提到 UNION 子查询之外，只留**一个** IN 子句：早先把
      // 两个 IN 各绑 chunk 一份，单语句变量数 = CHUNK_SIZE × 2 = 1000，越过
      // `SQLITE_MAX_VARIABLE_NUMBER` 的 999 老默认（SQLite 3.32 前、Android 系统
      // SQLite 到 API 31 仍是 3.28 一线，op-sqlite 走的就是系统 SQLite）——调用方
      // 传整 scope 的 hash 列表时老 Android 机型必踩「too many SQL variables」。
      // 外提后单语句 500 变量，压在 999 内，与仓内 checkpoint 多值块 900 /
      // 各处 chunk 500 的既有纪律一致。
      //
      // 本函数走 `conn.query` 原始 `?` 位置参数（不经 SqlTemplateParser），故
      // 占位符必须是 `${placeholders}` 字符串拼接而非 `#{}` 模板记法，绑参收敛
      // 成单份 `[...chunk]`。结果进 Set 天然去重，用 UNION ALL 免排序开销。
      const rows = await this.conn.query<{ content_hash: string }>(
        `SELECT content_hash FROM (
           SELECT content_hash FROM vfs_content_blob
           UNION ALL
           SELECT content_hash FROM vfs_content_pack_member
         ) WHERE content_hash IN (${placeholders})`,
        [...chunk]
      );
      for (const row of rows) {
        result.add(String(row.content_hash));
      }
    }
    return result;
  }

  async ensureBlob(
    contentHash: string,
    fallbackPlain: string | null
  ): Promise<string> {
    // 与 findExistingBlobHashes 同口径：member 命中也算「已存在」，直接返回不
    // 走 put（否则会把已打包 hash 误判缺失，fallback 为 null 时误抛）。
    const existing = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}
       UNION ALL
       SELECT content_hash FROM vfs_content_pack_member WHERE content_hash = #{contentHash}`,
      { contentHash }
    );
    if (existing.length > 0) {
      return contentHash;
    }
    if (fallbackPlain == null) {
      throw new Error(`vfs_content_blob 缺失且无可回退明文: ${contentHash}`);
    }
    // 走 put 路径落新行（insert 或复用同 hash 其他行；含 member 抽回）
    return this.put(fallbackPlain);
  }

  async gc(): Promise<number> {
    // 一条 NOT IN 子查询清扫孤立 blob：子查询里显式过滤 NULL content_hash，
    // 避免 NOT IN 遇 NULL 的语义陷阱（NULL 会让整个 NOT IN 结果为空）。
    const blobResult = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (
        SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
        UNION
        SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
      )`,
      {}
    );
    // 孤儿 member 清扫：引用集口径与上面 blob 清扫逐字一致（entry ∪ revision），
    // 防两套口径漂移；被引用成员所在的 pack 因非空而保留。
    const memberResult = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_content_pack_member WHERE content_hash NOT IN (
        SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
        UNION
        SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
      )`,
      {}
    );
    // 空 pack 清扫：按 member 表实际行数判定，不信任 pack.member_count 列
    //（该列只是写入时快照，member 被 put 抽回 / 上一步清扫后即陈旧）。
    // 单层判定、无不动点：pack 自包含，fossil 的 base 是同组段内前驱、非跨行引用。
    const packResult = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_content_pack
       WHERE pack_id NOT IN (SELECT pack_id FROM vfs_content_pack_member)`,
      {}
    );
    return (
      blobResult.changes + memberResult.changes + packResult.changes
    );
  }

  /**
   * 删除同 hash 的 member 行（put 抽回；无行时是一次点查零成本）。
   *
   * @returns 是否真的删掉了 member 行——即「本次 put 走的是回滚抽回」信号，
   *   调用方据此决定新落 blob 行的 ref_count 初值是否需要现场重算。
   */
  private async deleteMemberRow(contentHash: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_content_pack_member WHERE content_hash = #{contentHash}`,
      { contentHash }
    );
    return result.changes > 0;
  }
}
