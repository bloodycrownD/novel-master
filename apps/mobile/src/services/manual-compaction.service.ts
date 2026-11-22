/**
 * 手动压缩编排：runCompaction → UI 尾巴（与置位同口径，2026-10-07）。
 *
 * 存在的理由（r3-orc-1）：手动压缩此前有两份手工副本——聊天页
 * `useChatTabMessageActions.handleCompactSession` 与详情页
 * `SessionDetailScreen.handleCompact`，两份在「失败出口补哪些 UI 尾巴、抛错
 * 出口补哪些 UI 尾巴」上已漂移五处。本入口把编排收成唯一一份，UI 侧只提供
 * 尾巴钩子。
 *
 * 2026-10-07 起不再做「token 精确预热」（旧版 runCompactionWithTokenWarm 在
 * runCompaction 成功后同步 await 一轮完整解析暖 L1，为消 2026-09-30 拍板的
 * `gpt ≈` 跳变）：v1.5.39 起手动压缩清 `rule_snapshot` + `file_cache` 两域，
 * 预热变成全量冷组装（清单重评估 + 逐文件读盘 + inflate + 回填 deflate），
 * 全被压在「压缩完成」toast 之前，真机卡顿实锤。用户重新拍板：置位与压缩
 * 同路径——核心操作落库即返回，chip 读数交给常规两阶段刷新（估算首帧 +
 * 后台精确升级）自然跟进，跳变与短暂旧值可接受。
 *
 * @module services/manual-compaction
 */

import {Compaction} from '@novel-master/core/compaction';
import {ABORT_KEY, AbortScopeFactory} from '@novel-master/core/abort';
import type {Interrupt, Outcome} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * 一次手动压缩的结果（供 `onFinally` 判别该补哪些尾巴）。
 *
 * `ok` 为真即表示这一轮手动压缩成功（core 侧已清 `rule_snapshot` +
 * `file_cache` 两域），调用方据此刷新预览/workplace。
 */
type ManualCompactionOutcome = {
    /** 压缩本体是否成功。 */
    readonly ok: boolean;
    /**
   * `undefined` 表示「压缩本体明确返回失败」（`runCompaction` 的 `ok: false`）；
   * 非 `undefined` 表示「压缩链抛错」。两种失败出口的 UI 收场不同（详情页的
   * `load()` 只在前者之后跑），故必须能分辨，故原样透传。
   */
    readonly error: unknown;
};

/** 手动压缩的 UI 尾巴钩子（全部可选）。 */
export type ManualCompactionHooks = {
    /** 压缩失败（明确失败或抛错）时的尾巴。 */
    readonly onFailed?: (error: unknown) => void | Promise<void>;
    /** 压缩成功后的尾巴。 */
    readonly onSucceeded?: () => void | Promise<void>;
    /** 成功与失败都会跑的尾巴。 */
    readonly onFinally?: (outcome: ManualCompactionOutcome) => void | Promise<void>;
};

export namespace ManualCompactionService {
    /** 中断 → Outcome 四分支的短路形态（completed / failed 不在这里产生）。 */
    function interrupted(hit: Interrupt): Outcome<never> {
        return hit.kind === 'cancelled' ? {kind: 'cancelled', reason: hit.reason} : {kind: 'replaced'};
    }

    /**
   * 手动压缩的单一编排入口：runCompaction → UI 尾巴。
   *
   * ⚠️ 本编排是**手动压缩专属**入口：两处调用方均为 UI「压缩上下文」按钮，故
   * `trigger` 硬写 "manual"。接自动压缩前必须先给本函数加 trigger 透传参数，
   * 不得沿用这一行——自动压缩清两域会打破回合内前缀冻结。
   *
   * 出口：业务失败与尾巴抛错仍在内部收口（不外抛）；取消以 `Outcome` 返回值
   * 给出（`cancelled`/`replaced`），不再以 AbortError reject——编排内部的
   * `Outcome.cancelled`/`replaced` 原样作为返回值透出，调用方按 kind 判断。
   * 取消只跑 `onFinally`（清理尾巴），不触发 `onFailed`（取消不是失败）。
   */
    export async function run(runtime: MobileNovelMasterRuntime, scope: {readonly projectId: string; readonly sessionId: string}, hooks: ManualCompactionHooks = {}): Promise<Outcome<void>> {
        const {sessionId} = scope;
        // AbortScope 与业务参数 `scope` 撞名：按 spec 约定命名为 abortScope。
        const abortScope = AbortScopeFactory.create();
        runtime.abortRegistry.register(ABORT_KEY.compaction(sessionId), abortScope);
        let work: Outcome<boolean> | null = null;
        // `null` 表示「压缩本体明确返回失败」（无错误详情）；`{error}` 表示抛错。
        let failure: {readonly error: unknown} | null = null;
        try {
            // 入口检查点；之后只到 hide 开始前还有一个可中断点。
            const entry = abortScope.checkpoint();
            if (entry != null) {
                work = interrupted(entry);
            } else {
                const hiddenDepth = await runtime.compactionConditionEvaluator.getHideStartDepth();
                if (!hiddenDepth.ok) {
                    // 读深度失败（错误通道迁移四期）：与抛错出口同收场（error 非空），
                    // UI 尾巴按「压缩链抛错」口径处理。
                    work = {kind: 'failed', error: hiddenDepth.error};
                } else {
                    // hide 前最后一道检查点：hide → invalidate → KKV 清理整段不可中断
                    // （中途抛错会留下「消息已隐藏、缓存未清」的半应用态）。
                    const beforeHide = abortScope.checkpoint();
                    if (beforeHide != null) {
                        work = interrupted(beforeHide);
                    } else {
                        const compactionDeps = {sessionKkv: runtime.sessionKkv, messages: runtime.messages};
                        // `trigger:"manual"`：手动压缩要清该会话 KKV 的 `rule_snapshot` +
                        // `file_cache` 两域，下一次拼提示词时 workplace 块按当前工作区重评估
                        // （自动压缩刻意**不清**——agent 回合中段要保住「回合内前缀冻结」）。
                        // ⚠️ 这行硬写 manual 依赖「本编排只服务手动入口」这一前置（见上 JSDoc
                        // 首行）：将来接自动压缩必须先加 trigger 透传参数，不得沿用。
                        const compactionOptions = {sessionId, hideStartDepth: hiddenDepth.value, trigger: 'manual' as const};
                        const result = await Compaction.run(compactionDeps, compactionOptions);
                        // `completed.value` 是压缩本体自己的 `ok`——「明确返回失败」仍是
                        // 完成态的一部分（不是 failed，保留 `onFailed(undefined)` 的既有语义）。
                        work = {kind: 'completed', value: result.ok};
                    }
                }
            }
        } catch (error) {
            failure = {error};
        } finally {
            runtime.abortRegistry.unregister(ABORT_KEY.compaction(sessionId), abortScope);
            abortScope.dispose();
        }
        if (work != null && (work.kind === 'cancelled' || work.kind === 'replaced')) {
            try {
                await hooks.onFinally?.({ok: false, error: undefined});
            } catch {
                // 清理尾巴自身抛错不掩盖取消语义。
            }
            return work;
        }
        const ok = work?.kind === 'completed' ? work.value : false;
        const outcome: ManualCompactionOutcome = {
            ok,
            error: failure != null ? failure.error : work?.kind === 'failed' ? work.error : undefined,
        };
        try {
            if (ok) {
                await hooks.onSucceeded?.();
            } else {
                await hooks.onFailed?.(outcome.error);
            }
            await hooks.onFinally?.(outcome);
        } catch (error) {
            // 尾巴自身抛错：与旧手工副本同款收口——成功分支的尾巴抛错时补一次失败提示
            // （失败分支的尾巴抛错则不再提示，否则会连弹两条）。这次兜底提示自身再包
            // 一层 try/catch：它是「业务失败不外抛」契约的最后一道出口，再抛出去调用方
            // 的 void 就变 unhandled rejection 了。
            if (ok) {
                try {
                    await hooks.onFailed?.(error);
                } catch {
                    // 兜底的兜底：吞掉，无处再报也不该再报。
                }
            }
        }
        return {kind: 'completed', value: undefined};
    }
}
