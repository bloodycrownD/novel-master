/**
 * 批量导入相对路径规范化与逻辑路径拼接。
 *
 * @module domain/vfs/logic/vfs-batch-path
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { resolveLogicalPath } from "./vfs-path-mapper.js";

/** 批量路径拼接的失败载荷。 */
type VfsBatchPathError = AppError<"VFS_INVALID_PATH">;

/**
 * 规范化 ingest 相对路径：去掉 leading `/`、反斜杠转正斜杠、拒绝 `..`。
 * @returns 规范化相对路径，或 `null`（非法）
 */
export function normalizeBatchRelativePath(relativePath: string): string | null {
  const trimmed = relativePath.trim().replace(/\\/g, "/");
  if (trimmed.length === 0 || trimmed === ".") {
    return null;
  }
  const withoutLeading = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (withoutLeading.length === 0) {
    return null;
  }
  const segments = withoutLeading.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return null;
    }
    stack.push(segment);
  }
  if (stack.length === 0) {
    return null;
  }
  return stack.join("/");
}

/** 将相对路径拼到目标目录下，得到逻辑绝对路径。 */
export function joinTargetLogicalPath(targetDir: string, relativePath: string): Result<string, VfsBatchPathError> {
  const dir = resolveLogicalPath(targetDir);
  const rel = normalizeBatchRelativePath(relativePath);
  if (rel == null) {
    return Result.err(new AppError("VFS_INVALID_PATH", `invalid batch relative path: ${relativePath}`, { path: relativePath }));
  }
  return Result.ok(dir === "/" ? `/${rel}` : `${dir}/${rel}`);
}

/**
 * 逻辑路径相对导出锚点的相对路径（无 leading `/`）。
 * 锚点自身返回空串。
 */
export function relativePathUnderAnchor(logical: string, anchor: string): Result<string, VfsBatchPathError> {
  const path = resolveLogicalPath(logical);
  const root = resolveLogicalPath(anchor);
  if (root === "/") {
    return Result.ok(path === "/" ? "" : path.slice(1));
  }
  if (path === root) {
    return Result.ok("");
  }
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) {
    return Result.err(new AppError("VFS_INVALID_PATH", `path ${path} is not under ${root}`, { path }));
  }
  return Result.ok(path.slice(prefix.length));
}
