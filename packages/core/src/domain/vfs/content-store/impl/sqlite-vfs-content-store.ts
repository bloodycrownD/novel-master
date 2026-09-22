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
import {
  bytesToBase64,
  isReactNativeRuntime,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "../logic/blob-bytes-codec.js";
import { hashContent } from "../logic/hash-content.js";
import {
  compressZlib,
  decodeCompressedBytes,
  decompressZlib,
  tightBytes,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../logic/zlib-codec.js";
import type { VfsContentStore } from "../vfs-content-store.port.js";

/**
 * {@link SqliteVfsContentStore.getMany} 的分块大小：500 既能一次性覆盖多数扫描结果，
 * 又避免单条 SQL 绑参过多带来的额外开销。提至模块级，便于全局调整。
 */
const CONTENT_GETMANY_CHUNK_SIZE = 500;

/**
 * ContentStore 构造可选注入，便于单测强制 RN / Node 落库形态。
 */
export type SqliteVfsContentStoreOptions = {
  /**
   * 为 true 时 put 落 `zlib-b64`；为 false 时落 `zlib`。
   * 未传则按 {@link isReactNativeRuntime} 探测。
   */
  preferZlibB64?: boolean;
};

/**
 * TDBC 后端的内容寻址存储。
 */
export class SqliteVfsContentStore implements VfsContentStore {
  private readonly parser = new SqlTemplateParser();
  private readonly preferZlibB64: boolean;

  constructor(
    private readonly conn: TdbcConnection,
    options?: SqliteVfsContentStoreOptions
  ) {
    this.preferZlibB64 = options?.preferZlibB64 ?? isReactNativeRuntime();
  }

  async put(plain: string): Promise<string> {
    const contentHash = hashContent(plain);
    const existing = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash }
    );
    if (existing.length > 0) {
      // 同 hash 复用已有行，不改 encoding / bytes。
      return contentHash;
    }

    const utf8 = new TextEncoder().encode(plain);
    const compressed = compressZlib(utf8);

    if (this.preferZlibB64) {
      // Hermes/RN：zlib 后再 base64，以 TEXT 写入，规避 quick-sqlite BLOB 绑参。
      const b64 = bytesToBase64(compressed);
      await executeTemplate(
        this.conn,
        this.parser,
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
         VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})`,
        {
          contentHash,
          encoding: VFS_CONTENT_ENCODING_ZLIB_B64,
          bytes: b64,
          byteLen: b64.length,
        }
      );
      return contentHash;
    }

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
    return new TextDecoder().decode(plainUtf8);
  }

  async getMany(hashes: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (hashes.length === 0) {
      return result;
    }
    for (
      let offset = 0;
      offset < hashes.length;
      offset += CONTENT_GETMANY_CHUNK_SIZE
    ) {
      const chunk = hashes.slice(offset, offset + CONTENT_GETMANY_CHUNK_SIZE);
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
        result.set(
          String(row.content_hash),
          new TextDecoder().decode(plainUtf8)
        );
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
