/** VFS tree row display helpers (aligned with mobile vfs-row-mapper). */
import {
    displayStateLabel,
    inclusionModeLabel,
    ruleStateLabel,
} from "@shared/logic/workplace";
import type { WorkplaceListRowDto } from "@shared/ipc-types";

/** `/notes/ch1.md` → [`notes`, `ch1.md`]（跳过空段） */
export function logicalPathSegments(path: string): string[] {
    if (path === "/") {
        return [];
    }
    return path.split("/").filter(Boolean);
}

/** 段 index 对应的绝对逻辑路径，如 index=0 → `/notes` */
export function logicalPathForSegmentIndex( segments: readonly string[], index: number ): string {
    if (index < 0 || index >= segments.length) {
        // nm-throw: keep — 不变量破坏（index 由 ancestorDirPaths 循环边界与渲染层段切分保证，代码写错才可达），不占产品码；renderer 不引 core 运行时无法用 AssertionError，vfs-tree-utils.test 以 assert.throws 锁定 RangeError 通道
        throw new RangeError(`segment index 越界: ${index}`);
    }
    return `/${segments.slice(0, index + 1).join("/")}`;
}

/** 从根到目标目录的路径链（含目标；用于树展开请求） */
export function ancestorDirPaths(path: string): string[] {
    if (path === "/") {
        return ["/"];
    }
    const segments = logicalPathSegments(path);
    const dirs: string[] = ["/"];
    for (let i = 0; i < segments.length; i++) {
        dirs.push(logicalPathForSegmentIndex(segments, i));
    }
    return dirs;
}

/** Parent logical path; session root `/` stays `/`. */
export function parentLogicalPath(path: string): string | null {
    if (path === "/") {
        return null;
    }
    const idx = path.lastIndexOf("/");
    if (idx <= 0) {
        return "/";
    }
    return path.slice(0, idx);
}

/** `childPath` 是否为 `dirPath` 的直子路径。 */
export function isDirectChild(dirPath: string, childPath: string): boolean {
    return parentLogicalPath(childPath) === dirPath;
}

/** Row visible when every ancestor directory is expanded. */
export function isTreeRowVisible( path: string, expandedDirs: ReadonlySet<string> ): boolean {
    let current = parentLogicalPath(path);
    while (current !== null) {
        if (!expandedDirs.has(current)) {
            return false;
        }
        current = parentLogicalPath(current);
    }
    return true;
}

export function entryName(path: string): string {
    if (path === "/") {
        return "/";
    }
    const idx = path.lastIndexOf("/");
    return path.slice(idx + 1);
}

export function pathDepth(path: string): number {
    if (path === "/") {
        return 0;
    }
    return path.split("/").filter(Boolean).length;
}

export function vfsEntryStatusText(row: WorkplaceListRowDto): string {
    if (row.kind === "dir") {
        return ruleStateLabel(row.ruleState);
    }
    return `${inclusionModeLabel(row.inclusionMode)} · ${displayStateLabel(row.displayState)}`;
}
