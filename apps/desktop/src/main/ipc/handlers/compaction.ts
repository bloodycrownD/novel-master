/**
 * 手动压缩 IPC —— 直调 Compaction.run（hide-message + kkv 清理 + token cache 失效）。
 *
 * 成功后触发 composer status 刷新（置位/压缩同口径：project∪annotate）。
 *
 * 2026-10-07 起与置位走同一条实现路径（对齐 handleMessagesSetFloor）：核心操作
 * 落库即返回，**不做任何显式暖机**——token 读数交给 renderer chip 的常规两阶段
 * 刷新（估算首帧 + 后台精确升级）自然跟进。UI 读数不时间敏感，跳变/短暂旧值可
 * 接受（用户重新拍板放宽了「压缩跳变也消掉」的旧口径）。此前「IPC 返回前把精确档
 * 暖好」的实现在 v1.5.39 手动压缩清 `rule_snapshot` + `file_cache` 两域后变成
 * 全量冷组装（清单重评估 + 逐文件读盘 + inflate + 回填 deflate），挡在 IPC 返回前
 * 造成压缩按钮到 toast 卡顿数秒，故删除。
 *
 * **run 在途门禁**：Agent 回合在跑时拒绝手动压缩（与置位/回滚/分叉的 running
 * 拦截同口径）。判活源复用 {@link isDesktopSessionRunInFlight}（core
 * abortRegistry，判据写在 agent.ts，import 方向与 chat-prompt-tokens.service
 * 一致、单向无环）。renderer 侧**不做**预拦截：`CompactionIpc.handleManual` 的
 * 包装函数在模块级，拿不到组件的 running 态，所以 main 侧门禁是唯一守卫；
 * renderer 现有 `!result.ok → showToast(result.error.message)` 链路会自动
 * 弹出这里的文案，零改动。
 *
 * namespace 注：本文件按文件名应叫 `Compaction`，但 core `@novel-master/core/compaction`
 * 的 `Compaction`（`Compaction.run`）在本文件体内使用，本地同名 const 与 import
 * 冲突（TS2300），按内容主体起名 `CompactionIpc`（§9.7 冲突逃生口）。
 */
import { ABORT_KEY, type AbortScope, type LongTaskHooks } from "@novel-master/core/abort";
import { AppError, type Outcome } from "@novel-master/core/errors";
import { Compaction, type RunCompactionDeps } from "@novel-master/core/compaction";
import type {
    CompactionManualRequest,
    IpcResult,
} from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { ComposerStatusRefresh } from "../../services/notify-composer-status-after-kkv-clear.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { RunScope } from "../run-scope.js";
import { Agent } from "./agent.js";

export const CompactionIpc = {
    /**
   * 手动压缩 IPC（signal-abort-scope §五）：timeout 180s；入口检查点 + hide 前
   * 检查点（经 `hooks` 穿透到 `Compaction.run`）。`hide → token cache 失效 →
   * KKV 清理` 与批量 `hideRange`/`showRange` 是**不可中断尾段**——中途抛错会
   * 留下「消息已隐藏、缓存未清」的半应用态，所以取消只承诺「真正开始前可取消」。
   */
    async handleManual(req: CompactionManualRequest): Promise<IpcResult<{ ok: boolean }>> {
        const built = await DesktopRuntimeSingleton.get();
        // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
        if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
        const rt = built.value;
        // run 在途即拒：压缩是 hide-message 式的可见性重排，落在回合中段会与
        // core 那边「回合内前缀冻结」的自动压缩语义打架。返回既有 IpcResult 失败
        // 分支（不引入 data 层 reason 字段，IPC 契约零变更）。
        if (Agent.isDesktopSessionRunInFlight(rt, req.sessionId)) {
            return IpcResults.err({
                // 机器码走 SCREAMING_SNAKE，与 `IpcErrorPayload.code` 家族其余成员一致
                //（同语义先例 `AGENT_BUSY`）。
                code: "AGENT_RUN_IN_FLIGHT",
                message: "Agent 运行中无法压缩",
            });
        }
        // exclusive：key 固定为 sessionId，同会话并发压缩时第二个请求不得覆盖在途
        // scope（覆盖会让先跑的那一轮失去 nm:run/abort 入口）。
        return RunScope.abortable(
            {
                registry: rt.abortRegistry,
                key: ABORT_KEY.compaction(req.sessionId),
                timeoutMs: 180_000,
                exclusive: true,
                conflictError: new AppError("CLI_INVALID_ARGUMENT", { detail: "压缩进行中，请稍后再试" }),
            },
            (scope) => CompactionIpc.manual(rt, req, scope)
        );
    },

    /** 可中断的压缩段：入口 + hide 前检查点，尾段交给不可中断契约。 */
    // nm-style: keep-local — run-abort-scope.test 直引断言取消/完成分支；内联会破坏测试锁名。
    async manual(rt: DesktopNovelMasterRuntime, req: CompactionManualRequest, scope: AbortScope): Promise<Outcome<{ ok: boolean }>> {
        const stopped = RunScope.outcomeIfAborted(scope);
        if (stopped != null) return stopped;
        const deps: RunCompactionDeps = {
            sessionKkv: rt.sessionKkv,
            messages: rt.messages,
        };
        const hiddenDepth = await rt.compactionConditionEvaluator.getHideStartDepth();
        if (!hiddenDepth.ok) return { kind: "failed", error: hiddenDepth.error };
        const hideStartDepth = hiddenDepth.value;
        // 手动压缩：core 侧据此清 `rule_snapshot` + `file_cache` 两域，下一次拼
        // 提示词（发送或预览）时 workplace 块按当前工作区重评估。自动压缩不传、
        // 缺省 auto，不清（保住「回合内前缀冻结」）。
        const hooks: LongTaskHooks = { checkpoint: () => scope.checkpoint() };
        const params: Parameters<typeof Compaction.run>[1] & { readonly hooks: LongTaskHooks } = {
            sessionId: req.sessionId,
            hideStartDepth,
            trigger: "manual",
            hooks,
        };
        const result = await Compaction.run(deps, params);
        // hooks 命中时 core 返回 cancelled 形态（`ok:false` 分不出取消与真失败）。
        if ("cancelled" in result && result.cancelled === true) {
            return { kind: "cancelled", reason: scope.reason ?? "user-stop" };
        }
        if (result.ok) {
            // 置位/压缩：project∪annotate；禁止终态强制 []
            await ComposerStatusRefresh.afterFloorOrCompaction({ projectId: req.projectId, sessionId: req.sessionId });
        }
        return { kind: "completed", value: { ok: result.ok } };
    },
} as const;
