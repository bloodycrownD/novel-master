/**
 * Skills 域错误：技能名 / 域参数 / 路径校验与未找到的统一错误类型。
 *
 * @module errors/skill-errors
 */

/** Discriminant codes for {@link SkillError}. */
export type SkillErrorCode =
  | "INVALID_NAME"
  | "MISSING_DOMAIN"
  | "MISSING_PROJECT_ID"
  | "INVALID_PATH"
  | "NOT_FOUND";

/**
 * Unified error for skill service operations.
 */
export class SkillError extends Error {
  readonly code: SkillErrorCode;
  readonly skillName?: string;
  readonly path?: string;

  constructor(
    code: SkillErrorCode,
    message: string,
    options?: { skillName?: string; path?: string },
  ) {
    super(message);
    this.name = "SkillError";
    this.code = code;
    this.skillName = options?.skillName;
    this.path = options?.path;
  }
}

/** Type guard that works across duplicate module instances (e.g. src vs dist in tests). */
export function isSkillError(
  error: unknown,
  code?: SkillErrorCode,
): error is SkillError {
  return matchesSkillError(error, code);
}

function matchesSkillError(
  error: unknown,
  code?: SkillErrorCode,
): error is SkillError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "SkillError" || typeof candidate.code !== "string") {
    return false;
  }
  return code === undefined || candidate.code === code;
}

/** 技能名未过 SKILL_NAME_PATTERN 校验。 */
export function skillInvalidName(
  name: string,
  reason: string,
): SkillError {
  return new SkillError("INVALID_NAME", `Invalid skill name ${name}: ${reason}`, {
    skillName: name,
  });
}

/** 写操作（write/edit）缺显式域。 */
export function skillMissingDomain(name: string): SkillError {
  return new SkillError(
    "MISSING_DOMAIN",
    `写入技能 ${name} 须显式指定 domain（global / project）`,
    { skillName: name },
  );
}

/** project 域操作缺 projectId。 */
export function skillMissingProjectId(name: string): SkillError {
  return new SkillError(
    "MISSING_PROJECT_ID",
    `project 域操作须提供 projectId（技能 ${name}）`,
    { skillName: name },
  );
}

/** 技能内相对路径非法（含 .. / 逃逸技能目录 / 空路径）。 */
export function skillInvalidPath(path: string, reason: string): SkillError {
  return new SkillError("INVALID_PATH", `Invalid skill file path ${path}: ${reason}`, {
    path,
  });
}

/** 技能或技能文件不存在。 */
export function skillNotFound(
  name: string,
  path?: string,
): SkillError {
  return new SkillError(
    "NOT_FOUND",
    path == null
      ? `Skill not found: ${name}`
      : `Skill file not found: ${name}/${path}`,
    { skillName: name, path },
  );
}
