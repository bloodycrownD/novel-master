/**
 * 技能禁用负清单（skill_disabled_rule）repository 端口。
 *
 * @module domain/skills/repositories/skill-disabled-rule.port
 */

/** 负清单行读写：默认启用，关闭才落行。 */
export interface SkillDisabledRuleRepository {
  /** 列出某域（scope_key）下已禁用的技能名。 */
  listDisabledNames(scopeKey: string): Promise<string[]>;

  /** 落一行禁用记录（幂等，已存在时无操作）。 */
  upsert(scopeKey: string, skillName: string): Promise<void>;

  /** 删一行禁用记录（重新启用）。 */
  remove(scopeKey: string, skillName: string): Promise<void>;

  /** 清空某域全部禁用行（项目删除时清理）。 */
  removeScope(scopeKey: string): Promise<void>;

  /** 按技能名清理所有域的禁用行（删除 global 技能时避免遗留孤儿行）。 */
  removeAllScopesByName(skillName: string): Promise<void>;

  /** 把某域的全部禁用行复制到另一域（项目复制 D1 携带）。 */
  copyScopeRules(fromScopeKey: string, toScopeKey: string): Promise<void>;
}
