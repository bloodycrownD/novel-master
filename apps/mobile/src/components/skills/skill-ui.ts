/**
 * 技能 UI 共享小件：域徽标文案 / YAML 标量 / 新建 SKILL.md 模板。
 *
 * 面板、管理页、详情页三处共用，文案与口径收敛在这里，避免漂移。
 */

import type {SkillDomain} from '@novel-master/core/skills';

/** 域徽标三态：全局 / 项目 / 项目 · 覆盖全局。 */
export function skillDomainBadgeLabel(
  domain: SkillDomain,
  overridden: boolean,
): string {
  if (domain === 'global') {
    return '全局';
  }
  return overridden ? '项目 · 覆盖全局' : '项目';
}

/** 域徽标前景色（区分两域；覆盖态沿用项目色 + 文案区分）。 */
export function skillDomainBadgeColor(
  domain: SkillDomain,
  tokens: {primary: string; textSecondary: string},
): string {
  return domain === 'global' ? tokens.textSecondary : tokens.primary;
}

/** 详情页 / 编辑器顶栏的域说明文案（项目域附项目名）。 */
export function skillDomainHintLabel(
  domain: SkillDomain,
  projectName?: string,
): string {
  if (domain === 'global') {
    return '全局域 · 所有项目生效';
  }
  return `项目域 · ${projectName ?? '当前项目'}`;
}

/**
 * YAML 双引号标量：JSON 字符串本身即合法 YAML double-quoted scalar，
 * description 含冒号 / 引号 / 换行时不会破坏 front matter 解析。
 */
export function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** 新建技能的 SKILL.md 模板（front matter name/description + 辅助文件引导说明）。 */
export function buildNewSkillDoc(name: string, description: string): string {
  return [
    '---',
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(description)}`,
    '---',
    '',
    `# ${name}`,
    '',
    description,
    '',
    '## 使用说明',
    '',
    '- 这里描述技能的用途、触发时机与使用方式，模型会据此决定是否使用本技能。',
    '- 辅助文件可放在本目录或子目录（如 `references/notes.md`），',
    '  由模型经技能工具按需读取；正文无需内联全文。',
    '',
  ].join('\n');
}
