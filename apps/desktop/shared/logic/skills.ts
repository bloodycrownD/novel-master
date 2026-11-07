/**
 * Desktop renderer 对 `@novel-master/core/skills` 的具名薄再导出。
 * 禁止 `export *`；只放纯函数/类型，工厂与服务须走 IPC。
 *
 * core 侧 `validateSkillName` 已返回错误 descriptor（G2b）：本层经 `coreT`
 * 翻译成 string 再导出，renderer 消费点零改动。
 */

import { validateSkillName as coreValidateSkillName } from "@novel-master/core/skills";
import { coreT } from "./core-i18n.js";

export { previewSkillZip, SKILL_NAME_PATTERN } from "@novel-master/core/skills";
export type { SkillZipPreview } from "@novel-master/core/skills";
export { withSkillFrontMatterValues } from "@novel-master/core/skills";
export type { SkillFrontMatterValues } from "@novel-master/core/skills";
export { BUILTIN_SKILL_NAMES } from "@novel-master/core/skills";
export { buildNewSkillDoc } from "@novel-master/core/skills";

export function validateSkillName(name: string): string | null {
  const reason = coreValidateSkillName(name);
  return reason == null ? null : coreT(reason);
}
