/**
 * 技能管理共享 UI 基础：域徽标文案、SKILL.md 新建模板、技能定位。
 *
 * 会话技能面板（SessionDetailDrawer 内）与设置·技能管理页共用。
 */
import type { SkillDomainDto, SkillRefDto } from "@shared/ipc-types";
import { coreT } from "@shared/logic/core-i18n";

/** 域徽标文案：项目副本覆盖同名全局技能时标「项目 · 覆盖全局」。 */
export function skillDomainLabel( domain: SkillDomainDto, overridden: boolean ): string {
  if (domain === "project") {
    return overridden ? coreT({key: "ui.skills.domain_tag_overridden"}) : coreT({key: "ui.skills.domain_project"});
  }
  return coreT({key: "ui.skills.domain_tag_global"});
}

/** 新建技能的 SKILL.md 模板：front matter（name/description）+ 辅助文件引导。 */
// 新建模板与 front matter 重写都已回收为 core 单源（见 NewSkillDoc.build 的模块注释：
// 裸插值会让 description 里的半角 `": "` 把 YAML 解析成嵌套 map ⇒ 技能一建出来就是「无效技能」）。
export { NewSkillDoc } from "@shared/logic/skills";

// front matter 重写（SkillFrontMatterValues.rewrite）已回收为 core 单源，
// 经 @shared/logic/skills 再导出，本文件不再持有私有实现。

/** 技能定位（跳详情用）：project 域带 projectId，global 域缺省。 */
export function toSkillRef( domain: SkillDomainDto, name: string, projectId?: string ): SkillRefDto {
  return {
    domain,
    ...(domain === "project" && projectId != null ? { projectId } : {}),
    name,
  };
}

/**
 * 「打开设置 → 技能相关视图」的跨组件事件（会话面板/工具卡片 → 设置栈）。
 *
 * App 监听后打开设置页；SettingsOverlay 监听后导航到目标视图。
 */
export const OPEN_SETTINGS_VIEW_EVENT = "open-settings-view";

export type OpenSettingsViewDetail =
  | { readonly view: "skillsManage" }
  | { readonly view: "skillDetail"; readonly skillRef: SkillRefDto };

export function dispatchOpenSettingsView(detail: OpenSettingsViewDetail): void {
  window.dispatchEvent( new CustomEvent<OpenSettingsViewDetail>(OPEN_SETTINGS_VIEW_EVENT, { detail }) );
}
