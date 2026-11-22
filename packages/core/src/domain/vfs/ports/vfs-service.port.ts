/**
 * VFS capability port and DTOs (domain contract for tools, CLI, and service impl).
 *
 * @module domain/vfs/ports/vfs-service.port
 *
 * @remarks
 * Implemented by {@link DefaultVfsService} / {@link ScopedVfsService} in service layer.
 * Builtin tools and external consumers depend on this port only — not on `service/vfs`.
 */

import type { VfsEntryKind } from "../model/vfs-entry.js";
import type { VfsListEntry } from "../model/vfs-list-entry.js";
import type { VfsGrepOptions } from "../logic/vfs-grep.js";
import type { VfsContentSize } from "../model/vfs-content-size.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

export type { VfsEntryKind, VfsListEntry, VfsContentSize };

/** Result of reading a single path. */
export interface VfsReadResult {
    readonly path: string;
    readonly content: string;
    readonly version: number;
    readonly mtimeMs: number;
}

/** A single grep match with line/column position. */
export interface VfsGrepMatch {
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly excerpt: string;
}

export type { VfsGrepOptions } from "../logic/vfs-grep.js";

/**
 * Virtual file system capability (read/write/list/glob/grep/delete/mkdir).
 *
 * @remarks
 * Scoping (global / project / session paths) is applied by scoped service wrappers;
 * callers inject the appropriate instance (e.g. session-scoped for agent tools).
 * 错误通道迁移四期：路径解析 / scope 校验失败走返回值通道（`Result<T, AppError>`）；
 * 业务错（VFS_NOT_FOUND / VFS_IS_DIRECTORY / VFS_OPERATION_UNSUPPORTED 等）仍按边界抛出。
 */
export interface VfsService {
    list(dir: string, options?: { recursive?: boolean; maxDepth?: number }): Promise<Result<VfsListEntry[], AppError>>;

    mkdir(path: string): Promise<Result<void, AppError>>;

    read(path: string): Promise<Result<VfsReadResult, AppError>>;

    /**
   * 按路径轻量探测文件 content 大小（不解正文）。
   *
   * @remarks 供读取侧降级闸门使用：超大文件不进 `read` 全文读取，避免后动
   * 历史毒数据（巨型角色卡导入产物）在组装/渲染链上触发原生 OOM。
   * 目录行 / 路径不存在等无法探测的情形返回 `null`，由调用方回退。
   */
    findContentSize(path: string): Promise<Result<VfsContentSize | null, AppError>>;

    write(path: string, content: string): Promise<Result<{ version: number }, AppError>>;

    replace(path: string, oldString: string, newString: string, options?: { replaceAll?: boolean }): Promise<Result<{ version: number; replacements: number }, AppError>>;

    glob(pattern: string, options?: { cwd?: string }): Promise<Result<string[], AppError>>;

    grep(pattern: string, options?: VfsGrepOptions): Promise<Result<VfsGrepMatch[], AppError>>;

    delete(path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>>;

    /**
   * 失败补偿：将 live head 拨回指定 revision，不 append、不 bump。
   *
   * @remarks
   * revision 缺失或 `status='deleted'` 时明确抛错。
   * live entry 不存在时按该 revision 重建（含父目录），禁止走 `write` 注水。
   */
    resetHeadToVersion(path: string, version: number): Promise<Result<void, AppError>>;

    /**
   * 失败补偿：物理删除 entry（及约定子树），不 append `deleted` 墓碑 revision。
   */
    hardDelete(path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>>;

    /**
   * 单文件重命名/移动（单事务 UPDATE entry_path，不写 revision/checkpoint）。
   *
   * @remarks
   * 是 rename 还是目录内部移动由服务端实现根据路径前缀判断：
   * 同目录改名 = rename；跨目录移动 = rename + 路径前缀变更。
   * 底层统一走 `renameVfsEntry` 原语，entry_id 不变。
   *
   * @throws 目标路径已存在时抛 ALREADY_EXISTS（需调用方先校验或传 options.overwrite）
   * @throws `DefaultVfsService` 下抛 unsupported
   */
    renamePath(from: string, to: string, options?: { overwrite?: boolean }): Promise<Result<void, AppError>>;

    /**
   * 目录前缀批量重命名（单事务 UPDATE 全部子路径，不写 revision/checkpoint）。
   *
   * @remarks
   * 底层统一走 `renamePrefixInScope` 原语，包含目录根自身及所有子孙的 path 替换。
   * 调用方保证 oldDir 和 newDir 归一化（无尾斜杠）。
   *
   * @throws 旧目录不存在时抛 NOT_FOUND
   * @throws `DefaultVfsService` 下抛 unsupported
   */
    renamePrefix(oldDir: string, newDir: string): Promise<Result<void, AppError>>;
}
