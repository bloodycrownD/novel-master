/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/file-cache.mapper.xml 生成，勿手改。
 * namespace=file_cache；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const FileCacheSql = {
    selectEntryHash: `SELECT content_hash, mtime_ms
    FROM session_file_cache_entry
    WHERE session_id = #{sessionId} AND key = #{key}
`,
    selectBlobBody: `SELECT encoding, bytes FROM session_file_cache_blob WHERE content_hash = #{contentHash}
`,
    listEntriesByKeys: `SELECT key, content_hash, mtime_ms
    FROM session_file_cache_entry
    WHERE session_id = #{sessionId} AND key IN (<foreach collection="keys" item="k" separator=", ">#{k}</foreach>)
`,
    listBlobsByHashes: `SELECT content_hash, encoding, bytes
    FROM session_file_cache_blob
    WHERE content_hash IN (<foreach collection="hashes" item="h" separator=", ">#{h}</foreach>)
`,
    blobExists: `SELECT 1 AS hit FROM session_file_cache_blob WHERE content_hash = #{contentHash}
`,
    insertBlob: `INSERT OR IGNORE INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len)
    VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})
`,
    upsertEntry: `INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms)
    VALUES (#{sessionId}, #{key}, #{contentHash}, #{mtimeMs})
    ON CONFLICT(session_id, key) DO UPDATE
    SET content_hash = excluded.content_hash, mtime_ms = excluded.mtime_ms
`,
    deleteEntry: `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId} AND key = #{key}
`,
    deleteEntriesBySession: `DELETE
    FROM session_file_cache_entry
    WHERE session_id = #{sessionId}
`,
    deleteOrphanBlobs: `DELETE
    FROM session_file_cache_blob
    WHERE content_hash NOT IN (SELECT content_hash
    FROM session_file_cache_entry
    WHERE content_hash IS NOT NULL)
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const FileCacheSqlParams = {
    selectEntryHash: ["sessionId", "key"],
    selectBlobBody: ["contentHash"],
    listEntriesByKeys: ["sessionId", "k"],
    listBlobsByHashes: ["h"],
    blobExists: ["contentHash"],
    insertBlob: ["contentHash", "encoding", "bytes", "byteLen"],
    upsertEntry: ["sessionId", "key", "contentHash", "mtimeMs"],
    deleteEntry: ["sessionId", "key"],
    deleteEntriesBySession: ["sessionId"],
    deleteOrphanBlobs: [],
} as const;
