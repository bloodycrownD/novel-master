/**
 * 压缩执行器：直调化的 hide-message + token cache 失效。
 *
 * 本模块把原先散落在 `event-orchestrator.service.ts`（kkv 清理 + token cache 失效）
 * 与 `hide-message.handler.ts`（hide-message action）里的逻辑收拢成一个入口，
 * 让 agent-runner / 手动压缩不再绕事件编排器。
 *
 * 行为口径（2026-09-29 修正「压缩与文件缓存无关」，2026-10-05 补手动刷新）：
 * 1. 按 `hideStartDepth` 构造 open-ended depth slice，调用 hide-message；
 * 2. 失效该会话的 prompt token 进程内缓存（可见 prompt 变了，API 占用必须丢）；
 * 3. `trigger: "manual"` 时额外清 `rule_snapshot` + `file_cache` 两域。
 *
 * **自动压缩（`trigger` 缺省 / `"auto"`）不清这两域**：这两个域按内容寻址、
 * 与消息可见性正交；更重要的是自动压缩发生在 agent 回合**中段**，回合快照
 * 语义要求前缀回合内冻结（`loadOrFillFileCache` 命中无条件返回），中途清缓存
 * 反而破坏该不变量（2026-09-29 用户拍板）。
 *
 * **手动压缩（`trigger: "manual"`）清两域**：手动压缩是用户主动的重整意图，
 * 语义等价于「手动调整工作区规则后的完整刷新」——清域后下一次拼提示词（发送
 * 或预览）时 workplace 块按当前工作区重评估（新文件进清单、正文重读）。
 * 清域**失败只吞错 + `console.warn`**（不上抛）：`file_cache` 是纯加速层，
 * 清不掉最多让下一次组装多读一次 VFS，不能把「压缩成功」翻成「压缩失败」。
 * 用户主动的「重置」语义（置位 setMessageFloorAtMessage、导入缓存对齐）仍清
 * 这两域，不受影响。
 *
 * @module service/compaction-conditions/run-compaction
 */

import { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { HideMessageRange } from "@/domain/depth/logic/resolve-hide-message-range.js";
import { DEFAULT_HIDE_START_DEPTH } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import type { LongTaskHooks } from "@/domain/abort/model/abort-scope.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE, SESSION_KKV_DOMAIN_RULE_SNAPSHOT } from "@/domain/session-kkv/model/session-kkv-domains.js";
import { SessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { LogFactory } from "@/infra/log/logger.js";

const log = LogFactory.create("compaction.run");

/** 压缩触发来源：手动（用户点「压缩上下文」）vs 自动（agent 回合中段条件压缩）。 */
type CompactionTrigger = "manual" | "auto";

/** runCompaction 的运行时依赖（与事件编排器原先持有的那组服务同构）。 */
export interface RunCompactionDeps {
    readonly sessionKkv: SessionKkvService;
    readonly messages: MessageService;
}

/** runCompaction 的调用参数。 */
interface RunCompactionParams {
    readonly sessionId: string;
    /** hide-message 起始深度（tail 0 = newest），缺省按 {@link DEFAULT_HIDE_START_DEPTH}。 */
    readonly hideStartDepth?: number;
    /**
   * 压缩触发来源，缺省按 `"auto"`（既有调用零改动）。
   *
   * `"manual"`：成功路径额外清 `rule_snapshot` + `file_cache`（workplace 完整
   * 刷新，吞错 warn）；`"auto"`：两域保留（回合内前缀冻结，见模块头注释）。
   */
    readonly trigger?: CompactionTrigger;
    /**
   * 长任务注入钩子（可选）：入口与 hide 前各一个同步检查点，并穿透到压缩
   * 路径最大的一次读（`listBySessionFromSeq` 的分片边界）。
   *
   * `hide → token cache 失效 → KKV 清理` 是不可中断尾段：中途取消会留下
   * 「消息已隐藏、缓存未清」的半应用态，因此 hide 开始后不再看 checkpoint。
   */
    readonly hooks?: LongTaskHooks;
}

/**
 * 压缩执行结果。
 *
 * `{ ok: false }` 分不出「取消」与「真失败」，中断单独收
 * `{ ok: false, cancelled: true }`（IPC 边界据此转 `IPC_ABORTED`）。
 */
interface RunCompactionResult {
    readonly ok: boolean;
    readonly cancelled?: true;
}

/** 压缩执行入口集合（hide-message → token cache 失效 → manual 清域）。 */
export const Compaction = {
    /**
   * 执行一次压缩：hide-message → 失效 prompt token cache →（仅 `trigger:"manual"`）
   * 清 `rule_snapshot` + `file_cache` 两域（见模块头注释）。
   *
   * hide-message 抛异常时返回 `{ ok: false }`，不向上传播——与旧编排器
   * `emit()` 在 result.ok 为 false 时跳过 kkv 清理的语义一致（异常路径下不清缓存）。
   * 该早 return 结构天然保证「manual 场景 hide 失败 → 两域不清」。
   */
    async run(deps: RunCompactionDeps, params: RunCompactionParams): Promise<RunCompactionResult> {
        // 入口检查点：压缩还没动任何状态，取消零代价。未注入 hooks 时恒不可达。
        const entryCancelled = Compaction.cancelledResult(params.hooks);
        if (entryCancelled != null) return entryCancelled;

        const startDepth = params.hideStartDepth ?? DEFAULT_HIDE_START_DEPTH;
        const slice: DepthSlice = { startDepth };

        try {
            const headers = await deps.messages.listMessageHeadersBySession(params.sessionId);
            const stubAll = headers.map((header) => ({ id: header.id, sessionId: header.sessionId, seq: header.seq, role: header.role, content: { blocks: [] }, provider: null, raw: null, createdAtMs: header.createdAtMs, hidden: header.hidden }));
            const visible = stubAll.filter((m) => !m.hidden);
            const ids = DepthSlice.messageIds(visible, slice);
            // 错误通道迁移四期：切片失败不再借 throw 走下方 catch，直接按本函数
            // 既有失败形态返回（行为与原「抛出即被相邻 catch 吞成 ok:false」逐位等价）。
            if (!ids.ok) return { ok: false };
            if (ids.value.length > 0) {
                const idSet = new Set(ids.value);
                const minSeq = Math.min(...visible.filter((m) => idSet.has(m.id)).map((m) => m.seq));
                // hooks 必须穿透到这次读：它是压缩路径最大的一次读，不传则整段对取消盲。
                const fullRowsOutcome = await deps.messages.listBySessionFromSeq(params.sessionId, minSeq, params.hooks);
                if (fullRowsOutcome.kind === "failed") return { ok: false };
                if (fullRowsOutcome.kind !== "completed") return { ok: false, cancelled: true };
                const fullRows = fullRowsOutcome.value;
                const fullById = new Map(fullRows.map((m) => [m.id, m]));
                const mergedVisible = visible.map((m) => fullById.get(m.id) ?? m);
                const range = HideMessageRange.resolve(mergedVisible, slice, ids.value);
                if (range != null) {
                    // hide 前最后一个检查点：从这里开始进入不可中断尾段（hide → token cache
                    // 失效 → KKV 清理），中途抛错会留下半应用态。
                    const hideCancelled = Compaction.cancelledResult(params.hooks);
                    if (hideCancelled != null) return hideCancelled;
                    // 失败口径保持原样：只吞 throw（下方 catch → { ok:false }），Result.err 不翻转压缩结果。
                    await deps.messages.hideRange(params.sessionId, range.fromSeq, range.toSeq);
                }
            }
        } catch {
            return { ok: false };
        }

        // 压缩后可见 prompt 变了：API 占用双删（进程内热层 + session KKV 行）。
        // 落库值若残留，重启后会按 api 口径参与阈值判定（跳掉 heuristic 安全
        // 系数），陈旧值会放大误判，所以这里必须连 KKV 行一起清。
        // rule_snapshot / file_cache 自动压缩不清、仅 manual 清——见模块头注释。
        await SessionApiPromptTokenEntry.invalidate(deps.sessionKkv, params.sessionId);

        // 手动压缩：清 workplace 两域，让下一次拼提示词时按当前工作区完整刷新
        // （新文件进清单、正文重读）。失败只吞错 + warn——file_cache 是纯加速层，
        // 清不掉最多多读一次 VFS，不能把「压缩成功」翻成「压缩失败」。
        // 两域各自独立 try：rule_snapshot 清失败不能拦住 file_cache 的清空，
        // 否则快照已重评估而正文缓存命中旧正文，静默沿用旧内容。
        if ((params.trigger ?? "auto") === "manual") {
            for (const domain of [SESSION_KKV_DOMAIN_RULE_SNAPSHOT, SESSION_KKV_DOMAIN_FILE_CACHE]) {
                try {
                    await deps.sessionKkv.clearDomain(params.sessionId, domain);
                } catch (error) {
                    log.warn(`手动压缩后 best-effort 清空 ${domain} 失败（session=${params.sessionId}）`, { error });
                }
            }
        }

        return { ok: true };
    },

    /** 检查点命中 → 压缩取消形态；未命中返回 null。 */
    cancelledResult(hooks?: LongTaskHooks): RunCompactionResult | null {
        return hooks?.checkpoint?.() == null ? null : { ok: false, cancelled: true };
    },
} as const;
