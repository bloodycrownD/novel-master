/**
 * Maps ZIP entry names to VFS logical paths and back（含子树相对路径）。
 *
 * @module domain/vfs/logic/vfs-zip-path
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { resolveLogicalPath } from "./vfs-path-mapper.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";

/** ZIP entry 路径映射的失败载荷。 */
type VfsZipPathError = AppError<"VFS_ZIP_INVALID_PATH">;

/**
 * 规范化 ZIP 目标目录；缺省或空串 → `/`。
 */
export function resolveZipDirectoryPath(directoryPath?: string): string {
  if (directoryPath == null || directoryPath.trim() === "") {
    return "/";
  }
  return resolveLogicalPath(directoryPath);
}

/** ZIP entry name from a domain logical path (strips leading `/`). */
export function zipEntryNameFromLogical(logical: string): Result<string, VfsZipPathError> {
  const normalized = normalizePath(logical);
  if (normalized === "/") {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", "cannot export root as a ZIP entry"));
  }
  return Result.ok(normalized.startsWith("/") ? normalized.slice(1) : normalized);
}

/**
 * 将域内逻辑路径转为相对 `directoryPath` 的 ZIP entry（无 leading `/`）。
 * 目标目录自身返回空串（调用方应跳过）。
 */
export function zipEntryNameRelativeToDirectory(logical: string, directoryPath: string): Result<string, VfsZipPathError> {
  const dir = resolveZipDirectoryPath(directoryPath);
  const path = resolveLogicalPath(logical);
  if (dir === "/") {
    return path === "/" ? Result.ok("") : zipEntryNameFromLogical(path);
  }
  if (path === dir) {
    return Result.ok("");
  }
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix)) {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", `path ${path} is not under directory ${dir}`));
  }
  return Result.ok(path.slice(prefix.length));
}

/**
 * 相对目标目录的目录 marker entry 名。
 */
export function zipDirectoryEntryNameRelativeToDirectory(logical: string, directoryPath: string): Result<string, VfsZipPathError> {
  const relative = zipEntryNameRelativeToDirectory(logical, directoryPath);
  if (!relative.ok) return relative;
  if (relative.value.length === 0) {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", "cannot export target directory itself as a ZIP directory entry"));
  }
  return Result.ok(`${relative.value}/`);
}

/**
 * 将相对目标目录的 ZIP entry 拼成域内逻辑路径。
 */
export function logicalFromZipEntryRelativeToDirectory(entryName: string, directoryPath: string): Result<string, VfsZipPathError> {
  const trimmed = entryName.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", "empty ZIP entry name"));
  }
  const dir = resolveZipDirectoryPath(directoryPath);
  return Result.ok(normalizePath(dir === "/" ? `/${trimmed}` : `${dir}/${trimmed}`));
}

/**
 * 目录 marker entry → 相对 `directoryPath` 的逻辑目录路径。
 */
export function logicalFromZipDirectoryEntryRelativeToDirectory(entryName: string, directoryPath: string): Result<string, VfsZipPathError> {
  const withoutSlash = entryName.replace(/\\/g, "/").replace(/\/+$/, "");
  if (withoutSlash.length === 0) {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", "empty ZIP directory entry name"));
  }
  return logicalFromZipEntryRelativeToDirectory(withoutSlash, directoryPath);
}

/**
 * 「带域根/目标目录名错误前缀」硬失败：不剥前缀。
 * `directoryPath === "/"` 时跳过。
 */
export function assertZipEntriesNotDomainRootPrefixed(directoryPath: string, entryNames: readonly string[]): Result<void, VfsZipPathError> {
  const dir = resolveZipDirectoryPath(directoryPath);
  if (dir === "/") {
    return Result.ok(undefined);
  }
  const normalizedDir = resolveLogicalPath(dir);
  const base = normalizedDir === "/" ? "" : normalizedDir.slice(normalizedDir.lastIndexOf("/") + 1);
  const nonEmpty = entryNames.filter((name) => name.length > 0);
  if (nonEmpty.length === 0) {
    return Result.ok(undefined);
  }
  const allMatchBase = nonEmpty.every((name) => {
    const first = name.split("/")[0] ?? "";
    return first === base;
  });
  if (allMatchBase) {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", `ZIP 似以目标目录名「${base}」作根前缀，请使用相对该目录的内容，系统不会自动剥离`));
  }
  return Result.ok(undefined);
}
