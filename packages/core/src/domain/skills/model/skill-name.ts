/**
 * 技能名字符集口径（新建校验 / `$` token 正则 / `$` 扫描正则三处共用）。
 *
 * 规则（排除式定义）：
 * - 不得包含空白字符与 `/`；
 * - 不得以 `.` 开头；
 * - 不得为保留名 `SKILL.md`（大小写不敏感）。
 *
 * @module domain/skills/model/skill-name
 */

/**
 * 技能名 token 源（无锚定）：首字符不得为 `.`，全体不得含空白与 `/`。
 *
 * 供 `$` 引用的 token / 扫描正则组合使用，避免三处口径漂移。
 */
export const SKILL_NAME_PATTERN_SOURCE = "[^\\s/.][^\\s/]*";

/** 锚定的完整技能名校验正则。 */
export const SKILL_NAME_PATTERN = new RegExp(
  `^(?:${SKILL_NAME_PATTERN_SOURCE})$`
);

/** 保留名（大小写不敏感）：技能目录入口文件名，不能当技能名。 */
export const SKILL_RESERVED_NAME = "skill.md";

/**
 * 校验技能名，合法返回 `null`，非法返回中文原因（供 UI 提示）。
 */
export function validateSkillName(name: string): string | null {
  if (name.length === 0) {
    return "技能名不能为空";
  }
  if (name.toLowerCase() === SKILL_RESERVED_NAME) {
    return "SKILL.md 是保留名，不能用作技能名";
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    if (name.startsWith(".")) {
      return "技能名不能以 . 开头";
    }
    if (/\s/.test(name)) {
      return "技能名不能包含空白字符";
    }
    if (name.includes("/")) {
      return "技能名不能包含 /";
    }
    return "技能名包含不支持的字符";
  }
  return null;
}

/** 校验技能名是否合法。 */
export function isValidSkillName(name: string): boolean {
  return validateSkillName(name) === null;
}
