/**
 * 技能文件路径合成（domain 级单源）。
 *
 * `/meta/skills` 根前缀、入口文件缺省值与相对路径受控解析原先只在
 * service 层（skills.service.ts），tool 层的同路径串行化分类器需要同一
 * 套口径——抽到这里供两层共用，防止出现第二份路径逻辑。
 *
 * @module domain/skills/logic/skill-paths
 */

import { resolveLogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 两域技能的逻辑根前缀。 */
export const SKILLS_ROOT = "/meta/skills";

/** 技能入口文件（path 缺省值）。 */
export const SKILL_ENTRY_FILE = "SKILL.md";

/** 相对路径解析失败原因（service 层据此映射报错文案）。 */
export type SkillRelPathInvalidReason = "empty" | "dotdot" | "escape";

/** {@link resolveSkillRelPathCore} 结果：ok 时带相对技能目录的归一化路径。 */
export type SkillRelPathResolution =
  | { readonly ok: true; readonly rel: string }
  | { readonly ok: false; readonly reason: SkillRelPathInvalidReason };

/**
 * 把技能内相对路径解析为受控形态：缺省 SKILL.md，禁 `..` 段，
 * 归一化后必须仍在 `/meta/skills/{name}/` 内。
 *
 * 纯函数不抛错——service 层包装成 SkillError，tool 层分类器拿失败
 * 结果保守放弃串行化（该调用会被 schema/服务层拒绝）。
 */
export function resolveSkillRelPathCore(
  name: string,
  path: string | undefined,
): SkillRelPathResolution {
  const raw = path ?? SKILL_ENTRY_FILE;
  if (raw.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  // normalizePath 会把 `..` 消化成目录回溯而不是拒绝，这里必须先显式拦截，
  // 否则 `notes/../../other/SKILL.md` 会被静默解析进隔壁技能目录。
  if (raw.split("/").includes("..")) {
    return { ok: false, reason: "dotdot" };
  }
  const dirPrefix = `${SKILLS_ROOT}/${name}/`;
  const logical = resolveLogicalPath(`${dirPrefix}${raw}`);
  if (!logical.startsWith(dirPrefix)) {
    return { ok: false, reason: "escape" };
  }
  return { ok: true, rel: logical.slice(dirPrefix.length) };
}
