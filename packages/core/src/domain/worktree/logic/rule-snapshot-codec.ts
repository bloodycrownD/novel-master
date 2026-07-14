/**
 * 规则快照编解码：DisplayState ↔ session kkv `rule_snapshot` 条目（不含 hidden）。
 *
 * @module domain/worktree/logic/rule-snapshot-codec
 */

import type { WorktreeRuleView } from "../model/worktree-rule-view.js";
import type { WorkplaceDisplayStatus } from "@/domain/session-kkv/model/session-kkv-domains.js";

/** `rule_snapshot` / `canon` 单条条目。 */
export type RuleSnapshotEntry = {
  readonly path: string;
  readonly status: WorkplaceDisplayStatus;
};

const DISPLAY_STATUSES = new Set<string>(["full", "header", "filename"]);

/**
 * 将规则视图转为快照条目（DFS 文件行顺序；过滤 hidden）。
 */
export function ruleViewToSnapshotEntries(
  view: WorktreeRuleView,
): RuleSnapshotEntry[] {
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
export function serializeRuleSnapshot(
  entries: readonly RuleSnapshotEntry[],
): string {
  return JSON.stringify(entries);
}

/**
 * 解析规则快照 JSON；非法结构返回 `null`。
 */
export function parseRuleSnapshotJson(
  raw: string,
): RuleSnapshotEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const entries: RuleSnapshotEntry[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") {
      return null;
    }
    const path = (item as { path?: unknown }).path;
    const status = (item as { status?: unknown }).status;
    if (typeof path !== "string" || path.length === 0) {
      return null;
    }
    if (typeof status !== "string" || !DISPLAY_STATUSES.has(status)) {
      return null;
    }
    entries.push({
      path,
      status: status as WorkplaceDisplayStatus,
    });
  }
  return entries;
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
 * 解析文件缓存 JSON；非法结构返回 `null`。
 */
export function parseFileCachePayload(
  raw: string,
): FileCachePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") {
    return null;
  }
  const body = (parsed as { body?: unknown }).body;
  const mtimeMs = (parsed as { mtimeMs?: unknown }).mtimeMs;
  if (typeof body !== "string") {
    return null;
  }
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
    return null;
  }
  return { body, mtimeMs };
}
