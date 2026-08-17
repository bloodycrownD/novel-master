/**
 * 技能 front matter zod schema 与领域类型。
 *
 * `meta/skills/{name}/SKILL.md` 的 front matter 需含 `name` 与 `description`
 * （照 agent-definition.schema.ts 的 strict object 模式，拒绝未知键）。
 * 解析失败不抛领域错误，而是由 parse-skill-front-matter 产出有效性标记
 * 与无效原因——无效技能在管理界面正常展示并可修复。
 *
 * @module domain/skills/model/skill.schema
 */

import { z } from "zod";

/** 技能归属域。 */
export type SkillDomain = "global" | "project";

/** SKILL.md front matter 的严格 schema（name / description 必填）。 */
export const skillFrontMatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

/** 解析成功的 front matter 字段。 */
export type SkillFrontMatter = z.infer<typeof skillFrontMatterSchema>;

/** 技能定位引用（跳详情 / 卡片透传用）。 */
export interface SkillRef {
  readonly domain: SkillDomain;
  /** project 域必带；global 域缺省。 */
  readonly projectId?: string;
  readonly name: string;
}

/**
 * 技能清单条目（listSkills / effectiveSkills 的输入形态）。
 *
 * `valid=false` 表示 front matter 缺失 / 不可解析 / 字段不合法，
 * `invalidReason` 给出可展示的原因。
 */
export interface SkillSummary {
  readonly name: string;
  readonly description: string | null;
  readonly domain: SkillDomain;
  readonly valid: boolean;
  readonly invalidReason?: string;
}
