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
import {
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
      return contentHash;
    }

    const utf8 = new TextEncoder().encode(plain);
    const compressed = compressZlib(utf8);
    const bytes = tightBytes(compressed);
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
       VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})`,
      {
        contentHash,
        encoding: VFS_CONTENT_ENCODING_ZLIB,
        bytes,
        byteLen: bytes.byteLength,
      }
    );
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
    if (rows.length === 0) {
      throw new Error(`vfs_content_blob 缺失: ${contentHash}`);
    }
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
    }
    return result;
  }

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
      const rows = await this.conn.query<{ content_hash: string }>(
        `SELECT content_hash FROM vfs_content_blob WHERE content_hash IN (${placeholders})`,
        chunk
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
    const existing = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash }
    );
    if (existing.length > 0) {
      return contentHash;
    }
    if (fallbackPlain == null) {
      throw new Error(`vfs_content_blob 缺失且无可回退明文: ${contentHash}`);
    }
    // 走 put 路径落新行（insert 或复用同 hash 其他行）
    return this.put(fallbackPlain);
  }

  async gc(): Promise<number> {
    // 一条 NOT IN 子查询清扫孤立 blob：子查询里显式过滤 NULL content_hash，
    // 避免 NOT IN 遇 NULL 的语义陷阱（NULL 会让整个 NOT IN 结果为空）。
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (
        SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
        UNION
        SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
      )`,
      {}
    );
    return result.changes;
  }
}
