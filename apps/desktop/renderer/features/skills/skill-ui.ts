/**
 * 技能管理共享 UI 基础：域徽标文案、SKILL.md 新建模板、技能名校验。
 *
 * 会话技能面板（SessionDetailDrawer 内）与设置·技能管理页共用。
 */
import { SKILL_NAME_PATTERN } from "@novel-master/core/skills";
import type {
  EffectiveSkillDto,
  SkillDomainDto,
  SkillRefDto,
} from "@shared/ipc-types";

/** 域徽标文案：项目副本覆盖同名全局技能时标「项目 · 覆盖全局」。 */
export function skillDomainLabel(
  domain: SkillDomainDto,
  overridden: boolean,
): string {
  if (domain === "project") {
    return overridden ? "项目 · 覆盖全局" : "项目";
  }
  return "全局";
}

/** 新建技能的 SKILL.md 模板：front matter（name/description）+ 辅助文件引导。 */
export function buildNewSkillDoc(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${name}`,
    "",
    description,
    "",
    "<!-- 在这里编写技能说明。可添加辅助文件（如 references/x.md），模型会经 skill 工具按需读取。 -->",
    "",
  ].join("\n");
}

/** 技能名展示校验（与 core SKILL_NAME_PATTERN 同口径：禁空白与 `/`、不以 `.` 开头、非保留名）。 */
export function isValidSkillNameInput(name: string): boolean {
  return name.length > 0 && SKILL_NAME_PATTERN.test(name);
}

/** 技能定位（跳详情用）：project 域带 projectId，global 域缺省。 */
export function toSkillRef(
  domain: SkillDomainDto,
  name: string,
  projectId?: string,
): SkillRefDto {
  return {
    domain,
    ...(domain === "project" && projectId != null ? { projectId } : {}),
    name,
  };
}

/** 会话面板汇总文案：「技能 n/m 启用」（n 剔除无效技能）。 */
export function skillEnableSummary(rows: readonly EffectiveSkillDto[]): string {
  const validCount = rows.filter((r) => r.valid).length;
  const enabledCount = rows.filter((r) => r.effective).length;
  return `技能 ${enabledCount}/${validCount} 启用`;
}

/** 批量选择/列表 key：`global/{name}` 或 `project/{projectId}/{name}`。 */
export function skillKey(ref: SkillRefDto): string {
  return ref.domain === "global"
    ? `global/${ref.name}`
    : `project/${ref.projectId ?? ""}/${ref.name}`;
}

/** 与 skillKey 互逆；无法解析时返回 undefined。 */
export function parseSkillKey(key: string): SkillRefDto | undefined {
  const parts = key.split("/");
  if (parts[0] === "global" && parts.length === 2 && parts[1]) {
    return { domain: "global", name: parts[1]! };
  }
  if (
    parts[0] === "project" &&
    parts.length === 3 &&
    parts[1] &&
    parts[2]
  ) {
    return { domain: "project", projectId: parts[1], name: parts[2]! };
  }
  return undefined;
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
  window.dispatchEvent(
    new CustomEvent<OpenSettingsViewDetail>(OPEN_SETTINGS_VIEW_EVENT, {
      detail,
    }),
  );
}
