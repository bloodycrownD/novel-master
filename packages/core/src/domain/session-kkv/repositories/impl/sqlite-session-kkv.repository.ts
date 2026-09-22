/**
 * SQLite Session KKV 仓储（SqlTemplateParser）。
 *
 * file_cache 域分流到 `session_file_cache_entry` + `session_file_cache_blob`
 * 两张新表（storage-cache-dedup-and-cleanup feature A）：同 body 全库单份
 * blob、会话侧只存轻量引用，`SessionKkvService` 六方法签名与语义不变。
 * 其余域（rule_snapshot / backfill_cursor / user_vfs_pending 等）保持
 * `session_kkv_entry` 原表原逻辑。
 *
 * @module domain/session-kkv/repositories/impl/sqlite-session-kkv.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row, SqlValue } from "@/infra/tdbc/types.js";
import type { SessionKkvEntry } from "../../model/session-kkv-entry.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "../../model/session-kkv-domains.js";
import {
  decodeFileCacheBlobBody,
  encodeFileCacheValue,
} from "../../logic/file-cache-blob-codec.js";
import { serializeFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import type { SessionKkvRepository } from "../session-kkv.port.js";

function rowToEntry(row: Row): SessionKkvEntry {
  return {
    sessionId: String(row.session_id),
    domain: String(row.domain),
    key: String(row.key),
    value: String(row.value),
  };
}

/**
 * 基于 TDBC 的 `session_kkv_entry` 仓储。
 */
export class SqliteSessionKkvRepository implements SessionKkvRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(
    sessionId: string,
    domain: string,
    key: string
  ): Promise<SessionKkvEntry | null> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      return this.getFileCacheEntry(sessionId, key);
    }
    return this.getLegacyEntry(sessionId, domain, key);
  }

  async set(
    sessionId: string,
    domain: string,
    key: string,
    value: string
  ): Promise<void> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      const encoded = encodeFileCacheValue(value);
      if (encoded == null) {
        // 退化分支（理论不发生）：value 非 FileCachePayload 形态 JSON 时
        // codec 返回 null，退回旧表存储，保证 get 对任意字符串逐字节还原。
        await this.setLegacyEntry(sessionId, domain, key, value);
        return;
      }
      // 写序必须先内容后引用：中途崩溃最坏产生孤儿 blob（GC 可回收），
      // 绝不悬空引用（get 失败返回 null 走既有 miss 自愈链路）。
      // INSERT OR IGNORE 幂等：同 hash 已存在则复用原行，不改 encoding/bytes
      //（对齐 SqliteVfsContentStore.put 的复用分支）。
      await executeTemplate(
        this.conn,
        this.parser,
        `INSERT OR IGNORE INTO session_file_cache_blob
           (content_hash, encoding, bytes, byte_len)
         VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})`,
        {
          contentHash: encoded.contentHash,
          encoding: encoded.encoding,
          bytes: encoded.bytes,
          byteLen: encoded.byteLen,
        }
      );
      await executeTemplate(
        this.conn,
        this.parser,
        `INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms)
         VALUES (#{sessionId}, #{key}, #{contentHash}, #{mtimeMs})
         ON CONFLICT(session_id, key) DO UPDATE SET
           content_hash = excluded.content_hash,
           mtime_ms = excluded.mtime_ms`,
        {
          sessionId,
          key,
          contentHash: encoded.contentHash,
          mtimeMs: encoded.mtimeMs,
        }
      );
      return;
    }
    await this.setLegacyEntry(sessionId, domain, key, value);
  }

  async delete(
    sessionId: string,
    domain: string,
    key: string
  ): Promise<boolean> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 只删 entry 引用行，blob 留给 runDeferredFileCacheGc 回收；
      // 旧表行一并防御性删除（覆盖退化路径写入的理论行）。
      const entryResult = await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM session_file_cache_entry
         WHERE session_id = #{sessionId} AND key = #{key}`,
        { sessionId, key }
      );
      const legacyResult = await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM session_kkv_entry
         WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`,
        { sessionId, domain, key }
      );
      return entryResult.changes + legacyResult.changes > 0;
    }
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`,
      { sessionId, domain, key }
    );
    return result.changes > 0;
  }

  async clearDomain(sessionId: string, domain: string): Promise<void> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 只删该会话 entry 引用行，blob 与其他会话 entry 不动（GC 按全库
      // 引用集判定）；旧表行一并防御性删除（退化路径理论行）。
      await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId}`,
        { sessionId }
      );
      await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM session_kkv_entry
         WHERE session_id = #{sessionId} AND domain = #{domain}`,
        { sessionId, domain }
      );
      return;
    }
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain}`,
      { sessionId, domain }
    );
  }

  async clearSession(sessionId: string): Promise<void> {
    // file_cache 域引用行在新表；旧表 DELETE 原逻辑不动（顺带清掉退化
    // 路径写入的理论行），新表 entry 引用行单独清，blob 留给 GC。
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId}`,
      { sessionId }
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId}`,
      { sessionId }
    );
  }

  async listKeys(sessionId: string, domain: string): Promise<string[]> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 键集合口径不变：键名即 `{status}:{path}`。退化路径写入旧表的键
      // 理论不出现（codec null 分支仅防御 get 逐字节还原合同），不并入。
      const rows = await queryTemplate<{ key: string }>(
        this.conn,
        this.parser,
        `SELECT key FROM session_file_cache_entry
         WHERE session_id = #{sessionId}
         ORDER BY key`,
        { sessionId }
      );
      return rows.map((row) => String(row.key));
    }
    const rows = await queryTemplate<{ key: string }>(
      this.conn,
      this.parser,
      `SELECT key FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain}
       ORDER BY key`,
      { sessionId, domain }
    );
    return rows.map((row) => String(row.key));
  }

  /**
   * file_cache 域 get：entry 引用行拿 hash+mtime，两跳查 blob 解压，
   * 用 serializeFileCachePayload 还原出与 set 时逐字节相同的 JSON 字符串
   * （set 侧 value 均为 serializeFileCachePayload 产物，键序固定）。
   *
   * entry 行缺失时回退旧表（退化路径存储位置）；blob 缺失 / 解压失败
   * 返回 null（上层当 miss 自愈重读，不抛异常）。
   */
  private async getFileCacheEntry(
    sessionId: string,
    key: string
  ): Promise<SessionKkvEntry | null> {
    const entries = await queryTemplate<{
      content_hash: string;
      mtime_ms: number;
    }>(
      this.conn,
      this.parser,
      `SELECT content_hash, mtime_ms FROM session_file_cache_entry
       WHERE session_id = #{sessionId} AND key = #{key}`,
      { sessionId, key }
    );
    if (entries.length === 0) {
      return this.getLegacyEntry(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, key);
    }
    const entry = entries[0]!;
    const blobs = await queryTemplate<{ encoding: string; bytes: SqlValue }>(
      this.conn,
      this.parser,
      `SELECT encoding, bytes FROM session_file_cache_blob
       WHERE content_hash = #{contentHash}`,
      { contentHash: String(entry.content_hash) }
    );
    if (blobs.length === 0) {
      return null;
    }
    const blob = blobs[0]!;
    try {
      const body = decodeFileCacheBlobBody(String(blob.encoding), blob.bytes);
      return {
        sessionId,
        domain: SESSION_KKV_DOMAIN_FILE_CACHE,
        key,
        value: serializeFileCachePayload({
          body,
          mtimeMs: Number(entry.mtime_ms),
        }),
      };
    } catch {
      // 解压 / 解码失败：按 miss 自愈返回 null，不向调用方抛异常。
      return null;
    }
  }

  /** 原 `session_kkv_entry` 单行查询（分流前的 get 逻辑，原样保留）。 */
  private async getLegacyEntry(
    sessionId: string,
    domain: string,
    key: string
  ): Promise<SessionKkvEntry | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, domain, key, value FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`,
      { sessionId, domain, key }
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToEntry(rows[0]!);
  }

  /** 原 `session_kkv_entry` upsert（分流前的 set 逻辑，原样保留）。 */
  private async setLegacyEntry(
    sessionId: string,
    domain: string,
    key: string,
    value: string
  ): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_kkv_entry (session_id, domain, key, value)
       VALUES (#{sessionId}, #{domain}, #{key}, #{value})
       ON CONFLICT(session_id, domain, key) DO UPDATE SET value = excluded.value`,
      { sessionId, domain, key, value }
    );
  }
}
