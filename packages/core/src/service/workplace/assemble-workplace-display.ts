/**
 * 常驻工作区执行引擎：按 session kkv 规则快照 + 文件缓存拼装前缀。
 *
 * @module service/workplace/assemble-workplace-display
 */

import { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { LongTaskHooks } from "@/domain/abort/model/abort-scope.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import { RULE_SNAPSHOT_CANON_KEY, SESSION_KKV_DOMAIN_FILE_CACHE, SESSION_KKV_DOMAIN_RULE_SNAPSHOT } from "@/domain/session-kkv/model/session-kkv-domains.js";
import { FileCache } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import { RuleSnapshotCodec, type WorkplaceDisplayStatus } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { WorkplaceDisplay } from "@/domain/workplace/logic/workplace-display.js";
import { type RuleSnapshotEntry } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { Outcome } from "@/errors/outcome.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

/** {@link assembleWorkplaceDisplay} 依赖。 */
// nm-style: keep-public — public/workplace.ts 门面再导出，导出函数签名类型；脚本不统计签名内类型引用。
export interface AssembleWorkplaceDisplayDeps {
  readonly sessionKkv: SessionKkvService;
  readonly workplace: WorkplaceService;
  readonly vfs: VfsService;
  /** Agent layout；`workplace` 未开则短路返回空且不写 kkv。 */
  readonly layout: Pick<AgentPromptLayout, "workplace">;
}

/** {@link assembleWorkplaceDisplay} 返回值。 */
// nm-style: keep-public — public/workplace.ts 门面再导出，导出函数签名类型；脚本不统计签名内类型引用。
export interface AssembleWorkplaceDisplayResult {
  /** 常驻前缀展示文本（给模型看的 workplace 块）。 */
  readonly workplaceDisplay: string;
  /**
   * 结构化文件清单（提示词预览的 workplace 二级卡数据源，2026-10-02）：
   * 逐文件 `path` + 展示档 + **块内正文**（`N|行` 行号格式，与
   * `renderFileBlock` 标签内同口径）——预览侧不再从展示串反解。
   * 无 workplace 块或快照为空时为 `[]`。
   */
  readonly files: readonly WorkplaceAssembledFile[];
  /**
   * S0（attach 去重 seen 初值）：**仅 `status === "full"`** 的规则可见 path，
   * 已规范化为 seen key。无 workplace 块或快照为空时为 `[]`。
   *
   * 收窄自 v1.5.29 的全量语义：`header` / `filename` 档并未加载全量正文，
   * 拿它们去吞 attach 会造成「文件其实没进上下文、附件却被判已引用」。故只有
   * 真正全文注入的条目才允许抑制后续 attach 的全文。
   */
  readonly prefixPaths: string[];
  /**
   * 规则快照**全部**可见 path（`full` / `header` / `filename`，规范化 seen key），
   * 即 v1.5.29 旧 `prefixPaths` 的语义。无 workplace 块或快照为空时为 `[]`。
   *
   * 喂 `prepareUserMessagesForPrompt` 的 `workplaceSeenPaths`：判定「本次历史里的
   * workplace 附件是否该省略」时，工作区前缀确实已经展示过这些路径（无论哪一档），
   * 所以这一侧保持全量语义，与 attach 侧的收窄互补而非二选一。
   */
  readonly visiblePaths: string[];
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

/** 组装产出的单文件结构（预览侧 workplace 二级卡数据源）。 */
interface WorkplaceAssembledFile {
  /** VFS 逻辑路径（规则快照条目原值）。 */
  readonly path: string;
  /** 展示档（`full` / `header` / `filename`，快照条目原值）。 */
  readonly display: WorkplaceDisplayStatus;
  /** 块内正文（`N|行` 行号格式；header 档为 front-matter 行）。 */
  readonly body: string;
}

/** {@link assembleWorkplaceDisplay} 可选参数（长任务中断观察点注入 `LongTaskHooks.checkpoint`）。 */
// nm-style: keep-public — public/workplace.ts 门面再导出，导出函数签名类型；脚本不统计签名内类型引用。
export interface AssembleWorkplaceDisplayOptions extends LongTaskHooks {
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
 * 1. 无 workplace 块 → `{ workplaceDisplay: "", prefixPaths: [], visiblePaths: [] }`，
 *    不触 kkv
 * 2. 读 `rule_snapshot`/`canon`（按 `options.kkvSessionId` 路由）；空 → 规则引擎（按
 *    scope 评估）→ 写快照（写回 kkvSessionId）
 * 3. 按 path/status 读 `file_cache`（kkvSessionId）；miss → VFS（scope 视图）→ 内容直接
 *    用于组装，压缩+落库后台 fire-and-forget（不挡读者，见 load-or-fill-file-cache）
 * 4. `renderFileBlock` + `joinFileBlocks`；返回前包 `<workplace>`；
 *    `visiblePaths` = 快照全部可见 path（规范化，全量语义）；
 *    `prefixPaths` = 其中 `status === "full"` 的子集（attach 去重 S0 入集口径）
 * 5. 错误通道迁移二期：`checkpoint` 命中 → `cancelled` / `replaced`（中断不
 *    伪装成错误）；`LogicalPath.resolve` 失败 → `failed`（决定权交上层）。
 *    其余失败仍沿 throw 冒泡（平台边界，适配层转码）。
  * 解包 throw 边界（错误通道迁移三期门⑦）：PathNormalizer.normalize 失败按迁移前形态上抛，由调用链端点 catch 收口。
 */
export async function assembleWorkplaceDisplay(scope: Extract<VfsScope, { kind: "session" }>, deps: AssembleWorkplaceDisplayDeps, options?: AssembleWorkplaceDisplayOptions): Promise<Outcome<AssembleWorkplaceDisplayResult>> {
  if (!AgentPromptLayout.hasWorkplace(deps.layout)) {
    return {
      kind: "completed",
      value: {
        workplaceDisplay: "",
        files: [],
        prefixPaths: [],
        visiblePaths: [],
        fingerprint: "",
      },
    };
  }

  const kkvSessionId = options?.kkvSessionId ?? scope.sessionId;
  // 快照读 rule_snapshot/canon；空或损坏 → 规则引擎重算并写回。
  const rawSnapshot = await deps.sessionKkv.get(kkvSessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY);
  const parsedSnapshot = rawSnapshot != null && rawSnapshot !== "" ? RuleSnapshotCodec.parseJson(rawSnapshot) : null;
  let entries: RuleSnapshotEntry[];
  // 空数组视为未就绪：避免首次空快照粘住后工作区永久消失
  if (parsedSnapshot?.ok === true && parsedSnapshot.value.length > 0) {
    entries = parsedSnapshot.value;
  } else {
    const evaluated = await deps.workplace.evaluateRuleView();
    if (!evaluated.ok) {
      return { kind: "failed", error: evaluated.error };
    }
    entries = RuleSnapshotCodec.ruleViewToEntries(evaluated.value);
    await deps.sessionKkv.set(kkvSessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, RuleSnapshotCodec.serialize(entries));
  }
  if (entries.length === 0) {
    return {
      kind: "completed",
      value: {
        workplaceDisplay: "",
        files: [],
        prefixPaths: [],
        visiblePaths: [],
        fingerprint: "",
      },
    };
  }
  // 快照加载是组装的第一段 IO（可能触发规则评估），加载完先看一眼再进
  // 文件循环——批量预取那条 IN 查询之后全是逐文件重活。
  const stopped = options?.checkpoint?.();
  if (stopped != null) {
    return stopped;
  }

  // 批量预取 file_cache：两条 IN 查询（entries + blobs）替代每文件两跳
  // 串行 SQL——大会话几十个规则文件的读链曾是 workplace 组装的主要成本
  // （单连接串行执行下，并发救不了，只能减查询数）。
  const cacheKeys = entries.map((entry) => RuleSnapshotCodec.fileCacheKey(entry.status, entry.path));
  const prefetched = await deps.sessionKkv.getMany(kkvSessionId, SESSION_KKV_DOMAIN_FILE_CACHE, cacheKeys);

  const prefixPaths: string[] = [];
  const visiblePaths: string[] = [];
  const blocks: string[] = [];
  const files: WorkplaceAssembledFile[] = [];
  const fingerprintParts: string[] = [];
  for (const entry of entries) {
    // 按文件粒度的中止观察点（见 LongTaskHooks.checkpoint）
    // ——2026-09-30 实锤：16s 原子组装段里 17 次停止点按全部真派发却无从
    // 兑现。单文件的「缓存解析 + VFS 回填」仍是本轮的最小原子单元。
    const stopped = options?.checkpoint?.();
    if (stopped != null) {
      return stopped;
    }
    const resolved = LogicalPath.resolve(entry.path);
    if (!resolved.ok) {
      return { kind: "failed", error: resolved.error };
    }
    const normalized = resolved.value;
    // 全量可见集（workplace 省略判定用，= 旧 prefixPaths 语义）。
    visiblePaths.push(normalized);
    // S0 入集（attach 去重用）：只有 full 档真正把全文注入了提示词，
    // 才允许它抑制后续 attach 的全文；header / filename 没这资格。
    if (entry.status === "full") {
      prefixPaths.push(normalized);
    }
    const raw = prefetched.get(RuleSnapshotCodec.fileCacheKey(entry.status, entry.path));
    const cached = raw != null ? RuleSnapshotCodec.parseFileCachePayload(raw) : null;
    // 冷 miss 后先服务于读者：正文已读到即用于组装，压缩+落库交给
    // 后台 fire-and-forget（推迟一个宏任务，不跟同轮读链抢 JS 线程）。
    // file_cache 只是加速层，丢了下次再回填。
    const fillDeps = { sessionId: kkvSessionId, sessionKkv: deps.sessionKkv, vfs: deps.vfs, path: entry.path, status: entry.status };
    const payload = cached?.ok === true ? cached.value : await FileCache.fillFromVfs(fillDeps, { deferBackfillWrite: true });
    const fileBody = WorkplaceDisplay.renderFileBlockBody({
      logicalPath: entry.path,
      display: entry.status,
      content: payload.body,
    });
    blocks.push(WorkplaceDisplay.renderFileBlock({ logicalPath: entry.path, mtimeMs: payload.mtimeMs, display: entry.status, content: payload.body }));
    // 结构化清单（预览侧 workplace 二级卡数据源）：块内正文与展示串同口径，
    // 预览不再从串反解。
    files.push({ path: entry.path, display: entry.status, body: fileBody });
    // 末段 bodyLength（r4-core-4）：mtime 是毫秒精度且树复制会保留源 mtime，
    // 「mtime 同、正文异」会让指纹假同 → 下游记忆/指纹估读返回陈旧值。
    // 体量是零成本字段（payload 已在手），长度异即指纹异。
    fingerprintParts.push(`${entry.path}|${entry.status}|${payload.mtimeMs}|${payload.body.length}`);
  }
  const workplaceBody = WorkplaceDisplay.joinFileBlocks(blocks);
  return {
    kind: "completed",
    value: {
      // 常驻前缀唯一包裹出口：非空 display 外包一层 `<workplace>`（空串不包）。
      // 禁止在 renderFileBlock / joinFileBlocks（WorkplaceDisplay） / synthetic 路径再次包裹。
      workplaceDisplay: workplaceBody === "" ? "" : `<workplace>\n${workplaceBody}\n</workplace>`,
      files,
      prefixPaths,
      visiblePaths,
      // 指纹在循环里逐文件拼：entry 顺序即快照序（稳定），mtimeMs / 正文长度
      // 来自缓存/回填载荷。指纹串长度 ≈ path 数 × 几十字节，远小于哈希正文串
      // 本身。
      fingerprint: fingerprintParts.join(";"),
    },
  };
}
