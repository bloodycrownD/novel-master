/**
 * Maps logical VFS paths to physical `vfs_entry.path` values per scope.
 *
 * @module domain/vfs/vfs-path-mapper
 */

import { vfsInvalidPath } from "@/errors/vfs-errors.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";

/** VFS visibility scope (global, project, or session). */
export type VfsScope =
  | { kind: "global" }
  | { kind: "project"; projectId: string }
  | { kind: "session"; projectId: string; sessionId: string };

/** Physical mount prefix for global template storage (not exposed as logical `/template`). */
const GLOBAL_PHYSICAL_PREFIX = "/template";

/** Legacy logical prefix — rejected on input; no dual-read. */
const LEGACY_TEMPLATE_LOGICAL = "/template";

const LEGACY_TEMPLATE_MESSAGE =
  "逻辑路径以 `/` 为根，请勿使用 `/template/` 前缀";

function isLegacyTemplateLogicalPath(normalized: string): boolean {
  return (
    normalized === LEGACY_TEMPLATE_LOGICAL ||
    normalized.startsWith(`${LEGACY_TEMPLATE_LOGICAL}/`)
  );
}

/**
 * 针对已规范化的路径做 `/template` 旧前缀校验。
 *
 * 抽出来是为了让 {@link toPhysicalPath} 拿到规范化结果后能直接复用，不必再
 * 走一遍 {@link resolveLogicalPath} 重复 normalize。
 */
function assertNormalizedPathAllowed(normalized: string): void {
  if (isLegacyTemplateLogicalPath(normalized)) {
    throw vfsInvalidPath(normalized, LEGACY_TEMPLATE_MESSAGE);
  }
}

/**
 * Resolves caller path input to a normalized absolute logical path.
 *
 * @param input - Absolute (`/notes/a.md`) or relative (`notes/a.md`) path
 * @returns Normalized logical path under `/`
 * @throws {import("@/errors/vfs-errors.js").VfsError} `INVALID_PATH` when empty or invalid
 */
export function resolveLogicalPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw vfsInvalidPath(String(input), "path must be a non-empty string");
  }
  if (trimmed.startsWith("/")) {
    return normalizePath(trimmed);
  }
  return normalizePath(`/${trimmed}`);
}

/**
 * Validates that a logical path is allowed for the given scope.
 *
 * @throws {import("@/errors/vfs-errors.js").VfsError} `INVALID_PATH`
 */
export function assertLogicalPathAllowed(_scope: VfsScope, logical: string): void {
  const normalized = resolveLogicalPath(logical);
  assertNormalizedPathAllowed(normalized);
}

/**
 * Converts a caller logical path to the physical `vfs_entry.path`.
 */
export function toPhysicalPath(scope: VfsScope, logical: string): string {
  const normalized = resolveLogicalPath(logical);
  assertNormalizedPathAllowed(normalized);
  switch (scope.kind) {
    case "global":
      if (normalized === "/") {
        return GLOBAL_PHYSICAL_PREFIX;
      }
      return `${GLOBAL_PHYSICAL_PREFIX}${normalized}`;
    case "project": {
      const prefix = `/projects/${scope.projectId}/template`;
      if (normalized === "/") {
        return prefix;
      }
      return `${prefix}${normalized}`;
    }
    case "session": {
      const prefix = `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
      if (normalized === "/") {
        return prefix;
      }
      return `${prefix}${normalized}`;
    }
  }
}

/**
 * Converts a physical path back to the logical path for the scope.
 *
 * @throws {import("@/errors/vfs-errors.js").VfsError} `INVALID_PATH` when out of scope
 */
export function toLogicalPath(scope: VfsScope, physical: string): string {
  const normalized = normalizePath(physical);
  switch (scope.kind) {
    case "global": {
      if (
        normalized !== GLOBAL_PHYSICAL_PREFIX &&
        !normalized.startsWith(`${GLOBAL_PHYSICAL_PREFIX}/`)
      ) {
        throw vfsInvalidPath(physical, "not in global template scope");
      }
      if (normalized === GLOBAL_PHYSICAL_PREFIX) {
        return "/";
      }
      return normalized.slice(GLOBAL_PHYSICAL_PREFIX.length);
    }
    case "project": {
      const prefix = `/projects/${scope.projectId}/template`;
      if (normalized === prefix) {
        return "/";
      }
      if (!normalized.startsWith(`${prefix}/`)) {
        throw vfsInvalidPath(physical, "not in project template scope");
      }
      return normalized.slice(prefix.length);
    }
    case "session": {
      const prefix = `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
      if (normalized === prefix) {
        return "/";
      }
      if (!normalized.startsWith(`${prefix}/`)) {
        throw vfsInvalidPath(physical, "not in session scope");
      }
      return normalized.slice(prefix.length);
    }
  }
}

/**
 * scope 对应的 scope_key 字符串（vfs_entry.scope_key 列取值）。
 *
 * 取值与 `infer-scope-from-path.ts` 的反解规则一致：
 * global → `global`，project → `project:{pid}`，session → `session:{pid}:{sid}`。
 */
export function scopeKey(scope: VfsScope): string {
  switch (scope.kind) {
    case "global":
      return "global";
    case "project":
      return `project:${scope.projectId}`;
    case "session":
      return `session:${scope.projectId}:${scope.sessionId}`;
  }
}

/** Physical prefix for a scope (for tree copy and bulk delete). */
export function scopePhysicalPrefix(scope: VfsScope): string {
  switch (scope.kind) {
    case "global":
      return GLOBAL_PHYSICAL_PREFIX;
    case "project":
      return `/projects/${scope.projectId}/template`;
    case "session":
      return `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
  }
}

/** Physical prefix for all vfs rows under a project (sessions + template). */
export function projectVfsPrefix(projectId: string): string {
  return `/projects/${projectId}`;
}
