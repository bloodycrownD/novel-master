/**
 * 规则快照编解码：DisplayState ↔ session kkv `rule_snapshot` 条目（不含 hidden）。
 *
 * @module domain/workplace/logic/rule-snapshot-codec
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { WorkplaceRuleView } from "../model/workplace-rule-view.js";
import type { WorkplaceDisplayStatus } from "@/domain/session-kkv/model/session-kkv-domains.js";

/** `rule_snapshot` / `canon` 单条条目。 */
export type RuleSnapshotEntry = {
  readonly path: string;
  readonly status: WorkplaceDisplayStatus;
};

/** 本模块的领域失败：快照或文件缓存载荷非法（本模块不抛，调用方按 `if (!r.ok)` 降级）。 */
type RuleSnapshotCodecError = AppError<"WORKPLACE_INVALID_RULE_SNAPSHOT" | "WORKPLACE_INVALID_FILE_CACHE">;

const DISPLAY_STATUSES = new Set<string>(["full", "header", "filename"]);

/**
 * 将规则视图转为快照条目（DFS 文件行顺序；过滤 hidden）。
 */
export function ruleViewToSnapshotEntries(view: WorkplaceRuleView): RuleSnapshotEntry[] {
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
}

/**
 * 序列化规则快照为 JSON 字符串。
 */
export function serializeRuleSnapshot(entries: readonly RuleSnapshotEntry[]): string {
  return JSON.stringify(entries);
}

/**
 * 解析规则快照 JSON；非法结构返回 `Err`（key `WORKPLACE_INVALID_RULE_SNAPSHOT`）。
 */
export function parseRuleSnapshotJson(raw: string): Result<RuleSnapshotEntry[], RuleSnapshotCodecError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", "rule snapshot is not valid json", { cause }));
  }
  if (!Array.isArray(parsed)) {
    return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", "rule snapshot must be a json array"));
  }
  const entries: RuleSnapshotEntry[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") {
      return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", "rule snapshot entry must be an object"));
    }
    const path = (item as { path?: unknown }).path;
    const status = (item as { status?: unknown }).status;
    if (typeof path !== "string" || path.length === 0 || typeof status !== "string" || !DISPLAY_STATUSES.has(status)) {
      return Result.err(new AppError("WORKPLACE_INVALID_RULE_SNAPSHOT", "rule snapshot entry needs a non-empty path and a known display status"));
    }
    entries.push({ path, status: status as WorkplaceDisplayStatus });
  }
  return Result.ok(entries);
}

/** `file_cache` 值：`{ body, mtimeMs }`。 */
export type FileCachePayload = {
  readonly body: string;
  readonly mtimeMs: number;
};

/**
 * 序列化文件缓存载荷。
 */
export function serializeFileCachePayload(payload: FileCachePayload): string {
  return JSON.stringify(payload);
}

/**
 * 解析文件缓存 JSON；非法结构返回 `Err`（key `WORKPLACE_INVALID_FILE_CACHE`）。
 */
export function parseFileCachePayload(raw: string): Result<FileCachePayload, RuleSnapshotCodecError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return Result.err(new AppError("WORKPLACE_INVALID_FILE_CACHE", "file cache payload is not valid json", { cause }));
  }
  if (parsed == null || typeof parsed !== "object") {
    return Result.err(new AppError("WORKPLACE_INVALID_FILE_CACHE", "file cache payload must be an object"));
  }
  const body = (parsed as { body?: unknown }).body;
  const mtimeMs = (parsed as { mtimeMs?: unknown }).mtimeMs;
  if (typeof body !== "string" || typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
    return Result.err(new AppError("WORKPLACE_INVALID_FILE_CACHE", "file cache payload must be { body: string, mtimeMs: finite number }"));
  }
  return Result.ok({ body, mtimeMs });
}
