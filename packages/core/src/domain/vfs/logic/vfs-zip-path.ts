/**
 * Maps ZIP entry names to VFS logical paths and back（含子树相对路径）。
 *
 * @module domain/vfs/logic/vfs-zip-path
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { LogicalPath } from "./vfs-path-mapper.js";
import { PathNormalizer } from "../repositories/impl/normalize-path.js";

/** ZIP entry 路径映射的失败载荷（含目标目录 → 逻辑路径透传的 `VFS_INVALID_PATH`）。 */
type VfsZipPathError = AppError<"VFS_ZIP_INVALID_PATH" | "VFS_INVALID_PATH">;

export const VfsZipPath = {
    /**
   * 规范化 ZIP 目标目录；缺省或空串 → `/`。目标目录非法走 `Result.err`（错误通道迁移四期：`throw r.error` 清零，决定权交给上层）。
   */
    resolveDirectoryPath(directoryPath?: string): Result<string, AppError<"VFS_INVALID_PATH">> {
        if (directoryPath == null || directoryPath.trim() === "") {
            return Result.ok("/");
        }
        const resolved = LogicalPath.resolve(directoryPath);
        if (!resolved.ok) return resolved;
        return Result.ok(resolved.value);
    },

    /**
   * 从目标路径推导 ZIP 基名：子目录取末段、文件取文件名；根目录返回 null
   * （由调用方解析项目名兜底，见各端 exportVfsZip 的目录名/项目名规则）。
   */
    baseNameFromPath(targetPath: string): string | null {
        const normalized = targetPath.replace(/\/+$/, "");
        if (normalized === "" || normalized === "/") {
            return null;
        }
        const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
        return lastSegment === "" ? null : lastSegment;
    },

    /**
   * 将域内逻辑路径转为相对 `directoryPath` 的 ZIP entry（无 leading `/`）。
   * 目标目录自身返回空串（调用方应跳过）。
   */
    entryNameRelativeToDirectory(logical: string, directoryPath: string): Result<string, VfsZipPathError> {
        const dirResult = VfsZipPath.resolveDirectoryPath(directoryPath);
        if (!dirResult.ok) return Result.err(dirResult.error);
        const dir = dirResult.value;
        const resolved = LogicalPath.resolve(logical);
        if (!resolved.ok) return Result.err(resolved.error);
        const path = resolved.value;
        if (dir === "/") {
            // path 已由 LogicalPath.resolve 规范化（非根、无尾斜杠），去掉 leading `/` 即 entry 名。
            return path === "/" ? Result.ok("") : Result.ok(path.slice(1));
        }
        if (path === dir) {
            return Result.ok("");
        }
        const prefix = `${dir}/`;
        if (!path.startsWith(prefix)) {
            return Result.err(new AppError("VFS_ZIP_INVALID_PATH", { detail: `path ${path} is not under directory ${dir}` }));
        }
        return Result.ok(path.slice(prefix.length));
    },

    /**
   * 相对目标目录的目录 marker entry 名。
   *
   * nm-style: keep-local — 与 entryNameRelativeToDirectory 成对的目录变体（尾斜杠 + 拒绝目标目录自身），
   * 共同定义 ZIP entry 命名规则；service 单点消费，内联会把命名规则拆进 vfs-zip-io.service。
   */
    directoryEntryNameRelativeToDirectory(logical: string, directoryPath: string): Result<string, VfsZipPathError> {
        const relative = VfsZipPath.entryNameRelativeToDirectory(logical, directoryPath);
        if (!relative.ok) return relative;
        if (relative.value.length === 0) {
            return Result.err(new AppError("VFS_ZIP_INVALID_PATH", { detail: "cannot export target directory itself as a ZIP directory entry" }));
        }
        return Result.ok(`${relative.value}/`);
    },

    /**
   * 将相对目标目录的 ZIP entry 拼成域内逻辑路径。
   */
    logicalFromEntryRelativeToDirectory(entryName: string, directoryPath: string): Result<string, VfsZipPathError> {
        const trimmed = entryName.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
        if (trimmed.length === 0) {
            return Result.err(new AppError("VFS_ZIP_INVALID_PATH", { detail: "empty ZIP entry name" }));
        }
        const dirResult = VfsZipPath.resolveDirectoryPath(directoryPath);
        if (!dirResult.ok) return Result.err(dirResult.error);
        return PathNormalizer.normalize(dirResult.value === "/" ? `/${trimmed}` : `${dirResult.value}/${trimmed}`);
    },

    /**
   * 目录 marker entry → 相对 `directoryPath` 的逻辑目录路径。
   *
   * nm-style: keep-local — 与 logicalFromEntryRelativeToDirectory 成对的目录入口解析（去尾斜杠 + 空名守卫），
   * validator 单点消费；内联会把 ZIP entry 命名规则从 path 模块拆出去。
   */
    logicalFromDirectoryEntryRelativeToDirectory(entryName: string, directoryPath: string): Result<string, VfsZipPathError> {
        const withoutSlash = entryName.replace(/\\/g, "/").replace(/\/+$/, "");
        if (withoutSlash.length === 0) {
            return Result.err(new AppError("VFS_ZIP_INVALID_PATH", { detail: "empty ZIP directory entry name" }));
        }
        return VfsZipPath.logicalFromEntryRelativeToDirectory(withoutSlash, directoryPath);
    },

    /**
   * 「带域根/目标目录名错误前缀」硬失败：不剥前缀。
   * `directoryPath === "/"` 时跳过。
   *
   * nm-style: keep-local — 独立的前缀判定阶段（含 base 提取与 error.vfs.zip_root_prefix_suspected 文案），
   * validator 单点调用；内联会把判定与错误口径塞回 VfsZipValidate.validateEntries 主循环。
   */
    assertEntriesNotDomainRootPrefixed(directoryPath: string, entryNames: readonly string[]): Result<void, VfsZipPathError> {
        const dirResult = VfsZipPath.resolveDirectoryPath(directoryPath);
        if (!dirResult.ok) return Result.err(dirResult.error);
        const dir = dirResult.value;
        if (dir === "/") {
            return Result.ok(undefined);
        }
        const normalizedDir = LogicalPath.resolve(dir);
        if (!normalizedDir.ok) return Result.err(normalizedDir.error);
        const base = normalizedDir.value === "/" ? "" : normalizedDir.value.slice(normalizedDir.value.lastIndexOf("/") + 1);
        const nonEmpty = entryNames.filter((name) => name.length > 0);
        if (nonEmpty.length === 0) {
            return Result.ok(undefined);
        }
        const allMatchBase = nonEmpty.every((name) => {
            const first = name.split("/")[0] ?? "";
            return first === base;
        });
        if (allMatchBase) {
            return Result.err(new AppError("VFS_ZIP_INVALID_PATH", { descriptor: { key: "error.vfs.zip_root_prefix_suspected", params: { base } } }));
        }
        return Result.ok(undefined);
    },
} as const;
