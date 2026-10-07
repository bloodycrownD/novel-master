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

import {runCompaction} from '@novel-master/core/compaction';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * 一次手动压缩的结果（供 `onFinally` 判别该补哪些尾巴）。
 *
 * `ok` 为真即表示这一轮手动压缩成功（core 侧已清 `rule_snapshot` +
 * `file_cache` 两域），调用方据此刷新预览/workplace。
 */
export type ManualCompactionOutcome = {
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
  readonly onFailed?: (
    error: unknown,
  ) => void | Promise<void>;
  /** 压缩成功后的尾巴。 */
  readonly onSucceeded?: () => void | Promise<void>;
  /** 成功与失败都会跑的尾巴。 */
  readonly onFinally?: (
    outcome: ManualCompactionOutcome,
  ) => void | Promise<void>;
};

/**
 * 手动压缩的单一编排入口：runCompaction → UI 尾巴。
 *
 * ⚠️ 本编排是**手动压缩专属**入口：两处调用方均为 UI「压缩上下文」按钮，故
 * `trigger` 硬写 "manual"。接自动压缩前必须先给本函数加 trigger 透传参数，
 * 不得沿用这一行——自动压缩清两域会打破回合内前缀冻结。
 *
 * 本函数**不外抛异常**：所有出口（成功 / 明确失败 / 抛错 / 尾巴自身抛错）都在
 * 内部收口，调用方可以直接 `void` 掉它。
 */
export async function runManualCompaction(
  runtime: MobileNovelMasterRuntime,
  scope: {readonly projectId: string; readonly sessionId: string},
  hooks: ManualCompactionHooks = {},
): Promise<void> {
  const {projectId, sessionId} = scope;
  let ok = false;
  // `null` 表示「压缩本体明确返回失败」（无错误详情）；`{error}` 表示抛错。
  let failure: {readonly error: unknown} | null = null;
  try {
    const hideStartDepth =
      await runtime.compactionConditionEvaluator.getHideStartDepth();
    const result = await runCompaction(
      {
        sessionKkv: runtime.sessionKkv,
        messages: runtime.messages,
        messageTranscriptEffects: runtime.messageTranscriptEffects,
      },
      // `trigger:"manual"`：手动压缩要清该会话 KKV 的 `rule_snapshot` +
      // `file_cache` 两域，下一次拼提示词时 workplace 块按当前工作区重评估
      // （自动压缩刻意**不清**——agent 回合中段要保住「回合内前缀冻结」）。
      // ⚠️ 这行硬写 manual 依赖「本编排只服务手动入口」这一前置（见上 JSDoc
      // 首行）：将来接自动压缩必须先加 trigger 透传参数，不得沿用。
      {sessionId, projectId, hideStartDepth, trigger: 'manual'},
    );
    ok = result.ok;
  } catch (error) {
    failure = {error};
  }
  const outcome: ManualCompactionOutcome = {
    ok,
    error: failure?.error,
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
    // 一层 try/catch：它是「不外抛异常」契约的最后一道出口，再抛出去调用方的
    // void 就变 unhandled rejection 了。
    if (ok) {
      try {
        await hooks.onFailed?.(error);
      } catch {
        // 兜底的兜底：吞掉，无处再报也不该再报。
      }
    }
  }
}
