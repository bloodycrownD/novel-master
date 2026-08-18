/**
 * Desktop renderer 对 `@novel-master/core/skills` 的具名薄再导出。
 * 禁止 `export *`；只放纯函数/类型，工厂与服务须走 IPC。
 */

export { previewSkillZip, SKILL_NAME_PATTERN } from "@novel-master/core/skills";
export type { SkillZipPreview } from "@novel-master/core/skills";
