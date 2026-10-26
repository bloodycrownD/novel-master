/**
 * 提示词路径「已出现」集合：规范化与短提示工具。
 *
 * @module domain/chat/logic/attachment/prompt-path-seen
 */

import {resolveLogicalPath} from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 提示词 seen 路径命名空间（无实例状态）。 */
export const promptPathSeen = {
    /** 目录 token：规范化前看尾部 `/` 或 `\`。 */
    isDirToken(path: string): boolean {
        const trimmed = path.trim();
        return trimmed.endsWith("/") || trimmed.endsWith("\\");
    },

    /** 落库 / 短提示 XML 用 path：一律带前导 `/`；目录可选保留尾 `/`。 */
    normalizeStore(path: string, options?: { readonly keepDirTrailingSlash?: boolean }): string {
        const keepSlash = options?.keepDirTrailingSlash === true;
        const isDir = this.isDirToken(path);
        const seen = resolveLogicalPath(path);
        if (keepSlash && isDir && seen !== "/") {
            return `${seen}/`;
        }
        return seen;
    },

    /** 尝试规范化；非法 path 返回 `null`（不抛）。 */
    tryNormalize(path: string): string | null {
        if (path.trim() === "") {
            return null;
        }
        try {
            return resolveLogicalPath(path);
        } catch {
            return null;
        }
    },

    /** 由初始前缀 path 列表构造可变 seen 集合。 */
    createSet(initialPaths?: readonly string[]): Set<string> {
        const set = new Set<string>();
        if (initialPaths == null) {
            return set;
        }
        for (const path of initialPaths) {
            const key = this.tryNormalize(path);
            if (key != null) {
                set.add(key);
            }
        }
        return set;
    },
};
