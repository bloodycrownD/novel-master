/**
 * Skills 域错误工厂：统一返回 `AppError`。
 *
 * @module errors/skill-errors
 */

import { AppError } from "./app-error.js";
import type { CoreMessageDescriptor } from "@/i18n/keys.js";

/** 技能名未过 SKILL_NAME_PATTERN 校验（reason 可为 descriptor，如 invalid_name.* 子段）。 */
export function skillInvalidName(name: string, reason: string | CoreMessageDescriptor): AppError<"SKILL_INVALID_NAME"> {
  return new AppError("SKILL_INVALID_NAME", typeof reason === "string" ? `Invalid skill name ${name}: ${reason}` : reason, { skillName: name });
}

/** 写操作（write/edit）缺显式域。 */
export function skillMissingDomain(name: string): AppError<"SKILL_MISSING_DOMAIN"> {
  return new AppError("SKILL_MISSING_DOMAIN", {key: "error.skill.missing_domain", params: {name}}, { skillName: name });
}

/** project 域操作缺 projectId。 */
export function skillMissingProjectId(name: string): AppError<"SKILL_MISSING_PROJECT_ID"> {
  return new AppError("SKILL_MISSING_PROJECT_ID", {key: "error.skill.missing_project_id", params: {name}}, { skillName: name });
}

/** 技能内相对路径非法（含 .. / 逃逸技能目录 / 空路径；reason 可为 descriptor）。 */
export function skillInvalidPath(path: string, reason: string | CoreMessageDescriptor): AppError<"SKILL_INVALID_PATH"> {
  return new AppError("SKILL_INVALID_PATH", typeof reason === "string" ? `Invalid skill file path ${path}: ${reason}` : reason, { path });
}

/** 技能或技能文件不存在。 */
export function skillNotFound(name: string, path?: string): AppError<"SKILL_NOT_FOUND"> {
  return new AppError("SKILL_NOT_FOUND", path == null ? `Skill not found: ${name}` : `Skill file not found: ${name}/${path}`, {
    skillName: name,
    ...(path != null ? { path } : {}),
  });
}

/**
 * 写操作（write/edit）在指定域内找不到技能或技能文件。
 *
 * WHY 单独一类：edit/write 的 domain 由调用方显式决定，失败多半是「域选错了」
 * 而不是「技能真不存在」。文案必须带上命中的域与另一域的存在性，否则调用方
 * 只会看到裸 VFS 的 `Path not found: /meta/skills/...`，既认不出是域的问题，
 * 也无从知道该补什么参数。
 *
 * @param other 另一域的探测结果。`exists: null` 表示**无法确认**（如未提供
 * projectId 而另一域是 project），此时不得断言该域没有该技能。
 */
export function skillNotFoundInDomain(name: string, path: string, domain: "global" | "project", other?: { readonly domain: "global" | "project"; readonly exists: boolean | null }): AppError<"SKILL_NOT_FOUND"> {
  // hint 家族作 {hint} 嵌套 descriptor（spec G1.4；YAML 层级下与主 key 分立）
  let hint: CoreMessageDescriptor;
  if (other == null) {
    hint = {key: "error.skill.not_found_in_domain_hint.create", params: {domain}};
  } else if (other.exists === true) {
    hint = {key: "error.skill.not_found_in_domain_hint.other_domain", params: {other_domain: other.domain}};
  } else if (other.exists === false) {
    hint = {key: "error.skill.not_found_in_domain_hint.neither_domain", params: {domain, other_domain: other.domain}};
  } else {
    hint = {key: "error.skill.not_found_in_domain_hint.probe_failed", params: {other_domain: other.domain}};
  }
  return new AppError("SKILL_NOT_FOUND", {key: "error.skill.not_found_in_domain", params: {name, domain, path, hint}}, {
    skillName: name,
    path,
    domain,
  });
}

/** 删除内置技能（global 域内置名）。 */
export function skillBuiltin(name: string): AppError<"SKILL_BUILTIN"> {
  return new AppError("SKILL_BUILTIN", {key: "error.skill.builtin_not_deletable", params: {name}}, { skillName: name });
}

/** 用内置保留名新建技能（两域均拒；目录已存在的本体/副本编辑放行）。 */
export function skillBuiltinNameReserved(name: string): AppError<"SKILL_BUILTIN_NAME_RESERVED"> {
  return new AppError("SKILL_BUILTIN_NAME_RESERVED", {key: "error.skill.builtin_name_reserved", params: {name}}, { skillName: name });
}

/** 重命名 global 域内置技能（仅改名拒；仅改描述放行）。 */
export function skillBuiltinRename(name: string): AppError<"SKILL_BUILTIN_RENAME"> {
  return new AppError("SKILL_BUILTIN_RENAME", {key: "error.skill.builtin_rename_forbidden", params: {name}}, { skillName: name });
}

/** 域内查重撞名：目标技能目录已存在（updateSkillInfo 重命名）。 */
export function skillAlreadyExists(name: string): AppError<"SKILL_ALREADY_EXISTS"> {
  return new AppError("SKILL_ALREADY_EXISTS", {key: "error.skill.already_exists", params: {name}}, { skillName: name });
}
