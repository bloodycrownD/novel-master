/**
 * 用户保存前读取磁盘 baseline（与 Desktop/Mobile FileEditor 对齐）。
 *
 * @module domain/vfs/logic/read-user-vfs-save-baseline
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

export const UserVfsSaveBaseline = {
    /**
   * 保存映射用的 baseline：读盘当前内容；新文件（NOT_FOUND）返回 null，
   * 其余失败进 `Result.err`。
   */
    async read(vfs: VfsService, path: string): Promise<Result<string | null, AppError>> {
        const read = await vfs.read(path);
        if (read.ok) return Result.ok(read.value.content);
        if (read.error.key === "VFS_NOT_FOUND") return Result.ok(null);
        return Result.err(read.error);
    },
} as const;
