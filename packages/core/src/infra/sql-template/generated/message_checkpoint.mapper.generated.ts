/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/message-checkpoint.mapper.xml 生成，勿手改。
 * namespace=message_checkpoint；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const MessageCheckpointSql = {
    hasCheckpoint: `SELECT 1 AS one FROM message_checkpoint
       WHERE session_id = #{sessionId} AND message_id = #{messageId}
       LIMIT 1
`,
    hasAnyCheckpointForSession: `SELECT 1 AS one FROM message_checkpoint
       WHERE session_id = #{sessionId}
       LIMIT 1
`,
    countCheckpointsForMessages: `SELECT COUNT(*) AS n
    FROM message_checkpoint
    WHERE session_id = #{sessionId} AND message_id IN (<foreach collection="ids" item="id" separator=", ">#{id}</foreach>)
`,
    insertCheckpointSelectOldFiles: `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id = #{messageId}
`,
    insertCheckpointDeleteOldFiles: `DELETE FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id = #{messageId}
`,
    insertCheckpointDeleteCheckpoint: `DELETE FROM message_checkpoint
       WHERE session_id = #{sessionId} AND message_id = #{messageId}
`,
    insertCheckpointInsertCheckpoint: `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms)
       VALUES (#{sessionId}, #{messageId}, #{createdAtMs})
`,
    insertCheckpointInsertFiles: `INSERT INTO message_checkpoint_file (session_id, message_id, entry_id, revision_version, path)
    VALUES (?, ?, ?, ?, ?)
`,
    seedCheckpointsInsertCheckpoints: `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms) VALUES <foreach collection="rows" item="row" separator=",">(?, ?, ?)</foreach>
`,
    seedCheckpointsInsertFiles: `INSERT INTO message_checkpoint_file (session_id, message_id, entry_id, revision_version, path) VALUES <foreach collection="rows" item="row" separator=",">(?, ?, ?, ?, ?)</foreach>
`,
    loadFilePointerTree: `SELECT mcf.path AS snapshot_path, e.path AS live_path,
              mcf.entry_id AS entry_id, mcf.revision_version AS revision_version
       FROM message_checkpoint_file mcf
       LEFT JOIN vfs_entry e ON e.entry_id = mcf.entry_id
       WHERE mcf.session_id = #{sessionId} AND mcf.message_id = #{messageId}
`,
    findCheckpointMessageIdAtOrBefore: `SELECT mc.message_id
       FROM message_checkpoint mc
       JOIN chat_message cm
         ON cm.id = mc.message_id AND cm.session_id = mc.session_id
       WHERE mc.session_id = #{sessionId} AND cm.seq <= #{maxSeq}
       ORDER BY cm.seq DESC
       LIMIT 1
`,
    findLastCheckpointedMessageId: `SELECT mc.message_id
       FROM message_checkpoint mc
       JOIN chat_message cm
         ON cm.id = mc.message_id AND cm.session_id = mc.session_id
       WHERE mc.session_id = #{sessionId}
       ORDER BY cm.seq DESC
       LIMIT 1
`,
    listFilePointersForSession: `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}
`,
    listDistinctCheckpointPointersForSession: `SELECT DISTINCT entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}
`,
    listFilePointersForMessages: `SELECT session_id, message_id, entry_id, revision_version
    FROM message_checkpoint_file
    WHERE session_id = #{sessionId} AND message_id IN (<foreach collection="ids" item="id" separator=", ">#{id}</foreach>)
`,
    deleteCheckpointsForMessagesSelectFiles: `SELECT session_id, message_id, entry_id, revision_version
    FROM message_checkpoint_file
    WHERE session_id = #{sessionId} AND message_id IN (<foreach collection="ids" item="id" separator=", ">#{id}</foreach>)
`,
    deleteCheckpointsForMessagesDeleteFiles: `DELETE
    FROM message_checkpoint_file
    WHERE session_id = #{sessionId} AND message_id IN (<foreach collection="ids" item="id" separator=", ">#{id}</foreach>)
`,
    deleteCheckpointsForMessagesDeleteCheckpoints: `DELETE
    FROM message_checkpoint
    WHERE session_id = #{sessionId} AND message_id IN (<foreach collection="ids" item="id" separator=", ">#{id}</foreach>)
`,
    deleteCheckpointsForSessionSelectFiles: `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}
`,
    deleteCheckpointsForSessionDeleteFiles: `DELETE
    FROM message_checkpoint_file
    WHERE session_id = #{sessionId}
`,
    deleteCheckpointsForSessionDeleteCheckpoints: `DELETE
    FROM message_checkpoint
    WHERE session_id = #{sessionId}
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const MessageCheckpointSqlFragments = {
    filePointerColumns: `session_id, message_id, entry_id, revision_version
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const MessageCheckpointSqlParams = {
    hasCheckpoint: ["sessionId", "messageId"],
    hasAnyCheckpointForSession: ["sessionId"],
    countCheckpointsForMessages: ["sessionId", "id"],
    insertCheckpointSelectOldFiles: ["sessionId", "messageId"],
    insertCheckpointDeleteOldFiles: ["sessionId", "messageId"],
    insertCheckpointDeleteCheckpoint: ["sessionId", "messageId"],
    insertCheckpointInsertCheckpoint: ["sessionId", "messageId", "createdAtMs"],
    insertCheckpointInsertFiles: [],
    seedCheckpointsInsertCheckpoints: [],
    seedCheckpointsInsertFiles: [],
    loadFilePointerTree: ["sessionId", "messageId"],
    findCheckpointMessageIdAtOrBefore: ["sessionId", "maxSeq"],
    findLastCheckpointedMessageId: ["sessionId"],
    listFilePointersForSession: ["sessionId"],
    listDistinctCheckpointPointersForSession: ["sessionId"],
    listFilePointersForMessages: ["sessionId", "id"],
    deleteCheckpointsForMessagesSelectFiles: ["sessionId", "id"],
    deleteCheckpointsForMessagesDeleteFiles: ["sessionId", "id"],
    deleteCheckpointsForMessagesDeleteCheckpoints: ["sessionId", "id"],
    deleteCheckpointsForSessionSelectFiles: ["sessionId"],
    deleteCheckpointsForSessionDeleteFiles: ["sessionId"],
    deleteCheckpointsForSessionDeleteCheckpoints: ["sessionId"],
} as const;
