/**
 * 路径字符串纯原语（逻辑路径以 `/` 分隔；`hasPrefix` 额外兼容 `\`）。
 *
 * 只做字符串变换，不认识任何业务实体；域内的路径策略 / 诊断阈值留在各域。
 *
 * @module common/path
 */

export const Path = {
    /** 末段名：忽略尾部斜杠；root `/` → `/`；无斜杠的裸名原样返回。 */
    basename: (path: string): string => {
        if (path === "/") {
            return "/";
        }
        const trimmed = path.replace(/\/+$/, "");
        const idx = trimmed.lastIndexOf("/");
        return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
    },

    /** 去掉尾斜杠（root `/` 保留；最多去掉一个）。 */
    stripTrailingSlash: (prefix: string): string => (prefix === "/" || !prefix.endsWith("/") ? prefix : prefix.slice(0, -1)),

    /** 把 `oldDir` 下的路径改挂到 `newDir` 下同一相对位置；不在其下原样返回。 */
    remapUnderDir: (path: string, oldDir: string, newDir: string): string => {
        const normalizedOld = Path.stripTrailingSlash(oldDir);
        const normalizedNew = Path.stripTrailingSlash(newDir);
        if (path === normalizedOld) {
            return normalizedNew;
        }
        const prefix = `${normalizedOld}/`;
        return path.startsWith(prefix) ? `${normalizedNew}${path.slice(normalizedOld.length)}` : path;
    },

    /** 路径是否落在 `prefix` 之下（空前缀 / `/` / `\` 恒真；自动忽略尾斜杠，兼容两种分隔符）。 */
    hasPrefix: (path: string, prefix: string): boolean => {
        if (prefix === "" || prefix === "/" || prefix === "\\") {
            return true;
        }
        const normalizedPrefix = prefix.endsWith("/") || prefix.endsWith("\\") ? prefix.slice(0, -1) : prefix;
        return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`) || path.startsWith(`${normalizedPrefix}\\`);
    },

    /** 规范化路径前缀：trim 后非空则确保以 `/` 结尾（空串原样返回空串）。 */
    ensureTrailingSlash: (prefix: string): string => {
        const trimmed = prefix.trim();
        if (trimmed.length === 0) {
            return "";
        }
        return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    },
} as const;
