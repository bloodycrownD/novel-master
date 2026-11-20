/**
 * Maps logical VFS paths to physical `vfs_entry.path` values per scope.
 *
 * @module domain/vfs/vfs-path-mapper
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import { PathNormalizer } from "../repositories/impl/normalize-path.js";

/** VFS visibility scope (global, project, session, and meta domains). */
export type VfsScope = { kind: "global" } | { kind: "project"; projectId: string } | { kind: "session"; projectId: string; sessionId: string } | { kind: "global-meta" } | { kind: "project-meta"; projectId: string };

/**
 * global-meta 域的物理挂载前缀为**空串**：域内逻辑路径自带 `/meta` 段
 * （SkillsService 约定写 `/meta/skills/...`），物理路径 = 逻辑路径原样，
 * 再叠前缀会拼出 `/meta/meta/...` 双前缀废路径。
 */
const GLOBAL_META_PHYSICAL_PREFIX = "";

/** Physical mount prefix for global template storage (not exposed as logical `/template`). */
const GLOBAL_PHYSICAL_PREFIX = "/template";

/** Legacy logical prefix — rejected on input; no dual-read. */
const LEGACY_TEMPLATE_LOGICAL = "/template";

const LEGACY_TEMPLATE_MESSAGE: CoreMessageDescriptor = {key: "error.vfs.template_prefix_forbidden"};

export const LogicalPath = {
  /** 是否为会话工作区 scope（需走 userVfsTurn）。 */
  isSessionVfsScope: (scope: VfsScope): scope is Extract<VfsScope, { kind: "session" }> =>
    scope.kind === "session",

  /**
   * Resolves caller path input to a normalized absolute logical path.
   *
   * @param input - Absolute (`/notes/a.md`) or relative (`notes/a.md`) path
   * @returns Normalized logical path under `/`；空输入或 {@link PathNormalizer.normalize} 拒绝时返回
   * `VFS_INVALID_PATH` 而非抛出
   */
  resolve: (input: string): Result<string, AppError<"VFS_INVALID_PATH">> => {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return Result.err(new AppError("VFS_INVALID_PATH", { detail: `Invalid path ${String(input)}: path must be a non-empty string`, path: String(input) }));
    }
    if (trimmed.startsWith("/")) {
      return PathNormalizer.normalize(trimmed);
    }
    return PathNormalizer.normalize(`/${trimmed}`);
  },

  /**
   * Validates that a logical path is allowed for the given scope（resolve + legacy `/template` 前缀校验）。
   *
   * @returns 失败分支载荷为 `VFS_INVALID_PATH`；legacy `/template` 前缀带 descriptor messageKey
   */
  validate: (_scope: VfsScope, logical: string): Result<void, AppError<"VFS_INVALID_PATH">> =>
    LogicalPath.resolve(logical).andThen((normalized) => LogicalPath.validateNormalizedPath(normalized)),

  /**
   * Converts a caller logical path to the physical `vfs_entry.path`.
   *
   * @returns 失败分支载荷为 `VFS_INVALID_PATH`（路径非法或 legacy `/template` 前缀）
   */
  toPhysical: (scope: VfsScope, logical: string): Result<string, AppError<"VFS_INVALID_PATH">> => {
    const resolved = LogicalPath.resolve(logical);
    if (!resolved.ok) return resolved;
    const allowed = LogicalPath.validateNormalizedPath(resolved.value);
    if (!allowed.ok) return Result.err(allowed.error);
    const normalized = resolved.value;
    switch (scope.kind) {
      case "global":
        if (normalized === "/") {
          return Result.ok(GLOBAL_PHYSICAL_PREFIX);
        }
        return Result.ok(`${GLOBAL_PHYSICAL_PREFIX}${normalized}`);
      case "project": {
        const prefix = `/projects/${scope.projectId}/template`;
        if (normalized === "/") {
          return Result.ok(prefix);
        }
        return Result.ok(`${prefix}${normalized}`);
      }
      case "session": {
        const prefix = `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
        if (normalized === "/") {
          return Result.ok(prefix);
        }
        return Result.ok(`${prefix}${normalized}`);
      }
      case "global-meta":
        // 域内逻辑路径自带 /meta 段，物理 = 逻辑原样（前缀为空串）
        return Result.ok(normalized);
      case "project-meta": {
        // 域内逻辑路径自带 /meta 段，物理仅再拼 /projects/{pid} 项目段
        const prefix = `/projects/${scope.projectId}`;
        if (normalized === "/") {
          return Result.ok(prefix);
        }
        return Result.ok(`${prefix}${normalized}`);
      }
    }
  },

  /**
   * Converts a physical path back to the logical path for the scope.
   *
   * @returns 失败分支载荷为 `VFS_INVALID_PATH`（物理路径非法或越出 scope）
   */
  toLogical: (scope: VfsScope, physical: string): Result<string, AppError<"VFS_INVALID_PATH">> => {
    const resolved = PathNormalizer.normalize(physical);
    if (!resolved.ok) return resolved;
    const normalized = resolved.value;
    switch (scope.kind) {
      case "global": {
        if (normalized !== GLOBAL_PHYSICAL_PREFIX && !normalized.startsWith(`${GLOBAL_PHYSICAL_PREFIX}/`)) {
          return Result.err(new AppError("VFS_INVALID_PATH", {path: physical, reason: "not in global template scope", detail: `Invalid path ${physical}: not in global template scope`}));
        }
        if (normalized === GLOBAL_PHYSICAL_PREFIX) {
          return Result.ok("/");
        }
        return Result.ok(normalized.slice(GLOBAL_PHYSICAL_PREFIX.length));
      }
      case "project": {
        const prefix = `/projects/${scope.projectId}/template`;
        if (normalized === prefix) {
          return Result.ok("/");
        }
        if (!normalized.startsWith(`${prefix}/`)) {
          return Result.err(new AppError("VFS_INVALID_PATH", {path: physical, reason: "not in project template scope", detail: `Invalid path ${physical}: not in project template scope`}));
        }
        return Result.ok(normalized.slice(prefix.length));
      }
      case "session": {
        const prefix = `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
        if (normalized === prefix) {
          return Result.ok("/");
        }
        if (!normalized.startsWith(`${prefix}/`)) {
          return Result.err(new AppError("VFS_INVALID_PATH", {path: physical, reason: "not in session scope", detail: `Invalid path ${physical}: not in session scope`}));
        }
        return Result.ok(normalized.slice(prefix.length));
      }
      case "global-meta":
        // 物理 = 逻辑原样（域内逻辑路径自带 /meta 段），不再剥挂载段
        return Result.ok(normalized);
      case "project-meta": {
        const prefix = `/projects/${scope.projectId}`;
        const metaPrefix = `${prefix}/meta`;
        // 域内逻辑路径自带 /meta 段：物理必须形如 /projects/{pid}/meta[...]，
        // 否则是同项目其他子域（如 template）的路径，不属于 project-meta 域
        if (normalized !== metaPrefix && !normalized.startsWith(`${metaPrefix}/`)) {
          return Result.err(new AppError("VFS_INVALID_PATH", {path: physical, reason: "not in project meta scope", detail: `Invalid path ${physical}: not in project meta scope`}));
        }
        // 剥掉 /projects/{pid} 项目段，保留域内自带的 /meta 段
        return Result.ok(normalized.slice(prefix.length));
      }
    }
  },

  /**
   * scope 对应的 scope_key 字符串（vfs_entry.scope_key 列取值）。
   *
   * global → `global`，project → `project:{pid}`，session → `session:{pid}:{sid}`。
   */
  scopeKey: (scope: VfsScope): string => {
    switch (scope.kind) {
      case "global":
        return "global";
      case "project":
        return `project:${scope.projectId}`;
      case "session":
        return `session:${scope.projectId}:${scope.sessionId}`;
      case "global-meta":
        return "global:meta";
      case "project-meta":
        return `project:${scope.projectId}:meta`;
    }
  },

  /** Physical prefix for a scope (for tree copy and bulk delete). */
  scopePhysicalPrefix: (scope: VfsScope): string => {
    switch (scope.kind) {
      case "global":
        return GLOBAL_PHYSICAL_PREFIX;
      case "project":
        return `/projects/${scope.projectId}/template`;
      case "session":
        return `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
      case "global-meta":
        // 逻辑路径自带 /meta 段，无额外挂载前缀
        return GLOBAL_META_PHYSICAL_PREFIX;
      case "project-meta":
        // 逻辑路径自带 /meta 段，挂载前缀仅 /projects/{pid} 项目段
        return `/projects/${scope.projectId}`;
    }
  },

  /**
   * 针对已规范化的路径做 `/template` 旧前缀校验。
   *
   * 抽出来是为了让 {@link LogicalPath.validate} 与 {@link LogicalPath.toPhysical} 拿到
   * 规范化结果后能直接复用，不必再走一遍 {@link LogicalPath.resolve} 重复 normalize。
   */
  validateNormalizedPath: (normalized: string): Result<void, AppError<"VFS_INVALID_PATH">> => {
    if (normalized === LEGACY_TEMPLATE_LOGICAL || normalized.startsWith(`${LEGACY_TEMPLATE_LOGICAL}/`)) {
      return Result.err(new AppError("VFS_INVALID_PATH", {path: normalized, reason: LEGACY_TEMPLATE_MESSAGE}));
    }
    return Result.ok(undefined);
  },
} as const;
