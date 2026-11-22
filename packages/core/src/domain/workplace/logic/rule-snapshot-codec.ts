/**
 * 规则快照 / 文件缓存编解码：DisplayState ↔ session kkv `rule_snapshot` 条目（不含 hidden），
 * 以及 `file_cache` 域的键与载荷 wire 契约。
 *
 * @module domain/workplace/logic/rule-snapshot-codec
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { WorkplaceRuleView } from "../model/workplace-rule-view.js";
import type { DisplayState } from "../model/workplace-types.js";

/** `rule_snapshot` / `canon` 单条条目。 */
export type RuleSnapshotEntry = {
    readonly path: string;
    readonly status: WorkplaceDisplayStatus;
};

/** 本模块的领域失败：快照或文件缓存载荷非法（本模块不抛，调用方按 `if (!r.ok)` 降级）。 */
type RuleSnapshotCodecError = AppError<"WORKPLACE_INVALID_RULE_SNAPSHOT" | "WORKPLACE_INVALID_FILE_CACHE">;

/** `file_cache` 值：`{ body, mtimeMs }`。 */
export type FileCachePayload = {
    readonly body: string;
    readonly mtimeMs: number;
};

/** 可写入 file_cache 的展示档位（不含 hidden）。 */
export type WorkplaceDisplayStatus = Exclude<DisplayState, "hidden">;

const DISPLAY_STATUSES = new Set<string>(["full", "header", "filename"]);

export const RuleSnapshotCodec = {
    /**
   * 将规则视图转为快照条目（DFS 文件行顺序；过滤 hidden）。
   */
    ruleViewToEntries(view: WorkplaceRuleView): RuleSnapshotEntry[] {
        const entries: RuleSnapshotEntry[] = [];
        for (const row of view.rows) {
            if (row.kind !== "file") {
                continue;
            }
            const display = view.displayByPath.get(row.path) ?? row.displayState;
            if (display === "hidden") {
                continue;
            }
            entries.push({ path: row.path, status: display });
        }
        return entries;
    },

    /**
   * 序列化规则快照为 JSON 字符串。
   *
   * nm-style: keep-public — 两处 service 写入点 + `public/workplace.ts` 导出共用；
   * 内联需改 service 与 public barrel（本轮只改 domain 范围）。
   */
    serialize(entries: readonly RuleSnapshotEntry[]): string {
        return JSON.stringify(entries);
    },

    /**
   * 解析规则快照 JSON；非法结构返回 `Err`（key `WORKPLACE_INVALID_RULE_SNAPSHOT`）。
   */
    parseJson(raw: string): Result<RuleSnapshotEntry[], RuleSnapshotCodecError> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (cause) {
            return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", { detail: "rule snapshot is not valid json", ...{ cause } }));
        }
        if (!Array.isArray(parsed)) {
            return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", { detail: "rule snapshot must be a json array" }));
        }
        const entries: RuleSnapshotEntry[] = [];
        for (const item of parsed) {
            if (item == null || typeof item !== "object") {
                return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", { detail: "rule snapshot entry must be an object" }));
            }
            const path = (item as { path?: unknown }).path;
            const status = (item as { status?: unknown }).status;
            if (typeof path !== "string" || path.length === 0 || typeof status !== "string" || !DISPLAY_STATUSES.has(status)) {
                return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", { detail: "rule snapshot entry needs a non-empty path and a known display status" }));
            }
            entries.push({ path, status: status as WorkplaceDisplayStatus });
        }
        return Result.ok(entries);
    },

    /**
   * 生成 file_cache 键：`{status}:{path}`，如 `full:/a.md`。
   *
   * 与 {@link RuleSnapshotCodec.serializeFileCachePayload} / {@link RuleSnapshotCodec.parseFileCachePayload} 同属
   * file_cache 域的 wire 契约：写出方与读出方共用本函数，键序不会漂移。
   */
    fileCacheKey(status: WorkplaceDisplayStatus, path: string): string {
        return `${status}:${path}`;
    },

    /**
   * 序列化文件缓存载荷。
   *
   * nm-style: keep-local — FileCachePayload 的 wire 形状契约：6 处写入点共用同一
   * 键序（session-kkv repo ×3、vfs-tools、load-or-fill、parse 对偶），内联会把
   * 持久化 JSON 形状摊回各调用点。
   */
    serializeFileCachePayload(payload: FileCachePayload): string {
        return JSON.stringify(payload);
    },

    /**
   * 解析文件缓存 JSON；非法结构返回 `Err`（key `WORKPLACE_INVALID_FILE_CACHE`）。
   */
    parseFileCachePayload(raw: string): Result<FileCachePayload, RuleSnapshotCodecError> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (cause) {
            return Result.err(new AppError("WORKPLACE_INVALID_FILE_CACHE", { detail: "file cache payload is not valid json", ...{ cause } }));
        }
        if (parsed == null || typeof parsed !== "object") {
            return Result.err(new AppError("WORKPLACE_INVALID_FILE_CACHE", { detail: "file cache payload must be an object" }));
        }
        const body = (parsed as { body?: unknown }).body;
        const mtimeMs = (parsed as { mtimeMs?: unknown }).mtimeMs;
        if (typeof body !== "string" || typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
            return Result.err(new AppError("WORKPLACE_INVALID_FILE_CACHE", { detail: "file cache payload must be { body: string, mtimeMs: finite number }" }));
        }
        return Result.ok({ body, mtimeMs });
    },
} as const;
