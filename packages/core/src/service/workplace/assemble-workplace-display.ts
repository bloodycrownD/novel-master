/**
 * 常驻工作区执行引擎：按 session kkv 规则快照 + 文件缓存拼装前缀。
 *
 * @module service/workplace/assemble-workplace-display
 */

import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import { layoutHasWorkplace } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { loadOrFillFileCache } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import {
  joinFileBlocks,
  renderFileBlock,
} from "@/domain/workplace/logic/workplace-display.js";
import {
  parseRuleSnapshotJson,
  ruleViewToSnapshotEntries,
  serializeRuleSnapshot,
  type RuleSnapshotEntry,
} from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { normalizePromptSeenPath } from "@/domain/chat/logic/prompt-path-seen.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

export { layoutHasWorkplace };

/** {@link assembleWorkplaceDisplay} 依赖。 */
export interface AssembleWorkplaceDisplayDeps {
  readonly sessionKkv: SessionKkvService;
  readonly workplace: WorkplaceService;
  readonly vfs: VfsService;
/** Agent layout；`workplace` 未开则短路返回空且不写 kkv。 */
  readonly layout: Pick<AgentPromptLayout, "workplace">;
}

/** {@link assembleWorkplaceDisplay} 返回值。 */
export interface AssembleWorkplaceDisplayResult {
  /** 常驻前缀展示文本（给模型看的 workplace 块）。 */
  readonly workplaceDisplay: string;
  /**
   * S0：规则快照全部可见 path（filename/header/full），已规范化为 seen key。
   * 无 workplace 块或快照为空时为 `[]`。
   */
  readonly prefixPaths: string[];
}

/**
 * 拼装常驻工作区前缀文本（替代进程内 capture），并收集前缀 path 集合 S0。
 *
 * 1. 无 workplace 块 → `{ workplaceDisplay: "", prefixPaths: [] }`，不触 kkv
 * 2. 读 `rule_snapshot`/`canon`；空 → 规则引擎 → 写快照
 * 3. 按 path/status 读 `file_cache`；miss → VFS → 写缓存
 * 4. `renderFileBlock` + `joinFileBlocks`；`prefixPaths` = 快照全部可见 path（规范化）
 */
export async function assembleWorkplaceDisplay(
  scope: Extract<VfsScope, { kind: "session" }>,
  deps: AssembleWorkplaceDisplayDeps,
): Promise<AssembleWorkplaceDisplayResult> {
  if (!layoutHasWorkplace(deps.layout)) {
    return { workplaceDisplay: "", prefixPaths: [] };
  }

  const sessionId = scope.sessionId;
  const entries = await loadOrCreateRuleSnapshot(sessionId, deps);
  if (entries.length === 0) {
    return { workplaceDisplay: "", prefixPaths: [] };
  }

  const prefixPaths: string[] = [];
  const blocks: string[] = [];
  for (const entry of entries) {
    prefixPaths.push(normalizePromptSeenPath(entry.path));
    const cached = await loadOrFillFileCache({
      sessionId,
      sessionKkv: deps.sessionKkv,
      vfs: deps.vfs,
      path: entry.path,
      status: entry.status,
    });
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
    workplaceDisplay: joinFileBlocks(blocks),
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

  const view = await deps.workplace.evaluateRuleView();
  const entries = ruleViewToSnapshotEntries(view);
  await deps.sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY,
    serializeRuleSnapshot(entries),
  );
  return entries;
}
