/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/vfs-content-store.mapper.xml 生成，勿手改。
 * namespace=vfs_content_store；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const VfsContentStoreSql = {
    putSelectExisting: `SELECT content_hash
    FROM vfs_content_blob
    WHERE content_hash = #{contentHash}
`,
    putInsertRecomputedRefCount: `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
         VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen},
           (SELECT COUNT(*) FROM vfs_revision WHERE content_hash = #{contentHash}))
`,
    putInsert: `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
         VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})
`,
    get: `SELECT encoding, bytes
    FROM vfs_content_blob
    WHERE content_hash = #{contentHash}
`,
    getMember: `SELECT m.offset, m.length, p.format, p.bytes
       FROM vfs_content_pack_member m
       JOIN vfs_content_pack p ON p.pack_id = m.pack_id
       WHERE m.content_hash = #{contentHash}
`,
    getMany: `SELECT content_hash, encoding, bytes
    FROM vfs_content_blob
    WHERE content_hash IN (<foreach collection="hashes" item="h" separator=",">#{h}</foreach>)
`,
    getManyMember: `SELECT content_hash, pack_id, offset, length
    FROM vfs_content_pack_member
    WHERE content_hash IN (<foreach collection="hashes" item="h" separator=",">#{h}</foreach>)
`,
    getManyPack: `SELECT pack_id, format, bytes
    FROM vfs_content_pack
    WHERE pack_id IN (<foreach collection="packIds" item="packId" separator=",">#{packId}</foreach>)
`,
    findExistingBlobHashes: `SELECT content_hash
    FROM ( SELECT content_hash
    FROM vfs_content_blob UNION ALL SELECT content_hash
    FROM vfs_content_pack_member )
    WHERE content_hash IN (<foreach collection="hashes" item="h" separator=",">#{h}</foreach>)
`,
    ensureBlob: `SELECT content_hash FROM vfs_content_blob WHERE content_hash = #{contentHash}
       UNION ALL
       SELECT content_hash FROM vfs_content_pack_member WHERE content_hash = #{contentHash}
`,
    gcBlobs: `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (
        SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
        UNION
        SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
      )
`,
    gcPackMembers: `DELETE FROM vfs_content_pack_member WHERE content_hash NOT IN (
        SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
        UNION
        SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
      )
`,
    gcPacks: `DELETE FROM vfs_content_pack
       WHERE pack_id NOT IN (SELECT pack_id FROM vfs_content_pack_member)
`,
    deleteMemberRow: `DELETE
    FROM vfs_content_pack_member
    WHERE content_hash = #{contentHash}
`,
    findContentSizeByPathBlobBytes: `SELECT byte_len FROM vfs_content_blob
         WHERE content_hash = #{contentHash}
`,
    findContentSizeByPathMemberBytes: `SELECT compressed_byte_len FROM vfs_content_pack_member
         WHERE content_hash = #{contentHash}
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const VfsContentStoreSqlParams = {
    putSelectExisting: ["contentHash"],
    putInsertRecomputedRefCount: ["contentHash", "encoding", "bytes", "byteLen"],
    putInsert: ["contentHash", "encoding", "bytes", "byteLen"],
    get: ["contentHash"],
    getMember: ["contentHash"],
    getMany: ["h"],
    getManyMember: ["h"],
    getManyPack: ["packId"],
    findExistingBlobHashes: ["h"],
    ensureBlob: ["contentHash"],
    gcBlobs: [],
    gcPackMembers: [],
    gcPacks: [],
    deleteMemberRow: ["contentHash"],
    findContentSizeByPathBlobBytes: ["contentHash"],
    findContentSizeByPathMemberBytes: ["contentHash"],
} as const;
