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
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { SqlValue } from "@/infra/tdbc/types.js";
import type { SessionKkvEntry } from "../../model/session-kkv-entry.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "../../model/session-kkv-domains.js";
import { compressFileCacheBodyForBlob, decodeFileCacheBlobBody, hashFileCachePayload } from "../../logic/file-cache-blob-codec.js";
import { lookupDecodedContentBody, rememberDecodedContentBody } from "@/infra/content-cache/logic/decoded-content-cache.js";
import { serializeFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import type { SessionKkvRepository } from "../session-kkv.port.js";

/** getMany IN 子句分片大小（双驱动绑参上限的保守值）。 */
const GET_MANY_CHUNK_SIZE = 400;

/** 构造 IN (#{p0}, #{p1}, …) 形态的绑定与片段（对齐 vfs-revision 先例）。 */
function buildInBindings(values: readonly string[], prefix: string): { bindings: Record<string, string>; inList: string } {
  const bindings: Record<string, string> = {};
  const placeholders: string[] = [];
  for (const [index, value] of values.entries()) {
    bindings[`${prefix}${index}`] = value;
    placeholders.push(`#{${prefix}${index}}`);
  }
  return { bindings, inList: placeholders.join(", ") };
}

/**
 * 基于 TDBC 的 `session_kkv_entry` 仓储。
 */
export class SqliteSessionKkvRepository implements SessionKkvRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(sessionId: string, domain: string, key: string): Promise<SessionKkvEntry | null> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // entry 引用行拿 hash+mtime，两跳查 blob 解压，用 serializeFileCachePayload
      // 还原出与 set 时逐字节相同的 JSON 字符串（set 侧 value 均为
      // serializeFileCachePayload 产物，键序固定）。entry 行缺失时回退旧表
      //（退化路径存储位置）；blob 缺失 / 解压失败返回 null（上层当 miss 自愈重读）。
      const entrySql = `SELECT content_hash, mtime_ms FROM session_file_cache_entry WHERE session_id = #{sessionId} AND key = #{key}`;
      const entries = await queryTemplate<{ content_hash: string; mtime_ms: number }>(this.conn, this.parser, entrySql, { sessionId, key });
      if (entries.length === 0) {
        return this.getLegacyEntry(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, key);
      }
      const entry = entries[0]!;
      const contentHash = String(entry.content_hash);
      const mtimeMs = Number(entry.mtime_ms);
      // 解压产物进程内层（见 getMany 的说明）：命中即免掉 blob 行读取与
      // inflate，直接用 entry 行的 mtime 还原出与 set 时同形的 JSON。
      const cachedBody = lookupDecodedContentBody(contentHash);
      if (cachedBody != null) {
        return { sessionId, domain: SESSION_KKV_DOMAIN_FILE_CACHE, key, value: serializeFileCachePayload({ body: cachedBody, mtimeMs }) };
      }
      const blobSql = `SELECT encoding, bytes FROM session_file_cache_blob WHERE content_hash = #{contentHash}`;
      const blobs = await queryTemplate<{ encoding: string; bytes: SqlValue }>(this.conn, this.parser, blobSql, { contentHash });
      if (blobs.length === 0) {
        return null;
      }
      const blob = blobs[0]!;
      const decoded = decodeFileCacheBlobBody(String(blob.encoding), blob.bytes);
      if (!decoded.ok) {
        // 解压 / 解码失败：按 miss 自愈返回 null，不向调用方抛异常。
        return null;
      }
      const body = decoded.value;
      rememberDecodedContentBody(contentHash, body);
      return { sessionId, domain: SESSION_KKV_DOMAIN_FILE_CACHE, key, value: serializeFileCachePayload({ body, mtimeMs }) };
    }
    return this.getLegacyEntry(sessionId, domain, key);
  }

  /**
   * 批量 get：file_cache 域两条 IN 查询（entries + blobs）替代每键两跳——
   * workplace 组装几十个规则文件时的读链从 2N 条串行 SQL 收敛到常数条，
   * 这是单连接串行执行下唯一正确的提速形态（并发查询不解决问题，见
   * TDBC AsyncMutex 设计说明）。miss 键不进结果（与单键 get 缺失即 miss
   * 同口径）；键去重、超 400 分片。
   */
  async getMany(sessionId: string, domain: string, keys: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(keys)];
    if (unique.length === 0) {
      return out;
    }
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      const missing: string[] = [];
      for (let i = 0; i < unique.length; i += GET_MANY_CHUNK_SIZE) {
        const chunk = unique.slice(i, i + GET_MANY_CHUNK_SIZE);
        const keyBindings = buildInBindings(chunk, "k");
        const entriesSql = `SELECT key, content_hash, mtime_ms FROM session_file_cache_entry WHERE session_id = #{sessionId} AND key IN (${keyBindings.inList})`;
        const entries = await queryTemplate<{ key: string; content_hash: string; mtime_ms: number }>(this.conn, this.parser, entriesSql, { sessionId, ...keyBindings.bindings });
        if (entries.length === 0) {
          missing.push(...chunk);
          continue;
        }
        const foundKeys = new Set(entries.map((row) => String(row.key)));
        for (const key of chunk) {
          if (!foundKeys.has(key)) {
            missing.push(key);
          }
        }
        // 解压产物进程内层（infra/content-cache）：entry 行给 hash，
        // 命中即免掉「blob 行读取 + inflate」——workplace 每次进会话
        // 都要把整批文件正文重新解压一遍，这里正是那笔钱。只把 miss
        // 的 hash 投进 blob IN 查询（内存命中时连这趟 SQL 都省了）。
        const bodies = new Map<string, string>();
        const hashesToLoad: string[] = [];
        const pendingHashes = new Set<string>();
        for (const entry of entries) {
          const contentHash = String(entry.content_hash);
          if (bodies.has(contentHash) || pendingHashes.has(contentHash)) {
            continue;
          }
          const cachedBody = lookupDecodedContentBody(contentHash);
          if (cachedBody != null) {
            bodies.set(contentHash, cachedBody);
            continue;
          }
          pendingHashes.add(contentHash);
          hashesToLoad.push(contentHash);
        }
        if (hashesToLoad.length > 0) {
          const hashBindings = buildInBindings(hashesToLoad, "h");
          const blobsSql = `SELECT content_hash, encoding, bytes FROM session_file_cache_blob WHERE content_hash IN (${hashBindings.inList})`;
          const blobs = await queryTemplate<{ content_hash: string; encoding: string; bytes: SqlValue }>(this.conn, this.parser, blobsSql, hashBindings.bindings);
          const blobByHash = new Map(blobs.map((row) => [String(row.content_hash), row]));
          for (const contentHash of hashesToLoad) {
            const blob = blobByHash.get(contentHash);
            if (blob == null) {
              continue;
            }
            const decoded = decodeFileCacheBlobBody(String(blob.encoding), blob.bytes);
            if (!decoded.ok) {
              // 解压 / 解码失败：按 miss 跳过（上层自愈重读），与单键 get 同口径。
              continue;
            }
            rememberDecodedContentBody(contentHash, decoded.value);
            bodies.set(contentHash, decoded.value);
          }
        }
        for (const entry of entries) {
          const body = bodies.get(String(entry.content_hash));
          if (body == null) {
            continue;
          }
          out.set(String(entry.key), serializeFileCachePayload({ body, mtimeMs: Number(entry.mtime_ms) }));
        }
      }
      // 退化路径（旧表行）批量补齐：新表没命中的键查一次 legacy。
      if (missing.length > 0) {
        const legacy = await this.getManyLegacy(sessionId, domain, missing);
        for (const [key, value] of legacy) {
          out.set(key, value);
        }
      }
      return out;
    }
    return this.getManyLegacy(sessionId, domain, unique);
  }

  /** 旧表（session_kkv_entry）批量读，供非 file_cache 域与退化路径共用。 */
  private async getManyLegacy(sessionId: string, domain: string, keys: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < keys.length; i += GET_MANY_CHUNK_SIZE) {
      const chunk = keys.slice(i, i + GET_MANY_CHUNK_SIZE);
      const { bindings, inList } = buildInBindings(chunk, "k");
      const rowsSql = `SELECT key, value FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain} AND key IN (${inList})`;
      const rows = await queryTemplate<{ key: string; value: string }>(this.conn, this.parser, rowsSql, { sessionId, domain, ...bindings });
      for (const row of rows) {
        out.set(String(row.key), String(row.value));
      }
    }
    return out;
  }

  async set(sessionId: string, domain: string, key: string, value: string): Promise<void> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 先哈希、查 blob 是否已存在、未命中才压缩（file-cache-blob-codec）：
      // 压缩后回填（置位/压缩清域后的常规路径）内容多数未变，blob 已在库
      // 里时压缩产物会被 INSERT OR IGNORE 整体丢弃——Hermes 纯 JS deflate
      // 一个大文件几十 ms、N 个文件串起来就是可感知的卡顿。
      const hashed = hashFileCachePayload(value);
      if (hashed == null) {
        // 退化分支（理论不发生）：value 非 FileCachePayload 形态 JSON 时
        // codec 返回 null，退回旧表存储，保证 get 对任意字符串逐字节还原。
        await this.setLegacyEntry(sessionId, domain, key, value);
        return;
      }
      // 写序必须先内容后引用：中途崩溃最坏产生孤儿 blob（GC 可回收），
      // 绝不悬空引用（get 失败返回 null 走既有 miss 自愈链路）。
      // INSERT OR IGNORE 幂等：同 hash 已存在则复用原行，不改 encoding/bytes
      //（对齐 SqliteVfsContentStore.put 的复用分支）。
      const blobExistsSql = `SELECT 1 AS hit FROM session_file_cache_blob WHERE content_hash = #{contentHash}`;
      const existing = await queryTemplate<{ hit: number }>(this.conn, this.parser, blobExistsSql, { contentHash: hashed.contentHash });
      if (existing.length === 0) {
        const blob = compressFileCacheBodyForBlob(hashed.body);
        const insertBlobSql = `INSERT OR IGNORE INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len) VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})`;
        await executeTemplate(this.conn, this.parser, insertBlobSql, { contentHash: hashed.contentHash, encoding: blob.encoding, bytes: blob.bytes, byteLen: blob.byteLen });
      }
      const upsertEntrySql = `INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms) VALUES (#{sessionId}, #{key}, #{contentHash}, #{mtimeMs}) ON CONFLICT(session_id, key) DO UPDATE SET content_hash = excluded.content_hash, mtime_ms = excluded.mtime_ms`;
      await executeTemplate(this.conn, this.parser, upsertEntrySql, { sessionId, key, contentHash: hashed.contentHash, mtimeMs: hashed.mtimeMs });
      return;
    }
    await this.setLegacyEntry(sessionId, domain, key, value);
  }

  async delete(sessionId: string, domain: string, key: string): Promise<boolean> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 只删 entry 引用行，blob 留给 runDeferredFileCacheGc 回收；
      // 旧表行一并防御性删除（覆盖退化路径写入的理论行）。
      const deleteEntrySql = `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId} AND key = #{key}`;
      const entryResult = await executeTemplate(this.conn, this.parser, deleteEntrySql, { sessionId, key });
      const deleteLegacySql = `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`;
      const legacyResult = await executeTemplate(this.conn, this.parser, deleteLegacySql, { sessionId, domain, key });
      return entryResult.changes + legacyResult.changes > 0;
    }
    const deleteSql = `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`;
    const result = await executeTemplate(this.conn, this.parser, deleteSql, { sessionId, domain, key });
    return result.changes > 0;
  }

  async clearDomain(sessionId: string, domain: string): Promise<void> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 只删该会话 entry 引用行，blob 与其他会话 entry 不动（GC 按全库
      // 引用集判定）；旧表行一并防御性删除（退化路径理论行）。
      const clearEntrySql = `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId}`;
      await executeTemplate(this.conn, this.parser, clearEntrySql, { sessionId });
      const clearLegacySql = `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain}`;
      await executeTemplate(this.conn, this.parser, clearLegacySql, { sessionId, domain });
      return;
    }
    const clearSql = `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain}`;
    await executeTemplate(this.conn, this.parser, clearSql, { sessionId, domain });
  }

  async clearSession(sessionId: string): Promise<void> {
    // file_cache 域引用行在新表；旧表 DELETE 原逻辑不动（顺带清掉退化
    // 路径写入的理论行），新表 entry 引用行单独清，blob 留给 GC。
    await executeTemplate(this.conn, this.parser, `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId}`, { sessionId });
    await executeTemplate(this.conn, this.parser, `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId}`, { sessionId });
  }

  async listKeys(sessionId: string, domain: string): Promise<string[]> {
    if (domain === SESSION_KKV_DOMAIN_FILE_CACHE) {
      // 键集合口径不变：键名即 `{status}:{path}`。退化路径（codec null）
      // 写入旧表的键必须并入——既有调用方对任意字符串 set 后 listKeys
      // 都要能列出（T-CC4/T-IC3 以裸字符串预置缓存），UNION 自带去重。
      const unionSql = `SELECT key FROM session_file_cache_entry WHERE session_id = #{sessionId} UNION SELECT key FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain} ORDER BY key`;
      const rows = await queryTemplate<{ key: string }>(this.conn, this.parser, unionSql, { sessionId, domain });
      return rows.map((row) => String(row.key));
    }
    const listSql = `SELECT key FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain} ORDER BY key`;
    const rows = await queryTemplate<{ key: string }>(this.conn, this.parser, listSql, { sessionId, domain });
    return rows.map((row) => String(row.key));
  }

  /** 原 `session_kkv_entry` 单行查询（分流前的 get 逻辑，原样保留）。 */
  private async getLegacyEntry(sessionId: string, domain: string, key: string): Promise<SessionKkvEntry | null> {
    const legacySql = `SELECT session_id, domain, key, value FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`;
    const rows = await queryTemplate(this.conn, this.parser, legacySql, { sessionId, domain, key });
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    return { sessionId: String(row.session_id), domain: String(row.domain), key: String(row.key), value: String(row.value) };
  }

  /** 原 `session_kkv_entry` upsert（分流前的 set 逻辑，原样保留）。 */
  private async setLegacyEntry(sessionId: string, domain: string, key: string, value: string): Promise<void> {
    const upsertSql = `INSERT INTO session_kkv_entry (session_id, domain, key, value) VALUES (#{sessionId}, #{domain}, #{key}, #{value}) ON CONFLICT(session_id, domain, key) DO UPDATE SET value = excluded.value`;
    await executeTemplate(this.conn, this.parser, upsertSql, { sessionId, domain, key, value });
  }
}
