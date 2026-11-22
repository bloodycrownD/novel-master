/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/session-kkv.mapper.xml 生成，勿手改。
 * namespace=session_kkv；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const SessionKkvSql = {
    listLegacyByKeys: `SELECT key, value
    FROM session_kkv_entry
    WHERE session_id = #{sessionId} AND domain = #{domain} AND key IN (<foreach collection="keys" item="k" separator=", ">#{k}</foreach>)
`,
    deleteLegacyByKey: `DELETE
    FROM session_kkv_entry
    WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}
`,
    deleteByDomain: `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId} AND domain = #{domain}
`,
    deleteBySession: `DELETE
    FROM session_kkv_entry
    WHERE session_id = #{sessionId}
`,
    listKeysWithFileCache: `SELECT key
    FROM session_file_cache_entry
    WHERE session_id = #{sessionId} UNION SELECT key
    FROM session_kkv_entry
    WHERE session_id = #{sessionId} AND domain = #{domain}
    ORDER BY key
`,
    listKeysByDomain: `SELECT key
    FROM session_kkv_entry
    WHERE session_id = #{sessionId} AND domain = #{domain}
    ORDER BY key
`,
    getByKey: `SELECT session_id, domain, key, value
    FROM session_kkv_entry
    WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}
`,
    upsert: `INSERT INTO session_kkv_entry (session_id, domain, key, value)
    VALUES (#{sessionId}, #{domain}, #{key}, #{value})
    ON CONFLICT(session_id, domain, key) DO UPDATE
    SET value = excluded.value
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const SessionKkvSqlParams = {
    listLegacyByKeys: ["sessionId", "domain", "k"],
    deleteLegacyByKey: ["sessionId", "domain", "key"],
    deleteByDomain: ["sessionId", "domain"],
    deleteBySession: ["sessionId"],
    listKeysWithFileCache: ["sessionId", "domain"],
    listKeysByDomain: ["sessionId", "domain"],
    getByKey: ["sessionId", "domain", "key"],
    upsert: ["sessionId", "domain", "key", "value"],
} as const;
