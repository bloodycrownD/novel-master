/**
 * Desktop renderer 对 `@novel-master/core/skills` 的具名薄再导出。
 * 禁止 `export *`；只放纯函数/类型，工厂与服务须走 IPC。
 *
 * core 侧 `SkillName.validate` 已返回错误 descriptor（G2b）：本层经 `coreT`
 * 翻译成 string 再导出，renderer 消费点零改动。
 */

import { SkillName } from "@novel-master/core/skills";
import { coreT } from "./core-i18n.js";

export { SkillZip, SKILL_NAME_PATTERN } from "@novel-master/core/skills";
export type { SkillZipPreview } from "@novel-master/core/skills";
export { SkillFrontMatterValues } from "@novel-master/core/skills";
export { BUILTIN_SKILL_NAMES } from "@novel-master/core/skills";
export { NewSkillDoc } from "@novel-master/core/skills";

// nm-style: keep-public — shared/logic 是 core-descriptor→string 的翻译边界，且 skill-zip-import.test 以源码正则锁死 SkillInfoEditModal `import { …, validateSkillName } from "@shared/logic/skills"` 的消费契约；内联会破坏测试锁名。
export function validateSkillName(name: string): string | null {
    const reason = SkillName.validate(name);
    return reason == null ? null : coreT(reason);
}
