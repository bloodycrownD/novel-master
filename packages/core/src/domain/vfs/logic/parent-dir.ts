/**
 * Parent path helper for VFS directory operations.
 *
 * @module domain/vfs/logic/parent-dir
 */

import { Result } from "@/errors/either.js";
import type { AppError } from "@/errors/app-error.js";
import { PathNormalizer } from "../repositories/impl/normalize-path.js";

export const ParentDir = {
  /** 已规范化路径的父目录（root 的父目录仍是 root）；调用方保证入参已过 normalizePath。 */
  ofNormalized(normalized: string): string {
    if (normalized === "/") {
      return "/";
    }
    const idx = normalized.lastIndexOf("/");
    return idx <= 0 ? "/" : normalized.slice(0, idx);
  },

  /** Returns the parent directory path; root's parent is `/`.
   * normalizePath 失败走 `Result.err`（错误通道迁移四期：`throw r.error` 清零，决定权交给上层；isStorageRoot 同款）。 */
  resolve(path: string): Result<string, AppError> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return resolved;
    return Result.ok(ParentDir.ofNormalized(resolved.value));
  },

  /**
   * Strict（Result）之外的 lenient 态：宽松父目录（裸返回值，无错误通道）。
   *
   * root → `null`（无父目录）；非法路径（空串 / 非绝对 / 越根）→ `null`。
   * 给 UI 导航这类「解析不出就当没有」的消费方用，也是「已 normalize 输入取
   * root→null」的通道（workplace 目录链）；要保留错误原因走 {@link ParentDir.resolve}。
   */
  orNull(path: string): string | null {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok || resolved.value === "/") return null;
    return ParentDir.ofNormalized(resolved.value);
  },

  /**
   * Scope storage roots are virtual parents (no directory row required).
   *
   * @remarks Physical roots only: global `/template`, project `…/template`, session mount.
   */
  isStorageRoot(parentPath: string): Result<boolean, AppError> {
    const resolved = PathNormalizer.normalize(parentPath);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    if (normalized === "/template") {
      return Result.ok(true);
    }
    if (/^\/projects\/[^/]+\/sessions\/[^/]+$/.test(normalized)) {
      return Result.ok(true);
    }
    if (/^\/projects\/[^/]+\/template$/.test(normalized)) {
      return Result.ok(true);
    }
    return Result.ok(false);
  },
} as const;
