/**
 * Maps ZIP entry names to VFS logical paths and back（含子树相对路径）。
 *
 * @module domain/vfs/logic/vfs-zip-path
 */

import { vfsZipError } from "@/errors/vfs-zip-errors.js";
import { resolveLogicalPath } from "./vfs-path-mapper.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";

/**
 * 规范化 ZIP 目标目录；缺省或空串 → `/`。
 */
export function resolveZipDirectoryPath(directoryPath?: string): string {
  if (directoryPath == null || directoryPath.trim() === "") {
    return "/";
  }
  return resolveLogicalPath(directoryPath);
}

/**
 * 逻辑路径的最后一段；根路径返回空串。
 */
export function basenameOfLogicalPath(logical: string): string {
  const normalized = resolveLogicalPath(logical);
  if (normalized === "/") {
    return "";
  }
  const idx = normalized.lastIndexOf("/");
  return normalized.slice(idx + 1);
}

/**
 * ZIP entry name from a domain logical path (strips leading `/`).
 */
export function zipEntryNameFromLogical(logical: string): string {
  const normalized = normalizePath(logical);
  if (normalized === "/") {
    throw vfsZipError("INVALID_PATH", "cannot export root as a ZIP entry");
  }
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

/**
 * 将域内逻辑路径转为相对 `directoryPath` 的 ZIP entry（无 leading `/`）。
 * 目标目录自身返回空串（调用方应跳过）。
 */
export function zipEntryNameRelativeToDirectory(
  logical: string,
  directoryPath: string,
): string {
  const dir = resolveZipDirectoryPath(directoryPath);
  const path = resolveLogicalPath(logical);
  if (dir === "/") {
    return path === "/" ? "" : zipEntryNameFromLogical(path);
  }
  if (path === dir) {
    return "";
  }
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix)) {
    throw vfsZipError(
      "INVALID_PATH",
      `path ${path} is not under directory ${dir}`,
    );
  }
  return path.slice(prefix.length);
}

/** ZIP directory marker entry name (`dir/` suffix) from a logical directory path. */
export function zipDirectoryEntryNameFromLogical(logical: string): string {
  return `${zipEntryNameFromLogical(logical)}/`;
}

/**
 * 相对目标目录的目录 marker entry 名。
 */
export function zipDirectoryEntryNameRelativeToDirectory(
  logical: string,
  directoryPath: string,
): string {
  const relative = zipEntryNameRelativeToDirectory(logical, directoryPath);
  if (relative.length === 0) {
    throw vfsZipError(
      "INVALID_PATH",
      "cannot export target directory itself as a ZIP directory entry",
    );
  }
  return `${relative}/`;
}

/**
 * Restores a logical path from a ZIP entry name（相对域根）。
 */
export function logicalFromZipEntryName(entryName: string): string {
  const trimmed = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (trimmed.length === 0) {
    throw vfsZipError("INVALID_PATH", "empty ZIP entry name");
  }
  return normalizePath(`/${trimmed}`);
}

/**
 * 将相对目标目录的 ZIP entry 拼成域内逻辑路径。
 */
export function logicalFromZipEntryRelativeToDirectory(
  entryName: string,
  directoryPath: string,
): string {
  const trimmed = entryName
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw vfsZipError("INVALID_PATH", "empty ZIP entry name");
  }
  const dir = resolveZipDirectoryPath(directoryPath);
  if (dir === "/") {
    return normalizePath(`/${trimmed}`);
  }
  return normalizePath(`${dir}/${trimmed}`);
}

/** Logical directory path from a ZIP entry ending with `/`. */
export function logicalFromZipDirectoryEntryName(entryName: string): string {
  const withoutSlash = entryName.replace(/\\/g, "/").replace(/\/+$/, "");
  if (withoutSlash.length === 0) {
    throw vfsZipError("INVALID_PATH", "empty ZIP directory entry name");
  }
  return logicalFromZipEntryName(withoutSlash);
}

/**
 * 目录 marker entry → 相对 `directoryPath` 的逻辑目录路径。
 */
export function logicalFromZipDirectoryEntryRelativeToDirectory(
  entryName: string,
  directoryPath: string,
): string {
  const withoutSlash = entryName.replace(/\\/g, "/").replace(/\/+$/, "");
  if (withoutSlash.length === 0) {
    throw vfsZipError("INVALID_PATH", "empty ZIP directory entry name");
  }
  return logicalFromZipEntryRelativeToDirectory(withoutSlash, directoryPath);
}

/**
 * 「带域根/目标目录名错误前缀」硬失败：不剥前缀。
 * `directoryPath === "/"` 时跳过。
 */
export function assertZipEntriesNotDomainRootPrefixed(
  directoryPath: string,
  entryNames: readonly string[],
): void {
  const dir = resolveZipDirectoryPath(directoryPath);
  if (dir === "/") {
    return;
  }
  const base = basenameOfLogicalPath(dir);
  const nonEmpty = entryNames.filter((name) => name.length > 0);
  if (nonEmpty.length === 0) {
    return;
  }
  const allMatchBase = nonEmpty.every((name) => {
    const first = name.split("/")[0] ?? "";
    return first === base;
  });
  if (allMatchBase) {
    throw vfsZipError(
      "INVALID_PATH",
      `ZIP 似以目标目录名「${base}」作根前缀，请使用相对该目录的内容，系统不会自动剥离`,
    );
  }
}
