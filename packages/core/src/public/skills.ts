/**
 * Skills 能力的公开入口。
 *
 * 下游通过 `@novel-master/core/skills` 子路径消费本 barrel，
 * 收拢 SkillService 工厂、端口与 domain 层类型/常量导出。
 *
 * @module public/skills
 */

export { SkillsServiceFactory } from "../service/skills/create-skills-service.js";
export type {
    SkillService,
    SkillListScope,
    SkillListItem,
    SkillFileContent,
    SkillEditMatch,
    SkillLocation,
} from "../service/skills/skills.port.js";
export { EffectiveSkills } from "../domain/skills/logic/effective-skills.js";
export type {
    EffectiveSkill,
    EffectiveSkillsInput,
} from "../domain/skills/logic/effective-skills.js";
export { SkillFrontMatter } from "../domain/skills/logic/parse-skill-front-matter.js";
export { SkillFrontMatterValues } from "../domain/skills/logic/with-skill-front-matter-values.js";
export { NewSkillDoc } from "../domain/skills/logic/build-new-skill-doc.js";
export { SkillZip } from "../domain/skills/logic/preview-skill-zip.js";
export type { SkillZipPreview } from "../domain/skills/logic/preview-skill-zip.js";
export type {
    SkillDomain,
    SkillSummary,
} from "../domain/skills/model/skill.schema.js";
export { skillFrontMatterSchema } from "../domain/skills/model/skill.schema.js";
// 归属例外（check-public-ownership）：skills 域概念，bootstrap 只是定义处。
export { BUILTIN_SKILL_NAMES } from "../bootstrap/skills/seed-builtin-skills.js";
export {
    SKILL_NAME_PATTERN,
    SkillName,
} from "../domain/skills/model/skill-name.js";
