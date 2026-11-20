/**
 * Composer `@路径` 插入与 typeahead 候选（与 scan / seen 规范化同形）。
 * 不含 Mobile mention / controlled-mentions 专属逻辑。
 *
 * @module domain/chat/logic/composer/composer-at-path
 */

import {promptPathSeen} from "../attachment/prompt-path-seen.js";
import {AppError} from "@/errors/app-error.js";
import {Result} from "@/errors/either.js";

export type AtPathRef = {
    readonly path: string;
    readonly kind: "file" | "dir";
};

/** Composer 文本/光标操作命名空间（无实例状态）。 */
export const composerAtPath = {
    /** 插入正文的 `@path`（目录带尾 `/`，落库扫描后带前导 `/`）。 */
    formatToken(path: string, isDir: boolean): Result<string, AppError> {
        if (isDir) {
            const withSlash = path.endsWith("/") || path === "/" ? path : `${path}/`;
            const store = promptPathSeen.normalizeStore(withSlash, {keepDirTrailingSlash: true});
            if (!store.ok) return store;
            return Result.ok(`@${store.value}`);
        }
        const store = promptPathSeen.normalizeStore(path);
        if (!store.ok) return store;
        return Result.ok(`@${store.value}`);
    },

    /** 选择器多选 → 正文 token 列表（先 dir 后 file）。 */
    tokensFromPickerSelection(selectedDirs: Iterable<string>, selectedFiles: Iterable<string>): Result<string[], AppError> {
        const tokens: string[] = [];
        for (const dir of selectedDirs) {
            const token = this.formatToken(dir, true);
            if (!token.ok) return Result.err(token.error);
            tokens.push(token.value);
        }
        for (const file of selectedFiles) {
            const token = this.formatToken(file, false);
            if (!token.ok) return Result.err(token.error);
            tokens.push(token.value);
        }
        return Result.ok(tokens);
    },

    /** 光标处未完成的 `@…` / `$…` 查询；无活跃 token 时返回 null。 */
    detectQuery(text: string, cursor: number, trigger: "@" | "$" = "@"): {
        readonly start: number;
        readonly query: string
    } | null {
        const safeCursor = Math.max(0, Math.min(cursor, text.length));
        const before = text.slice(0, safeCursor);
        const at = before.lastIndexOf(trigger);
        if (at < 0) {
            return null;
        }
        if (at > 0) {
            const prev = before[at - 1]!;
            if (prev !== " " && prev !== "\n" && prev !== "\t") {
                return null;
            }
        }
        const query = before.slice(at + 1);
        if (query.includes(" ") || query.includes("\n") || query.includes("\t")) {
            return null;
        }
        return {start: at, query};
    },

    /** 用完整 token 替换 `[start, cursor)`，并在末尾补空格（若尚无）。 */
    replaceToken(text: string, cursor: number, start: number, token: string): {
        readonly text: string;
        readonly cursor: number
    } {
        const before = text.slice(0, start);
        const after = text.slice(cursor);
        const needsSpace = after.length === 0 || !/^\s/.test(after);
        const inserted = needsSpace ? `${token} ` : token;
        const next = `${before}${inserted}${after}`;
        return {text: next, cursor: before.length + inserted.length};
    },
};
