/**
 * Skills 负清单表 DDL。
 *
 * @module bootstrap/skills/skills-schema
 */

/** Canonical table: 技能禁用负清单（默认启用，关闭才落行）。 */
export const SKILL_DISABLED_RULE_TABLE = "skill_disabled_rule";
/** Canonical index: 按域查禁用行。 */
export const SKILL_DISABLED_SCOPE_INDEX = "idx_skill_disabled_scope";

/**
 * skill_disabled_rule 幂等 DDL（照 workplace_dir_rule 模式）。
 *
 * scope_key 取值约定为 `project:{pid}`——会话面板开关只写当前项目的禁用
 * 记录，关闭仅对该项目生效；全局域禁用行（如 `global`）本期无 UI 写入
 * 路径，表结构预留。
 */
export const SKILLS_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${SKILL_DISABLED_RULE_TABLE} (
    -- 域键：当前约定为 project:{pid}，全局域预留
    scope_key TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    PRIMARY KEY (scope_key, skill_name)
  )`,
  `CREATE INDEX IF NOT EXISTS ${SKILL_DISABLED_SCOPE_INDEX} ON ${SKILL_DISABLED_RULE_TABLE}(scope_key)`,
];
