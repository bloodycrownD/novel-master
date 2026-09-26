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
  | "NOT_FOUND"
  | "BUILTIN_SKILL"
  | "BUILTIN_SKILL_NAME_RESERVED"
  | "BUILTIN_SKILL_RENAME"
  | "SKILL_ALREADY_EXISTS";

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
    options?: { skillName?: string; path?: string }
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
  code?: SkillErrorCode
): error is SkillError {
  return matchesSkillError(error, code);
}

function matchesSkillError(
  error: unknown,
  code?: SkillErrorCode
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
export function skillInvalidName(name: string, reason: string): SkillError {
  return new SkillError(
    "INVALID_NAME",
    `Invalid skill name ${name}: ${reason}`,
    {
      skillName: name,
    }
  );
}

/** 写操作（write/edit）缺显式域。 */
export function skillMissingDomain(name: string): SkillError {
  return new SkillError(
    "MISSING_DOMAIN",
    `写入技能 ${name} 须显式指定 domain（global / project）`,
    { skillName: name }
  );
}

/** project 域操作缺 projectId。 */
export function skillMissingProjectId(name: string): SkillError {
  return new SkillError(
    "MISSING_PROJECT_ID",
    `project 域操作须提供 projectId（技能 ${name}）`,
    { skillName: name }
  );
}

/** 技能内相对路径非法（含 .. / 逃逸技能目录 / 空路径）。 */
export function skillInvalidPath(path: string, reason: string): SkillError {
  return new SkillError(
    "INVALID_PATH",
    `Invalid skill file path ${path}: ${reason}`,
    {
      path,
    }
  );
}

/** 技能或技能文件不存在。 */
export function skillNotFound(name: string, path?: string): SkillError {
  return new SkillError(
    "NOT_FOUND",
    path == null
      ? `Skill not found: ${name}`
      : `Skill file not found: ${name}/${path}`,
    { skillName: name, path }
  );
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
export function skillNotFoundInDomain(
  name: string,
  path: string,
  domain: "global" | "project",
  other?: {
    readonly domain: "global" | "project";
    readonly exists: boolean | null;
  }
): SkillError {
  let hint: string;
  if (other == null) {
    hint = `如需在该域新建，请显式传 domain:"${domain}"。`;
  } else if (other.exists === true) {
    hint = `该技能存在于 ${other.domain} 域；如需修改它，请显式传 domain:"${other.domain}"。`;
  } else if (other.exists === false) {
    hint = `${other.domain} 域也没有该技能；如需在 ${domain} 域新建，请显式传 domain:"${domain}"。`;
  } else {
    hint = `未能确认 ${other.domain} 域是否存在该技能（缺 projectId 无法探测该域）。`;
  }
  return new SkillError(
    "NOT_FOUND",
    `技能 ${name} 在 ${domain} 域不存在（文件 ${path}）；${hint}`,
    { skillName: name, path }
  );
}

/** 删除内置技能（global 域内置名）。 */
export function skillBuiltin(name: string): SkillError {
  return new SkillError("BUILTIN_SKILL", `内置技能不支持删除：${name}`, {
    skillName: name,
  });
}

/** 用内置保留名新建技能（两域均拒；目录已存在的本体/副本编辑放行）。 */
export function skillBuiltinNameReserved(name: string): SkillError {
  return new SkillError(
    "BUILTIN_SKILL_NAME_RESERVED",
    `「${name}」为内置技能保留名，不能用于新建；内置技能本身可在管理页编辑`,
    { skillName: name }
  );
}

/** 重命名 global 域内置技能（仅改名拒；仅改描述放行）。 */
export function skillBuiltinRename(name: string): SkillError {
  return new SkillError("BUILTIN_SKILL_RENAME", `内置技能不支持重命名：${name}`, {
    skillName: name,
  });
}

/** 域内查重撞名：目标技能目录已存在（updateSkillInfo 重命名）。 */
export function skillAlreadyExists(name: string): SkillError {
  return new SkillError(
    "SKILL_ALREADY_EXISTS",
    `已存在同名技能：${name}`,
    { skillName: name }
  );
}
