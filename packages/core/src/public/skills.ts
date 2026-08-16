/**
 * Skills 能力的公开入口。
 *
 * 下游通过 `@novel-master/core/skills` 子路径消费本 barrel，
 * 收拢 SkillService 工厂、端口与 domain 层类型/常量导出。
 *
 * @module public/skills
 */

export { createSkillsService } from "../service/skills/create-skills-service.js";
export type {
  SkillService,
  SkillListScope,
  SkillListItem,
  SkillFileContent,
  SkillEditMatch,
  SkillLocation,
} from "../service/skills/skills.port.js";
export { computeEffectiveSkills } from "../domain/skills/logic/effective-skills.js";
export type {
  EffectiveSkill,
  EffectiveSkillsInput,
} from "../domain/skills/logic/effective-skills.js";
export { parseSkillFrontMatter } from "../domain/skills/logic/parse-skill-front-matter.js";
export type { ParsedSkillFrontMatter } from "../domain/skills/logic/parse-skill-front-matter.js";
export type {
  SkillDomain,
  SkillFrontMatter,
  SkillRef,
  SkillSummary,
} from "../domain/skills/model/skill.schema.js";
export { skillFrontMatterSchema } from "../domain/skills/model/skill.schema.js";
export {
  SKILL_NAME_PATTERN,
  SKILL_NAME_PATTERN_SOURCE,
  SKILL_RESERVED_NAME,
  validateSkillName,
  isValidSkillName,
} from "../domain/skills/model/skill-name.js";
export { SkillError, isSkillError } from "../errors/skill-errors.js";
export type { SkillErrorCode } from "../errors/skill-errors.js";
