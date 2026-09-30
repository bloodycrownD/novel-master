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
  /**
   * 本次组装内容的**廉价指纹**（`path|status|mtimeMs|bodyLength` 列表 join，
   * 2026-09-30）：组装是最贵的读链（冷 5~16s、暖几百 ms 全在 inflate/读盘），
   * 但「同样这批文件、同样 mtime、同样正文体量」的组装产物必然逐字节相同——
   * 下游（chip 估算读数的记忆缓存）用这个指纹免掉对产物串本身的哈希/序列化。
   *
   * 指纹只覆盖文件身份、mtime 与正文字符数，**不哈希正文**：mtime 前进必变，
   * `bodyLength` 段再加一道——树复制（vfs-tree-copy）保留源 mtime、写侧只有
   * 毫秒精度，「mtime 同、正文异」的路径确实存在（r4-core-4），长度不同的
   * 改写在指纹上照样可辨。长度与 mtime 双双相同的同长改写仍在覆盖外（下一
   * 次 mtime 前进或消息事件自愈，与消息尾戳同款取舍）。
   */
  readonly fingerprint: string;
}

/**
 * workplace 组装被中止（2026-09-30「停止要等 14 秒」实锤的治本点）。
 *
 * 背景：组装段曾是**无观察点的原子块**——回滚触发的 chip 组装与发送触发的
 * run 组装在单 SQLite 连接 + JS 线程上互相排队，叠加到 16 秒；期间用户连点
 * 17 次停止，abort 全部真派发了（0~1ms）却要等组装跑完才能兑现。「停止必须
 * 从受理即可停」这条 RULE 在组装内部同样成立：按文件粒度检查
 * {@link AssembleWorkplaceDisplayOptions.shouldStop}，命中即抛本错误。
 *
 * 两个消费族的收口方式：
 * - **run 侧**（agent-runner）：`shouldStop = () => signal.aborted`，错误沿
 *   既有 catch 冒泡——`signal?.aborted` 为真即路由进统一 abort 处理
 *   （`handleAbort("catch_abort")`），无需专门 catch；
 * - **chip 侧**（mobile/desktop 的 build）：`shouldStop` 接 build 的分段弃权
 *   判据，build 里 catch 本错误并转抛各自的 bail 哨兵类（空串/null 语义）。
 */
export class WorkplaceAssemblyAbortedError extends Error {
  constructor() {
    super("workplace assembly aborted (stop requested mid-files)");
    this.name = "WorkplaceAssemblyAbortedError";
  }
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
  /**
   * 按文件粒度的中止判据（2026-09-30）：真值即抛
   * {@link WorkplaceAssemblyAbortedError}。检查点在快照加载后 + 每个文件的
   * 缓存解析/VFS 回填之前——单个大文件的读取本身仍是原子单元（可接受：
   * 粒度从「整个组装 16s」细化到「单个文件」）。缺省不检查。
   */
  readonly shouldStop?: () => boolean;
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
    return { workplaceDisplay: "", prefixPaths: [], fingerprint: "" };
  }

  const kkvSessionId = options?.kkvSessionId ?? scope.sessionId;
  const entries = await loadOrCreateRuleSnapshot(kkvSessionId, deps);
  if (entries.length === 0) {
    return { workplaceDisplay: "", prefixPaths: [], fingerprint: "" };
  }
  // 快照加载是组装的第一段 IO（可能触发规则评估），加载完先看一眼再进
  // 文件循环——批量预取那条 IN 查询之后全是逐文件重活。
  if (options?.shouldStop?.() === true) {
    throw new WorkplaceAssemblyAbortedError();
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
  const fingerprintParts: string[] = [];
  for (const entry of entries) {
    // 按文件粒度的中止观察点（见 AssembleWorkplaceDisplayOptions.shouldStop）
    // ——2026-09-30 实锤：16s 原子组装段里 17 次停止点按全部真派发却无从
    // 兑现。单文件的「缓存解析 + VFS 回填」仍是本轮的最小原子单元。
    if (options?.shouldStop?.() === true) {
      throw new WorkplaceAssemblyAbortedError();
    }
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
    // 末段 bodyLength（r4-core-4）：mtime 是毫秒精度且树复制会保留源 mtime，
    // 「mtime 同、正文异」会让指纹假同 → 下游记忆/指纹估读返回陈旧值。
    // 体量是零成本字段（payload 已在手），长度异即指纹异。
    fingerprintParts.push(
      `${entry.path}|${entry.status}|${payload.mtimeMs}|${payload.body.length}`
    );
  }
  return {
    workplaceDisplay: wrapWorkplaceDisplay(joinFileBlocks(blocks)),
    prefixPaths,
    // 指纹在循环里逐文件拼：entry 顺序即快照序（稳定），mtimeMs / 正文长度
    // 来自缓存/回填载荷。指纹串长度 ≈ path 数 × 几十字节，远小于哈希正文串
    // 本身。
    fingerprint: fingerprintParts.join(";"),
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
