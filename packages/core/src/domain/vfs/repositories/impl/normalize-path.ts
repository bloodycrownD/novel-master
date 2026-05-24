/**
 * POSIX path normalization for VFS paths.
 *
 * @module domain/vfs/repositories/impl/normalize-path
 */

import { vfsInvalidPath } from "@/errors/vfs-errors.js";

/**
 * Normalizes a path to absolute POSIX form: leading `/`, no trailing slash (except `/`).
 *
 * @throws {import("../../../../errors/vfs-errors.js").VfsError} `INVALID_PATH`
 */
export function normalizePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw vfsInvalidPath(String(path), "path must be a non-empty string");
  }

  let normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    throw vfsInvalidPath(path, "path must start with /");
  }

  const segments = normalized.split("/");
  const stack: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        throw vfsInvalidPath(path, "path escapes above root");
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  if (stack.length === 0) {
    return "/";
  }

  return `/${stack.join("/")}`;
}
