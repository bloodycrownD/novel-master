/**
 * 技能 ZIP 预检：从导入 zip 字节中提取 SKILL.md 元数据（新建弹窗预填用）。
 *
 * 约定 zip 根即技能目录（本产品导出格式）：`SKILL.md` 在 zip 根。
 * 仅做只读预览——不落盘、不校验技能名合法性（由调用方 UI 校验）。
 *
 * @module domain/skills/logic/preview-skill-zip
 */

import { strFromU8 } from "fflate";

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { parseVfsZip } from "@/domain/vfs/logic/vfs-zip-parse.js";
import { parseSkillFrontMatter } from "./parse-skill-front-matter.js";

/** 本模块的失败载荷：zip 不可读 / 非法 UTF-8 条目名 / 超出解压限制。 */
type SkillZipPreviewError = AppError<"VFS_ZIP_INVALID_ARCHIVE" | "VFS_ZIP_INVALID_UTF8" | "VFS_ZIP_PAYLOAD_TOO_LARGE">;

/** 技能 zip 预检结果；`skillMd == null` 表示 zip 根缺少 SKILL.md。 */
export interface SkillZipPreview {
  /** front matter 的 name（可空：缺失或 zip 无 SKILL.md）。 */
  readonly name: string | null;
  /** front matter 的 description（可空）。 */
  readonly description: string | null;
  /** SKILL.md 全文（zip 根缺 SKILL.md 时为 null）。 */
  readonly skillMd: string | null;
  /** zip 内文件数（不含目录标记条目）。 */
  readonly fileCount: number;
  /** front matter 是否合法（供 UI 提示「将补全元数据」）。 */
  readonly valid: boolean;
}

/**
 * 解析技能 zip 字节，产出新建弹窗预填所需的元数据。
 *
 * @returns 归档不可读 / 超出解压限制时为 `Err`（key `VFS_ZIP_*`），本函数不抛。
 */
export function previewSkillZip(zipBytes: Uint8Array): Result<SkillZipPreview, SkillZipPreviewError> {
  const parsedZip = parseVfsZip(zipBytes);
  if (!parsedZip.ok) {
    return Result.err(parsedZip.error);
  }
  const entries = parsedZip.value;
  let fileCount = 0;
  for (const name of entries.keys()) {
    if (!name.endsWith("/")) {
      fileCount += 1;
    }
  }
  const skillMdBytes = entries.get("SKILL.md");
  if (skillMdBytes == null) {
    return Result.ok({
      name: null,
      description: null,
      skillMd: null,
      fileCount,
      valid: false,
    });
  }
  const skillMd = strFromU8(skillMdBytes);
  const parsed = parseSkillFrontMatter(skillMd);
  return Result.ok({
    name: parsed.name,
    description: parsed.description,
    skillMd,
    fileCount,
    valid: parsed.valid,
  });
}
