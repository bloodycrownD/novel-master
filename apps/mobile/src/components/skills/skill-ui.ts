/**
 * 技能 UI 共享小件：域徽标文案。
 *
 * 面板、管理页、详情页三处共用，文案与口径收敛在这里，避免漂移。
 */

import type {SkillDomain} from '@novel-master/core/skills';
import {coreT} from '../i18n/core';

// front matter 重写（重命名/描述编辑与 ZIP 导入回写共用）已回收为
// core 单源，经此处再导出供 mobile 各组件消费。
// ⚠️ 这条 export 必须保持独立成句：__tests__/skill-info-edit-modal-contract.test.ts
//    用正则锁死了它的精确形态，合并成 `export {a, b} from ...` 会把那条测试打红。
export {SkillFrontMatterValues} from '@novel-master/core/skills';

export namespace SkillUi {
  /** 域徽标三态：全局 / 项目 / 项目 · 覆盖全局。 */
  export function domainBadgeLabel(domain: SkillDomain, overridden: boolean): string {
    if (domain === 'global') {
      return coreT({key: "ui.skills.domain_tag_global"});
    }
    return overridden ? coreT({key: "ui.skills.domain_tag_overridden"}) : '项目';
  }

  /** 域徽标前景色（区分两域；覆盖态沿用项目色 + 文案区分）。 */
  export function domainBadgeColor(domain: SkillDomain, tokens: {primary: string; textSecondary: string}): string {
    return domain === 'global' ? tokens.textSecondary : tokens.primary;
  }
}
