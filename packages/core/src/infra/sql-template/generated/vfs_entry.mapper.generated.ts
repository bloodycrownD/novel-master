/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/vfs-entry.mapper.xml 生成，勿手改。
 * namespace=vfs_entry；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const VfsEntrySql = {
    list: `SELECT path, entry_kind, head_version FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND path LIKE #{pattern} ESCAPE '\\'
`,
    findByPath: `SELECT entry_id, scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind
       FROM vfs_entry WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    findContentHash: `SELECT content_hash, entry_kind FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    findContentHashesByPaths: `SELECT path, content_hash, entry_kind
    FROM vfs_entry
    WHERE scope_key = #{scopeKey} AND path IN (<foreach collection="paths" item="p" separator=", ">#{p}</foreach>)
`,
    findContentSizeByPath: `SELECT length(content) AS inline_chars, content_hash, entry_kind, mtime_ms
       FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    selectHeadVersionByPath: `SELECT head_version FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    selectEntryIdByPath: `SELECT entry_id FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    insertWithContentHash: `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')
`,
    insertAtVersion: `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')
`,
    insertDirectory: `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, NULL, 1, #{mtimeMs}, 'directory')
`,
    reviveEntryAtVersion: `INSERT INTO vfs_entry (entry_id, scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{entryId}, #{scopeKey}, #{path}, NULL, #{contentHash}, #{headVersion}, #{mtimeMs}, 'file')
`,
    updateWithContentHash: `UPDATE vfs_entry
       SET content = NULL,
           content_hash = #{contentHash},
           head_version = #{nextVersion},
           mtime_ms = #{mtimeMs}
       WHERE scope_key = #{scopeKey} AND path = #{path} AND entry_kind = 'file'
`,
    setHeadContentHash: `UPDATE vfs_entry
         SET content = NULL,
             content_hash = #{contentHash},
             head_version = #{version},
             mtime_ms = #{mtimeMs},
             entry_kind = 'file'
         WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    setHeadContentHashInsert: `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')
`,
    deleteChildProbe: `SELECT 1 FROM vfs_entry
         WHERE scope_key = #{scopeKey}
           AND path LIKE #{pattern} ESCAPE '\\'
           AND path <> #{path}
         LIMIT 1
`,
    deleteExact: `DELETE
    FROM vfs_entry
    WHERE scope_key = #{scopeKey} AND path = #{path}
`,
    deleteRecursive: `DELETE FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
`,
    listAllPaths: `SELECT path FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND entry_kind = 'file'
       ORDER BY path
`,
    listDirectoryPathsUnderPrefix: `SELECT path FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'directory'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path
`,
    listDirectoryMetaUnderPrefix: `SELECT path, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'directory'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path
`,
    listEntriesUnderPrefix: `SELECT path, entry_kind FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path
`,
    listFileMetaUnderPrefix: `SELECT path, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path
`,
    computeEntrySignature: `SELECT count(*) AS entry_count, group_concat(s, char(31)) AS sig
       FROM (SELECT path || ':' || head_version || ':' || mtime_ms AS s
             FROM vfs_entry
             WHERE scope_key = #{scopeKey}
             ORDER BY path)
`,
    listFileHeadsUnderPrefix: `SELECT entry_id, path, head_version, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path
`,
    scanContents: `SELECT entry_id, path, content_hash FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND entry_kind = 'file'
`,
    scanContentsUnderPrefix: `SELECT entry_id, path, content_hash FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
`,
    scanFileEntriesWithMeta: `SELECT entry_id, path, content_hash, head_version, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND entry_kind = 'file'
`,
    scanFileEntriesWithMetaUnderPrefix: `SELECT entry_id, path, content_hash, head_version, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
`,
    findExistingPaths: `SELECT path
    FROM vfs_entry
    WHERE scope_key = #{scopeKey} AND path IN (<foreach collection="paths" item="p" separator=", ">#{p}</foreach>)
`,
    batchInsertFileEntriesWithHash: `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
    VALUES (?, ?, NULL, ?, 1, ?, 'file')
`,
    batchInsertDirectoryEntries: `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
    VALUES (?, ?, NULL, NULL, 1, ?, 'directory')
`,
    renamePathInScope: `UPDATE vfs_entry SET path = #{newPath}
       WHERE scope_key = #{scopeKey} AND path = #{oldPath}
`,
    renamePrefixInScope: `UPDATE vfs_entry
       SET path = #{newWithSlash} || substr(path, length(#{oldWithSlash}) + 1)
       WHERE scope_key = #{scopeKey}
         AND path LIKE #{pattern} ESCAPE '\\'
`,
    renamePrefixInScopeRoot: `UPDATE vfs_entry SET path = #{newBase}
       WHERE scope_key = #{scopeKey} AND path = #{oldBase}
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const VfsEntrySqlParams = {
    list: ["scopeKey", "pattern"],
    findByPath: ["scopeKey", "path"],
    findContentHash: ["scopeKey", "path"],
    findContentHashesByPaths: ["scopeKey", "p"],
    findContentSizeByPath: ["scopeKey", "path"],
    selectHeadVersionByPath: ["scopeKey", "path"],
    selectEntryIdByPath: ["scopeKey", "path"],
    insertWithContentHash: ["scopeKey", "path", "contentHash", "version", "mtimeMs"],
    insertAtVersion: ["scopeKey", "path", "contentHash", "version", "mtimeMs"],
    insertDirectory: ["scopeKey", "path", "mtimeMs"],
    reviveEntryAtVersion: ["entryId", "scopeKey", "path", "contentHash", "headVersion", "mtimeMs"],
    updateWithContentHash: ["contentHash", "nextVersion", "mtimeMs", "scopeKey", "path"],
    setHeadContentHash: ["contentHash", "version", "mtimeMs", "scopeKey", "path"],
    setHeadContentHashInsert: ["scopeKey", "path", "contentHash", "version", "mtimeMs"],
    deleteChildProbe: ["scopeKey", "pattern", "path"],
    deleteExact: ["scopeKey", "path"],
    deleteRecursive: ["scopeKey", "path", "pattern"],
    listAllPaths: ["scopeKey"],
    listDirectoryPathsUnderPrefix: ["scopeKey", "path", "pattern"],
    listDirectoryMetaUnderPrefix: ["scopeKey", "path", "pattern"],
    listEntriesUnderPrefix: ["scopeKey", "path", "pattern"],
    listFileMetaUnderPrefix: ["scopeKey", "path", "pattern"],
    computeEntrySignature: ["scopeKey"],
    listFileHeadsUnderPrefix: ["scopeKey", "path", "pattern"],
    scanContents: ["scopeKey"],
    scanContentsUnderPrefix: ["scopeKey", "path", "pattern"],
    scanFileEntriesWithMeta: ["scopeKey"],
    scanFileEntriesWithMetaUnderPrefix: ["scopeKey", "path", "pattern"],
    findExistingPaths: ["scopeKey", "p"],
    batchInsertFileEntriesWithHash: [],
    batchInsertDirectoryEntries: [],
    renamePathInScope: ["newPath", "scopeKey", "oldPath"],
    renamePrefixInScope: ["newWithSlash", "oldWithSlash", "scopeKey", "pattern"],
    renamePrefixInScopeRoot: ["newBase", "scopeKey", "oldBase"],
} as const;
