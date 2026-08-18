/**
 * 技能管理共享 UI 基础：域徽标文案、SKILL.md 新建模板、技能名校验。
 *
 * 会话技能面板（SessionDetailDrawer 内）与设置·技能管理页共用。
 */
import { SKILL_NAME_PATTERN } from "@shared/logic/skills";
import type { SkillDomainDto, SkillRefDto } from "@shared/ipc-types";

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

/** YAML 双引号标量：含冒号/换行不出错（front matter 重写用）。 */
export function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/**
 * 以表单最终值为准重写 SKILL.md front matter（保留其余键与正文）。
 * 无 front matter 块时前置补一个；技能 ZIP 导入创建时表单值与 zip
 * 元数据不一致则用它回写，一致则保留 zip 原文。
 */
export function withFrontMatterValues(
  source: string,
  name: string,
  description: string,
): string {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const fmLine = (key: string, value: string) => `${key}: ${yamlScalar(value)}`;
  if (match == null) {
    return `---\n${fmLine("name", name)}\n${fmLine("description", description)}\n---\n\n${source}`;
  }
  let fm = match[1]!;
  const values: ReadonlyArray<[string, string]> = [
    ["name", name],
    ["description", description],
  ];
  for (const [key, value] of values) {
    const re = new RegExp(`^${key}:.*$`, "m");
    fm = re.test(fm)
      ? fm.replace(re, fmLine(key, value))
      : `${fm}\n${fmLine(key, value)}`;
  }
  return source.replace(match[0], `---\n${fm}\n---\n`);
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
