/**
 * SQLite 实现的 {@link VfsContentStore}。
 *
 * @module domain/vfs/content-store/impl/sqlite-vfs-content-store
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import { hashContent } from "../logic/hash-content.js";
import {
  compressZlib,
  decompressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../logic/zlib-codec.js";
import type { VfsContentStore } from "../vfs-content-store.port.js";

/**
 * 确保 BLOB 绑定使用独立 ArrayBuffer（RN / better-sqlite3 约定）。
 */
function tightBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function asUint8Array(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  // RN quick-sqlite / 部分绑定可能直接给出 ArrayBuffer。
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error(
    `${label} 期望 Uint8Array/ArrayBuffer，实际 ${Object.prototype.toString.call(value)}`,
  );
}

/**
 * TDBC 后端的内容寻址存储。
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
      { contentHash },
    );
    if (existing.length > 0) {
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
      },
    );
    return contentHash;
  }

  async get(contentHash: string): Promise<string> {
    const rows = await queryTemplate<{
      encoding: string;
      bytes: Uint8Array | null;
    }>(
      this.conn,
      this.parser,
      `SELECT encoding, bytes FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash },
    );
    if (rows.length === 0) {
      throw new Error(`vfs_content_blob 缺失: ${contentHash}`);
    }
    const row = rows[0]!;
    const encoding = String(row.encoding);
    const compressed = asUint8Array(row.bytes, "vfs_content_blob.bytes");
    if (encoding !== VFS_CONTENT_ENCODING_ZLIB) {
      throw new Error(`不支持的 content blob encoding: ${encoding}`);
    }
    const plainUtf8 = decompressZlib(compressed);
    return new TextDecoder().decode(plainUtf8);
  }

  async collectAllReferencedHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();
    const entryRows = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL`,
      {},
    );
    for (const row of entryRows) {
      hashes.add(String(row.content_hash));
    }
    const revisionRows = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL`,
      {},
    );
    for (const row of revisionRows) {
      hashes.add(String(row.content_hash));
    }
    return hashes;
  }

  async gc(referencedHashes: ReadonlySet<string>): Promise<number> {
    const rows = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob`,
      {},
    );
    let deleted = 0;
    for (const row of rows) {
      const hash = String(row.content_hash);
      if (referencedHashes.has(hash)) {
        continue;
      }
      await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
        { contentHash: hash },
      );
      deleted++;
    }
    return deleted;
  }
}
