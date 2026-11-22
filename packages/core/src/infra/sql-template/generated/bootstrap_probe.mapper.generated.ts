/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/bootstrap-probe.mapper.xml 生成，勿手改。
 * namespace=bootstrap_probe；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const BootstrapProbeSql = {
    probeTable: `SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = #{tableName}
`,
    probeWorktreeRuleTable: `SELECT name FROM sqlite_master
    WHERE type = 'table' AND (name = 'worktree_dir_rule' OR name = 'worktree_file_rule')
`,
    probeTableCreateSql: `SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = #{tableName}
`,
    countChatProjectAgentConfigResidue: `SELECT COUNT(*) AS cnt FROM chat_project
    WHERE agent_config_json IS NOT NULL
`,
    alignVfsEntryHeadVersion: `UPDATE vfs_entry SET head_version = version
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const BootstrapProbeSqlParams = {
    probeTable: ["tableName"],
    probeWorktreeRuleTable: [],
    probeTableCreateSql: ["tableName"],
    countChatProjectAgentConfigResidue: [],
    alignVfsEntryHeadVersion: [],
} as const;
