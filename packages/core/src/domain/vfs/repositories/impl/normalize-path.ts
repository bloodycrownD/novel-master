/**
 * POSIX path normalization for VFS paths.
 *
 * @module domain/vfs/repositories/impl/normalize-path
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/**
 * Normalizes a path to absolute POSIX form: leading `/`, no trailing slash (except `/`).
 *
 * @returns 规范化路径；空串 / 非绝对路径 / 越过根时返回 `VFS_INVALID_PATH`
 */
export function normalizePath(path: string): Result<string, AppError<"VFS_INVALID_PATH">> {
  if (typeof path !== "string" || path.length === 0) {
    const raw = String(path);
    return Result.err(new AppError("VFS_INVALID_PATH", `Invalid path ${raw}: path must be a non-empty string`, { path: raw }));
  }

  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    return Result.err(new AppError("VFS_INVALID_PATH", `Invalid path ${path}: path must start with /`, { path }));
  }

  const segments = normalized.split("/");
  const stack: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        return Result.err(new AppError("VFS_INVALID_PATH", `Invalid path ${path}: path escapes above root`, { path }));
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  if (stack.length === 0) {
    return Result.ok("/");
  }

  return Result.ok(`/${stack.join("/")}`);
}
