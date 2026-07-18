/**
 * 常驻工作区执行引擎：按 session kkv 规则快照 + 文件缓存拼装前缀。
 *
 * @module service/workplace/assemble-workplace-display
 */

import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import {
  fileCacheKey,
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  joinFileBlocks,
  renderFileBlock,
} from "@/domain/worktree/logic/worktree-display.js";
import {
  parseFileCachePayload,
  parseRuleSnapshotJson,
  ruleViewToSnapshotEntries,
  serializeFileCachePayload,
  serializeRuleSnapshot,
  type RuleSnapshotEntry,
} from "@/domain/worktree/logic/rule-snapshot-codec.js";
import { normalizePromptSeenPath } from "@/domain/chat/logic/prompt-path-seen.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";

/** {@link assembleWorkplaceDisplay} 依赖。 */
export interface AssembleWorkplaceDisplayDeps {
  readonly sessionKkv: SessionKkvService;
  readonly worktree: WorktreeService;
  readonly vfs: VfsService;
  /** Agent layout；无 `type:"worktree"` 块则短路返回空且不写 kkv。 */
  readonly layout: Pick<AgentPromptLayout, "persist">;
}

/** {@link assembleWorkplaceDisplay} 返回值。 */
export interface AssembleWorkplaceDisplayResult {
  /** 常驻前缀展示文本（给模型看的 worktree 块）。 */
  readonly worktreeDisplay: string;
  /**
   * S0：规则快照全部可见 path（filename/header/full），已规范化为 seen key。
   * 无 worktree 块或快照为空时为 `[]`。
   */
  readonly prefixPaths: string[];
}

/**
 * 布局是否含常驻工作区（worktree）块。
 */
export function layoutHasWorktreeBlock(
  layout: Pick<AgentPromptLayout, "persist">,
): boolean {
  return layout.persist.some((block) => block.type === "worktree");
}

/**
 * 拼装常驻工作区前缀文本（替代进程内 capture），并收集前缀 path 集合 S0。
 *
 * 1. 无 worktree 块 → `{ worktreeDisplay: "", prefixPaths: [] }`，不触 kkv
 * 2. 读 `rule_snapshot`/`canon`；空 → 规则引擎 → 写快照
 * 3. 按 path/status 读 `file_cache`；miss → VFS → 写缓存
 * 4. `renderFileBlock` + `joinFileBlocks`；`prefixPaths` = 快照全部可见 path（规范化）
 */
export async function assembleWorkplaceDisplay(
  scope: Extract<VfsScope, { kind: "session" }>,
  deps: AssembleWorkplaceDisplayDeps,
): Promise<AssembleWorkplaceDisplayResult> {
  if (!layoutHasWorktreeBlock(deps.layout)) {
    return { worktreeDisplay: "", prefixPaths: [] };
  }

  const sessionId = scope.sessionId;
  const entries = await loadOrCreateRuleSnapshot(sessionId, deps);
  if (entries.length === 0) {
    return { worktreeDisplay: "", prefixPaths: [] };
  }

  const prefixPaths: string[] = [];
  const blocks: string[] = [];
  for (const entry of entries) {
    prefixPaths.push(normalizePromptSeenPath(entry.path));
    const cached = await loadOrFillFileCache(sessionId, entry, deps);
    blocks.push(
      renderFileBlock({
        logicalPath: entry.path,
        mtimeMs: cached.mtimeMs,
        display: entry.status,
        content: cached.body,
      }),
    );
  }
  return {
    worktreeDisplay: joinFileBlocks(blocks),
    prefixPaths,
  };
}

async function loadOrCreateRuleSnapshot(
  sessionId: string,
  deps: AssembleWorkplaceDisplayDeps,
): Promise<RuleSnapshotEntry[]> {
  const raw = await deps.sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY,
  );
  if (raw != null && raw !== "") {
    const parsed = parseRuleSnapshotJson(raw);
    // 空数组视为未就绪：避免首次空快照粘住后工作区永久消失
    if (parsed != null && parsed.length > 0) {
      return parsed;
    }
  }

  const view = await deps.worktree.evaluateRuleView();
  const entries = ruleViewToSnapshotEntries(view);
  await deps.sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY,
    serializeRuleSnapshot(entries),
  );
  return entries;
}

async function loadOrFillFileCache(
  sessionId: string,
  entry: RuleSnapshotEntry,
  deps: AssembleWorkplaceDisplayDeps,
): Promise<{ body: string; mtimeMs: number }> {
  const key = fileCacheKey(entry.status, entry.path);
  const raw = await deps.sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
  );
  if (raw != null) {
    const parsed = parseFileCachePayload(raw);
    if (parsed != null) {
      return parsed;
    }
  }

  const filled = await readWorkplaceFile(entry, deps.vfs);
  await deps.sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
    serializeFileCachePayload(filled),
  );
  return filled;
}

/**
 * 按展示档位从 VFS 取正文；filename 不读盘；缺失用占位正文（不强制改已有 cache）。
 */
async function readWorkplaceFile(
  entry: RuleSnapshotEntry,
  vfs: VfsService,
): Promise<{ body: string; mtimeMs: number }> {
  const status: WorkplaceDisplayStatus = entry.status;
  if (status === "filename") {
    return { body: "", mtimeMs: 0 };
  }
  try {
    const result = await vfs.read(entry.path);
    return { body: result.content, mtimeMs: result.mtimeMs };
  } catch {
    return { body: "(missing)", mtimeMs: 0 };
  }
}
