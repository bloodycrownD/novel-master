/**
 * 规则 live 视图 vs file_cache keys → 尚未加载的 workplace paths。
 *
 * 命中口径：同 path 在 cache 中任一 `full:` / `header:` / `filename:` key
 * 即视为已加载（含 attach hydrate 已写 keys）；不因 status 不同再推草稿。
 *
 * @module domain/worktree/logic/diff-workplace-paths
 */

import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import {
  fileCacheKey,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";

/** live 条目：至少含 path；status 不参与「已加载」判定。 */
export type WorkplaceLivePath = {
  readonly path: string;
  readonly status?: WorkplaceDisplayStatus | string;
};

const LOADED_STATUSES: readonly WorkplaceDisplayStatus[] = [
  "full",
  "header",
  "filename",
];

/**
 * 同 path 任一 status key 命中即视为已加载。
 */
export function isWorkplacePathLoadedInCache(
  path: string,
  cacheKeys: ReadonlySet<string>,
): boolean {
  for (const status of LOADED_STATUSES) {
    if (cacheKeys.has(fileCacheKey(status, path))) {
      return true;
    }
  }
  return false;
}

/**
 * 计算尚需推送为 workplace 草稿的 path 列表（去重，保持 live 顺序）。
 */
export function diffWorkplacePaths(
  live: readonly WorkplaceLivePath[],
  cacheKeys: ReadonlySet<string> | readonly string[],
): string[] {
  const keySet =
    cacheKeys instanceof Set ? cacheKeys : new Set(cacheKeys);
  const needed: string[] = [];
  const seen = new Set<string>();
  for (const entry of live) {
    const path = entry.path;
    if (path.length === 0 || seen.has(path)) {
      continue;
    }
    seen.add(path);
    if (isWorkplacePathLoadedInCache(path, keySet)) {
      continue;
    }
    needed.push(path);
  }
  return needed;
}

/**
 * 差集 paths → Composer workplace 草稿附件（`content: null`，`type: "text"`）。
 */
export function workplaceAttachmentsFromNeededPaths(
  neededPaths: readonly string[],
): MessageAttachment[] {
  return neededPaths.map((path) => ({
    name: path,
    source: "workplace" as const,
    type: "text" as const,
    content: null,
    path,
    action: "workplaceChange" as const,
  }));
}

/**
 * live + cacheKeys → 待推送的 workplace `MessageAttachment[]`。
 */
export function workplaceAttachmentsFromRuleDelta(
  live: readonly WorkplaceLivePath[],
  cacheKeys: ReadonlySet<string> | readonly string[],
): MessageAttachment[] {
  return workplaceAttachmentsFromNeededPaths(
    diffWorkplacePaths(live, cacheKeys),
  );
}
