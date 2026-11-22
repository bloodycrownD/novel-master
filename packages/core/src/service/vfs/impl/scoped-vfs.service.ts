/**
 * Scoped VFS service: maps logical paths per global/project/session domain.
 *
 * 对外继续实现 {@link VfsService}（apps 层契约不变）；对内把 `scope.scopeKey` 透传给
 * {@link InternalVfsService} 的每一条点查询。entry_id 化后 `vfs_entry.path` 直接存纯
 * 逻辑路径，inner 返回的 path 本身就是 logical，`list/glob/grep` 不再需要反向转换。
 *
 * @module service/vfs/impl/scoped-vfs.service
 */

import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { InternalVfsService } from "../internal-vfs.port.js";
import { GlobMatch } from "../glob-match.js";
import type { VfsGrepMatch, VfsGrepOptions, VfsListEntry, VfsReadResult, VfsService } from "../vfs.port.js";
import type { VfsContentSize } from "@/domain/vfs/model/vfs-content-size.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/**
 * Wraps an inner {@link InternalVfsService} operating on scopeKey + logical paths.
 *
 * @remarks Callers use logical paths; scopeKey is hidden behind this translation point.
 * 错误通道迁移四期：路径解析 / scope 校验失败走返回值通道（`Result.err`），inner 仍按边界抛出的业务错（如 VFS_NOT_FOUND）原样穿透。
 */
export class ScopedVfsService implements VfsService {
    constructor(private readonly inner: InternalVfsService, private readonly scope: VfsScope) {}

    private get scopeKeyStr(): string {
        return LogicalPath.scopeKey(this.scope);
    }

    async list(dir: string, options?: { recursive?: boolean; maxDepth?: number }): Promise<Result<VfsListEntry[], AppError>> {
        const resolvedDir = LogicalPath.resolve(dir);
        if (!resolvedDir.ok) return Result.err(resolvedDir.error);
        const logicalDir = resolvedDir.value;
        const allowedDir = LogicalPath.validate(this.scope, logicalDir);
        if (!allowedDir.ok) return Result.err(allowedDir.error);
        return this.inner.list(this.scopeKeyStr, logicalDir, options);
    }

    async mkdir(path: string): Promise<Result<void, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return allowed;
        return this.inner.mkdir(this.scopeKeyStr, logical);
    }

    async read(path: string): Promise<Result<VfsReadResult, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return Result.err(allowed.error);
        return this.inner.read(this.scopeKeyStr, logical);
    }

    async findContentSize(path: string): Promise<Result<VfsContentSize | null, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return Result.err(allowed.error);
        return this.inner.findContentSize(this.scopeKeyStr, logical);
    }

    async write(path: string, content: string): Promise<Result<{ version: number }, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return Result.err(allowed.error);
        return this.inner.write(this.scopeKeyStr, logical, content);
    }

    async replace(path: string, oldString: string, newString: string, options?: { replaceAll?: boolean }): Promise<Result<{ version: number; replacements: number }, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return Result.err(allowed.error);
        return this.inner.replace(this.scopeKeyStr, logical, oldString, newString, options);
    }

    async glob(pattern: string, options?: { cwd?: string }): Promise<Result<string[], AppError>> {
        const cwd = options?.cwd;
        let logicalCwd: string | undefined;
        if (cwd != null) {
            const resolved = LogicalPath.resolve(cwd);
            if (!resolved.ok) return Result.err(resolved.error);
            logicalCwd = resolved.value;
            const allowedCwd = LogicalPath.validate(this.scope, logicalCwd);
            if (!allowedCwd.ok) return Result.err(allowedCwd.error);
        }
        return Result.ok(await this.inner.glob(this.scopeKeyStr, pattern, { cwd: logicalCwd }));
    }

    async grep(pattern: string, options?: VfsGrepOptions): Promise<Result<VfsGrepMatch[], AppError>> {
        const prefix = options?.pathPrefix;
        let logicalPrefix: string | undefined;
        if (prefix != null) {
            const resolved = LogicalPath.resolve(prefix);
            if (!resolved.ok) return Result.err(resolved.error);
            logicalPrefix = resolved.value;
            const allowedPrefix = LogicalPath.validate(this.scope, logicalPrefix);
            if (!allowedPrefix.ok) return Result.err(allowedPrefix.error);
        }
        const { pathGlob, ...innerOptions } = options ?? {};
        const matches = await this.inner.grep(this.scopeKeyStr, pattern, { ...innerOptions, pathPrefix: logicalPrefix });
        if (!matches.ok) return matches;
        return Result.ok(matches.value.filter((m) => (pathGlob != null ? GlobMatch.match(pathGlob, m.path) : true)));
    }

    async delete(path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return allowed;
        return this.inner.delete(this.scopeKeyStr, logical, options);
    }

    async resetHeadToVersion(path: string, version: number): Promise<Result<void, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return allowed;
        return this.inner.resetHeadToVersion(this.scopeKeyStr, logical, version);
    }

    async hardDelete(path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>> {
        const resolved = LogicalPath.resolve(path);
        if (!resolved.ok) return Result.err(resolved.error);
        const logical = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logical);
        if (!allowed.ok) return allowed;
        return this.inner.hardDelete(this.scopeKeyStr, logical, options);
    }

    async renamePath(from: string, to: string, options?: { overwrite?: boolean }): Promise<Result<void, AppError>> {
        const resolvedFrom = LogicalPath.resolve(from);
        if (!resolvedFrom.ok) return Result.err(resolvedFrom.error);
        const logicalFrom = resolvedFrom.value;
        const resolvedTo = LogicalPath.resolve(to);
        if (!resolvedTo.ok) return Result.err(resolvedTo.error);
        const logicalTo = resolvedTo.value;
        const allowedFrom = LogicalPath.validate(this.scope, logicalFrom);
        if (!allowedFrom.ok) return allowedFrom;
        const allowedTo = LogicalPath.validate(this.scope, logicalTo);
        if (!allowedTo.ok) return allowedTo;
        return this.inner.renamePath(this.scopeKeyStr, logicalFrom, logicalTo, options);
    }

    async renamePrefix(oldDir: string, newDir: string): Promise<Result<void, AppError>> {
        const resolvedOld = LogicalPath.resolve(oldDir);
        if (!resolvedOld.ok) return Result.err(resolvedOld.error);
        const logicalOld = resolvedOld.value;
        const resolvedNew = LogicalPath.resolve(newDir);
        if (!resolvedNew.ok) return Result.err(resolvedNew.error);
        const logicalNew = resolvedNew.value;
        const allowedOld = LogicalPath.validate(this.scope, logicalOld);
        if (!allowedOld.ok) return allowedOld;
        const allowedNew = LogicalPath.validate(this.scope, logicalNew);
        if (!allowedNew.ok) return allowedNew;
        return this.inner.renamePrefix(this.scopeKeyStr, logicalOld, logicalNew);
    }
}
