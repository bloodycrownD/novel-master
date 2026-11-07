/**
 * Maps ZIP entry names to VFS logical paths and back（含子树相对路径）。
 *
 * @module domain/vfs/logic/vfs-zip-path
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { resolveLogicalPath } from "./vfs-path-mapper.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";

/** ZIP entry 路径映射的失败载荷（含目标目录 → 逻辑路径透传的 `VFS_INVALID_PATH`）。 */
type VfsZipPathError = AppError<"VFS_ZIP_INVALID_PATH" | "VFS_INVALID_PATH">;

/**
 * 规范化 ZIP 目标目录；缺省或空串 → `/`。
 *
 * @throws AppError<"VFS_INVALID_PATH"> 目标目录非法（保持原抛错时机）
 */
export function resolveZipDirectoryPath(directoryPath?: string): string {
  if (directoryPath == null || directoryPath.trim() === "") {
    return "/";
  }
  const resolved = resolveLogicalPath(directoryPath);
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}

/**
 * 将域内逻辑路径转为相对 `directoryPath` 的 ZIP entry（无 leading `/`）。
 * 目标目录自身返回空串（调用方应跳过）。
 */
export function zipEntryNameRelativeToDirectory(logical: string, directoryPath: string): Result<string, VfsZipPathError> {
  const dir = resolveZipDirectoryPath(directoryPath);
  const resolved = resolveLogicalPath(logical);
  if (!resolved.ok) return Result.err(resolved.error);
  const path = resolved.value;
  if (dir === "/") {
    // path 已由 resolveLogicalPath 规范化（非根、无尾斜杠），去掉 leading `/` 即 entry 名。
    return path === "/" ? Result.ok("") : Result.ok(path.slice(1));
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
 *
 * nm-style: keep-local — 与 zipEntryNameRelativeToDirectory 成对的目录变体（尾斜杠 + 拒绝目标目录自身），
 * 共同定义 ZIP entry 命名规则；service 单点消费，内联会把命名规则拆进 vfs-zip-io.service。
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
  return normalizePath(dir === "/" ? `/${trimmed}` : `${dir}/${trimmed}`);
}

/**
 * 目录 marker entry → 相对 `directoryPath` 的逻辑目录路径。
 *
 * nm-style: keep-local — 与 logicalFromZipEntryRelativeToDirectory 成对的目录入口解析（去尾斜杠 + 空名守卫），
 * validator 单点消费；内联会把 ZIP entry 命名规则从 path 模块拆出去。
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
 *
 * nm-style: keep-local — 独立的前缀判定阶段（含 base 提取与 error.vfs.zip_root_prefix_suspected 文案），
 * validator 单点调用；内联会把判定与错误口径塞回 validateVfsZipEntries 主循环。
 */
export function assertZipEntriesNotDomainRootPrefixed(directoryPath: string, entryNames: readonly string[]): Result<void, VfsZipPathError> {
  const dir = resolveZipDirectoryPath(directoryPath);
  if (dir === "/") {
    return Result.ok(undefined);
  }
  const normalizedDir = resolveLogicalPath(dir);
  if (!normalizedDir.ok) return Result.err(normalizedDir.error);
  const base = normalizedDir.value === "/" ? "" : normalizedDir.value.slice(normalizedDir.value.lastIndexOf("/") + 1);
  const nonEmpty = entryNames.filter((name) => name.length > 0);
  if (nonEmpty.length === 0) {
    return Result.ok(undefined);
  }
  const allMatchBase = nonEmpty.every((name) => {
    const first = name.split("/")[0] ?? "";
    return first === base;
  });
  if (allMatchBase) {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", {key: "error.vfs.zip_root_prefix_suspected", params: {base}}));
  }
  return Result.ok(undefined);
}
