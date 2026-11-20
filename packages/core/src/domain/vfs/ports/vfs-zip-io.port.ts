/**
 * VFS ZIP import/export service port.
 *
 * @module domain/vfs/ports/vfs-zip-io.port
 */

import type { VfsScope } from "../logic/vfs-path-mapper.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/** 子树 ZIP 路径选项；缺省 `directoryPath` ≡ `/`（整域）。 */
export type ZipPathOptions = {
  readonly directoryPath?: string;
};

/** Options for domain-scoped ZIP import (full replace of target subtree). */
export interface VfsZipImportOptions {
  /** Must be true before any database writes (CLI `--yes` / mobile confirm). */
  readonly confirmed: boolean;
}

/**
 * Exports or imports a VFS scope subtree as a ZIP of inline UTF-8 text files.
 * `directoryPath` 缺省为 `/`，行为与旧整域 ZIP 一致。
 * 错误通道迁移四期：解析 / 条目名校验失败走返回值 `Result.err`；
 * confirmed 门闸与导入事务链仍按边界抛出（VFS_IMPORT_FAILED 等）。
 */
export interface VfsZipIoService {
  export(scope: VfsScope, options?: ZipPathOptions): Promise<Result<Uint8Array, AppError>>;
  import(
    scope: VfsScope,
    zipBytes: Uint8Array,
    options: VfsZipImportOptions & ZipPathOptions
  ): Promise<Result<void, AppError>>;
}
