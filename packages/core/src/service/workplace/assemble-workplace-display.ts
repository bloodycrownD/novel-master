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
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  fileCacheKey,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { fillFileCacheFromVfs } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import { parseFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
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
 * 常驻前缀唯一包裹出口：非空 display 外包一层 `<workplace>`（空串不包）。
 * 禁止在 renderFileBlock / joinFileBlocks / synthetic 路径再次包裹。
 */
function wrapWorkplaceDisplay(display: string): string {
  if (display === "") {
    return "";
  }
  return `<workplace>\n${display}\n</workplace>`;
}

/** {@link assembleWorkplaceDisplay} 可选参数。 */
export interface AssembleWorkplaceDisplayOptions {
  /**
   * rule_snapshot / file_cache 的 KKV 归属 session id；缺省用 `scope.sessionId`。
   *
   * 子 agent 场景传子 session 自身 id（快照隔离）：规则评估按 scope（父工作区）
   * 进行，但快照与缓存写进子 session 自己的 KKV。
   */
  readonly kkvSessionId?: string;
}

/**
 * 拼装常驻工作区前缀文本（替代进程内 capture），并收集前缀 path 集合 S0。
 *
 * 1. 无 workplace 块 → `{ workplaceDisplay: "", prefixPaths: [] }`，不触 kkv
 * 2. 读 `rule_snapshot`/`canon`（按 `options.kkvSessionId` 路由）；空 → 规则引擎（按
 *    scope 评估）→ 写快照（写回 kkvSessionId）
 * 3. 按 path/status 读 `file_cache`（kkvSessionId）；miss → VFS（scope 视图）→ 内容直接
 *    用于组装，压缩+落库后台 fire-and-forget（不挡读者，见 load-or-fill-file-cache）
 * 4. `renderFileBlock` + `joinFileBlocks`；返回前包 `<workplace>`；`prefixPaths` = 快照全部可见 path（规范化）
 */
export async function assembleWorkplaceDisplay(
  scope: Extract<VfsScope, { kind: "session" }>,
  deps: AssembleWorkplaceDisplayDeps,
  options?: AssembleWorkplaceDisplayOptions
): Promise<AssembleWorkplaceDisplayResult> {
  if (!layoutHasWorkplace(deps.layout)) {
    return { workplaceDisplay: "", prefixPaths: [] };
  }

  const kkvSessionId = options?.kkvSessionId ?? scope.sessionId;
  const entries = await loadOrCreateRuleSnapshot(kkvSessionId, deps);
  if (entries.length === 0) {
    return { workplaceDisplay: "", prefixPaths: [] };
  }

  // 批量预取 file_cache：两条 IN 查询（entries + blobs）替代每文件两跳
  // 串行 SQL——大会话几十个规则文件的读链曾是 workplace 组装的主要成本
  // （单连接串行执行下，并发救不了，只能减查询数）。
  const cacheKeys = entries.map((entry) => fileCacheKey(entry.status, entry.path));
  const prefetched = await deps.sessionKkv.getMany(
    kkvSessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    cacheKeys
  );

  const prefixPaths: string[] = [];
  const blocks: string[] = [];
  for (const entry of entries) {
    prefixPaths.push(normalizePromptSeenPath(entry.path));
    const raw = prefetched.get(fileCacheKey(entry.status, entry.path));
    const cached = raw != null ? parseFileCachePayload(raw) : null;
    const payload =
      cached ??
      (await fillFileCacheFromVfs(
        {
          sessionId: kkvSessionId,
          sessionKkv: deps.sessionKkv,
          vfs: deps.vfs,
          path: entry.path,
          status: entry.status,
        },
        // 冷 miss 后先服务于读者：正文已读到即用于组装，压缩+落库交给
        // 后台 fire-and-forget（推迟一个宏任务，不跟同轮读链抢 JS 线程）。
        // file_cache 只是加速层，丢了下次再回填。
        { deferBackfillWrite: true }
      ));
    blocks.push(
      renderFileBlock({
        logicalPath: entry.path,
        mtimeMs: payload.mtimeMs,
        display: entry.status,
        content: payload.body,
      })
    );
  }
  return {
    workplaceDisplay: wrapWorkplaceDisplay(joinFileBlocks(blocks)),
    prefixPaths,
  };
}

async function loadOrCreateRuleSnapshot(
  sessionId: string,
  deps: AssembleWorkplaceDisplayDeps
): Promise<RuleSnapshotEntry[]> {
  const raw = await deps.sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY
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
    serializeRuleSnapshot(entries)
  );
  return entries;
}
