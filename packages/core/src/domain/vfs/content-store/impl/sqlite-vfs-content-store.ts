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
  base64ToBytes,
  bytesToBase64,
  isReactNativeRuntime,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "../logic/blob-bytes-codec.js";
import { hashContent } from "../logic/hash-content.js";
import {
  compressZlib,
  decompressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../logic/zlib-codec.js";
import type { VfsContentStore } from "../vfs-content-store.port.js";

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
 * 确保 BLOB 绑定使用独立 ArrayBuffer（RN / better-sqlite3 约定）。
 */
function tightBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

/**
 * 将已知为二进制 BLOB 的列值收成 Uint8Array。
 *
 * @remarks string 不得经此函数；存量 / zlib-b64 的 string 路径在 decodeCompressedBytes 约定分支处理。
 */
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
 * 将 zlib-b64 列值（或 UTF-8 形态的 base64 字节）还原为 base64 文本。
 */
function asBase64Text(value: unknown, label: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes =
      value instanceof Uint8Array ? value : new Uint8Array(value);
    return new TextDecoder().decode(bytes);
  }
  throw new Error(
    `${label} 期望 base64 字符串或 UTF-8 字节，实际 ${Object.prototype.toString.call(value)}`,
  );
}

/**
 * 按 encoding 将 vfs_content_blob.bytes 解成 zlib 压缩字节。
 *
 * - `zlib` + Uint8Array/ArrayBuffer：原样
 * - `zlib` + string：存量 RN 误存 base64，按 base64 解（对齐 sksp）
 * - `zlib-b64`：取 base64 文本再解码
 */
function decodeCompressedBytes(
  encoding: string,
  bytes: unknown,
): Uint8Array {
  if (encoding === VFS_CONTENT_ENCODING_ZLIB) {
    if (typeof bytes === "string") {
      // 存量：Mobile 曾写 encoding=zlib，但 quick-sqlite 读回为 base64 字符串。
      return base64ToBytes(bytes);
    }
    return asUint8Array(bytes, "vfs_content_blob.bytes");
  }

  if (encoding === VFS_CONTENT_ENCODING_ZLIB_B64) {
    const b64 = asBase64Text(bytes, "vfs_content_blob.bytes");
    return base64ToBytes(b64);
  }

  throw new Error(`不支持的 content blob encoding: ${encoding}`);
}

/**
 * TDBC 后端的内容寻址存储。
 */
export class SqliteVfsContentStore implements VfsContentStore {
  private readonly parser = new SqlTemplateParser();
  private readonly preferZlibB64: boolean;

  constructor(
    private readonly conn: TdbcConnection,
    options?: SqliteVfsContentStoreOptions,
  ) {
    this.preferZlibB64 =
      options?.preferZlibB64 ?? isReactNativeRuntime();
  }

  async put(plain: string): Promise<string> {
    const contentHash = hashContent(plain);
    const existing = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash },
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
        },
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
      },
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
      { contentHash },
    );
    if (rows.length === 0) {
      throw new Error(`vfs_content_blob 缺失: ${contentHash}`);
    }
    const row = rows[0]!;
    const encoding = String(row.encoding);
    const compressed = decodeCompressedBytes(encoding, row.bytes);
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

  async findExistingBlobHashes(
    hashes: ReadonlyArray<string>,
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
        chunk,
      );
      for (const row of rows) {
        result.add(String(row.content_hash));
      }
    }
    return result;
  }

  async ensureBlob(contentHash: string, fallbackPlain: string | null): Promise<string> {
    const existing = await queryTemplate<{ content_hash: string }>(
      this.conn,
      this.parser,
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}`,
      { contentHash },
    );
    if (existing.length > 0) {
      return contentHash;
    }
    if (fallbackPlain == null) {
      throw new Error(
        `vfs_content_blob 缺失且无可回退明文: ${contentHash}`,
      );
    }
    // 走 put 路径落新行（insert 或复用同 hash 其他行）
    return this.put(fallbackPlain);
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
