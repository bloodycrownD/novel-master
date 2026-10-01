/**
 * 技能 UI 共享小件：域徽标文案 / 新建 SKILL.md 模板。
 *
 * 面板、管理页、详情页三处共用，文案与口径收敛在这里，避免漂移。
 */

import {buildNewSkillDoc as buildNewSkillDocCore} from '@novel-master/core/skills';
import type {SkillDomain} from '@novel-master/core/skills';

// front matter 重写（重命名/描述编辑与 ZIP 导入回写共用）已回收为
// core 单源，经此处再导出供 mobile 各组件消费。
// ⚠️ 这条 export 必须保持独立成句：__tests__/skill-info-edit-modal-contract.test.ts
//    用正则锁死了它的精确形态，合并成 `export {a, b} from ...` 会把那条测试打红。
export {withSkillFrontMatterValues} from '@novel-master/core/skills';

// 新建 SKILL.md 模板同样已回收为 core 单源（front matter 转义与 desktop 共用一份实现）；
// mobile 端保留自己的正文引导文案，所以本文件不直接再导出、而是在下方包一层薄壳，
// 见文件末尾的 buildNewSkillDoc。

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
 * 新建技能的 SKILL.md 模板（front matter name/description + 辅助文件引导说明）。
 *
 * 实现已下沉 core：front matter 的转义（description 含半角冒号 / 引号 / 换行时
 * 不破坏解析）与 desktop 共用一份，本文件只保留 mobile 自己的正文引导文案，
 * 对应 core 的 `mobile` 变体。模块私有的 yamlScalar 已随之删除。
 */
export function buildNewSkillDoc(name: string, description: string): string {
  return buildNewSkillDocCore(name, description, 'mobile');
}
