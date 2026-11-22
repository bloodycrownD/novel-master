/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/vfs-revision.mapper.xml 生成，勿手改。
 * namespace=vfs_revision；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const VfsRevisionSql = {
    findMaxVersionForEntry: `SELECT MAX(version) AS max_version
    FROM vfs_revision
    WHERE entry_id = #{entryId}
`,
    findMaxVersionsForEntries: `SELECT entry_id, MAX(version) AS max_version
    FROM vfs_revision
    WHERE entry_id IN (<foreach collection="entryIds" item="entryId" separator=", ">#{entryId}</foreach>)
    GROUP BY entry_id
`,
    findByEntryAndVersion: `SELECT entry_id, version, content_hash, status, mtime_ms
       FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}
`,
    existsByEntryAndVersion: `SELECT 1 AS one FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}
       LIMIT 1
`,
    findMetaByEntryAndVersion: `SELECT status, content_hash FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}
       LIMIT 1
`,
    findMetasByEntryVersions: `SELECT entry_id, version, status, content_hash
    FROM vfs_revision
    WHERE <foreach collection="pairs" item="pair" separator=" OR ">(entry_id = #{pair.entryId} AND version = #{pair.version})</foreach>
`,
    findExistingEntryVersionKeys: `SELECT entry_id, version
    FROM vfs_revision
    WHERE (entry_id, version) IN (<foreach collection="pairs" item="pair" separator=",">(#{pair.entryId},#{pair.version})</foreach>)
`,
    batchAppendWithRefCount: `INSERT INTO vfs_revision (entry_id, version, content_hash, status, mtime_ms, ref_count)
    VALUES (?, ?, ?, ?, ?, ?)
`,
    append: `INSERT INTO vfs_revision
       (entry_id, version, content_hash, status, mtime_ms)
       VALUES (#{entryId}, #{version}, #{contentHash}, #{status}, #{mtimeMs})
`,
    listKeysUnderScope: `SELECT r.entry_id AS entry_id, r.version AS version
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = #{scopeKey}
         AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')
       ORDER BY r.entry_id, r.version
`,
    listKeysWithRefCountUnderScope: `SELECT r.entry_id AS entry_id, r.version AS version, r.ref_count AS ref_count
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = #{scopeKey}
         AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')
       ORDER BY r.entry_id, r.version
`,
    deleteExceptReachable: `DELETE FROM vfs_revision WHERE <foreach collection="pairs" item="pair" separator=" OR ">(entry_id = #{pair.entryId} AND version = #{pair.version})</foreach>
`,
    adjustRefCount: `UPDATE vfs_revision SET ref_count = ref_count + #{delta}
       WHERE entry_id = #{entryId} AND version = #{version}
`,
    batchAdjustRefCountWithDelta: `UPDATE vfs_revision
    SET ref_count = ref_count <if test="positive">+ #{delta}</if><if test="negative">- #{absDelta}</if>
    WHERE (entry_id, version) IN (<foreach collection="pointers" item="pair" separator=",">(#{pair.entryId},#{pair.version})</foreach>)<if test="negative"> AND ref_count >= #{absDelta}</if>
`,
    repairRefCountFloorSelect: `SELECT ref_count FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}
`,
    repairRefCountFloor: `UPDATE vfs_revision SET ref_count = #{expected}
       WHERE entry_id = #{entryId} AND version = #{version}
`,
    batchRepairRefCountFloorSelect: `SELECT entry_id, version, ref_count
    FROM vfs_revision
    WHERE (entry_id, version) IN (<foreach collection="pairs" item="pair" separator=",">(#{pair.entryId},#{pair.version})</foreach>)
`,
    batchRepairRefCountFloor: `UPDATE vfs_revision SET ref_count = ? WHERE entry_id = ? AND version = ?
`,
    deleteUnreferencedUnderScopeCount: `SELECT COUNT(*) AS n
    FROM vfs_revision r
    JOIN vfs_entry e ON e.entry_id = r.entry_id
    WHERE e.scope_key = #{scopeKey} AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')<if test="hasExcludes"> AND NOT (<foreach collection="excludes" item="excl" separator=" OR ">(e.path = #{excl.path} OR e.path LIKE #{excl.pattern} ESCAPE '\\')</foreach>)</if> AND r.ref_count <= 0
`,
    deleteUnreferencedUnderScope: `DELETE
    FROM vfs_revision
    WHERE (entry_id, version) IN ( SELECT r.entry_id, r.version
    FROM vfs_revision r
    JOIN vfs_entry e ON e.entry_id = r.entry_id
    WHERE e.scope_key = #{scopeKey} AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')<if test="hasExcludes"> AND NOT (<foreach collection="excludes" item="excl" separator=" OR ">(e.path = #{excl.path} OR e.path LIKE #{excl.pattern} ESCAPE '\\')</foreach>)</if> AND r.ref_count <= 0 )
`,
    deleteGlobalOrphans: `DELETE
    FROM vfs_revision
    WHERE ref_count <= 0 AND entry_id NOT IN (SELECT entry_id
    FROM vfs_entry)
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const VfsRevisionSqlParams = {
    findMaxVersionForEntry: ["entryId"],
    findMaxVersionsForEntries: ["entryId"],
    findByEntryAndVersion: ["entryId", "version"],
    existsByEntryAndVersion: ["entryId", "version"],
    findMetaByEntryAndVersion: ["entryId", "version"],
    findMetasByEntryVersions: [],
    findExistingEntryVersionKeys: [],
    batchAppendWithRefCount: [],
    append: ["entryId", "version", "contentHash", "status", "mtimeMs"],
    listKeysUnderScope: ["scopeKey", "path", "pattern"],
    listKeysWithRefCountUnderScope: ["scopeKey", "path", "pattern"],
    deleteExceptReachable: [],
    adjustRefCount: ["delta", "entryId", "version"],
    batchAdjustRefCountWithDelta: ["delta", "absDelta"],
    repairRefCountFloorSelect: ["entryId", "version"],
    repairRefCountFloor: ["expected", "entryId", "version"],
    batchRepairRefCountFloorSelect: [],
    batchRepairRefCountFloor: [],
    deleteUnreferencedUnderScopeCount: ["scopeKey", "path", "pattern"],
    deleteUnreferencedUnderScope: ["scopeKey", "path", "pattern"],
    deleteGlobalOrphans: [],
} as const;
