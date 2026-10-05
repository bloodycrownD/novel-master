/**
 * 压缩编排（token 预热版）：冻结窗口 → runCompaction → 精确预热 → 解冻 → UI 尾巴。
 *
 * 存在的理由（r3-orc-1）：手动压缩此前有两份手工副本——聊天页
 * `useChatTabMessageActions.handleCompactSession` 与详情页
 * `SessionDetailScreen.handleCompact`。两份在「谁负责解冻、失败出口补哪些 UI 尾巴、
 * 抛错出口补哪些 UI 尾巴」上已漂移五处，而解冻这件事本身在旧代码里是**隐式**的：
 * 成功路径上没人显式调 `endChatTokenLabelFreeze`，全靠预热自己的 finally 兜底，
 * 任何一处副本改动都可能提前解冻或永久不解冻。本入口把编排收成唯一一份，
 * UI 侧只提供尾巴钩子。
 *
 * 时序（写死，勿调换）：
 * 1. {@link beginChatTokenLabelFreeze} —— 冻结窗口必须**先于** `runCompaction`
 *    打开：压缩过程的转录事件会触发 chip 刷新，开晚一步估算首帧（gpt ≈）就先
 *    跳出来了（2026-09-30 真机实锤）。
 * 2. 取 hideStartDepth → `runCompaction`。
 * 3. 成功 → `await` {@link warmChatTokenLabelAfterCompaction}（压缩改串 L1 必 miss，
 *    先完整解析一轮暖 L1；暖完首帧即精确档，无跳变）。
 * 4. {@link endChatTokenLabelFreeze} 解冻（成败/异常都执行，finally 收口）。
 * 5. 跑 UI 尾巴钩子。
 *
 * @module services/compaction-warm-orchestration
 */

import {runCompaction} from '@novel-master/core/compaction';
import {
  beginChatTokenLabelFreeze,
  endChatTokenLabelFreeze,
  warmChatTokenLabelAfterCompaction,
} from './chat-prompt-tokens.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * 一次压缩编排的结果（供 `onFinally` 判别该补哪些尾巴）。
 *
 * ⚠️ 本类型只服务 {@link runCompactionWithTokenWarm}——**手动压缩专属**编排
 * （硬约束见该函数 JSDoc 首行）：`ok` 为真即表示这一轮是手动压缩且已清
 * `rule_snapshot` + `file_cache` 两域，调用方据此刷新预览/workplace。
 */
export type RunCompactionWithTokenWarmOutcome = {
  /** 压缩本体是否成功。 */
  readonly ok: boolean;
  /**
   * `undefined` 表示「压缩本体明确返回失败」（`runCompaction` 的 `ok: false`）；
   * 非 `undefined` 表示「压缩链抛错」。两种失败出口的 UI 收场不同（详情页的
   * `load()` 只在前者之后跑），故必须能分辨，故原样透传。
   */
  readonly error: unknown;
};

/** 压缩编排的 UI 尾巴钩子（全部可选，都在解冻之后调用）。 */
export type RunCompactionWithTokenWarmHooks = {
  /** 压缩失败（明确失败或抛错）时的尾巴。 */
  readonly onFailed?: (
    error: unknown,
  ) => void | Promise<void>;
  /** 压缩成功后的尾巴。 */
  readonly onSucceeded?: () => void | Promise<void>;
  /** 成功与失败都会跑的尾巴。 */
  readonly onFinally?: (
    outcome: RunCompactionWithTokenWarmOutcome,
  ) => void | Promise<void>;
};

/**
 * 手动压缩的单一编排入口：冻结 → 压缩 →（成功则）预热 → 解冻 → UI 尾巴。
 *
 * ⚠️ 本编排是**手动压缩专属**入口：两处调用方均为 UI「压缩上下文」按钮，故
 * `trigger` 硬写 "manual"。接自动压缩前必须先给本函数加 trigger 透传参数，
 * 不得沿用这一行——自动压缩清两域会打破回合内前缀冻结。
 *
 * 本函数**不外抛异常**：所有出口（成功 / 明确失败 / 抛错 / 尾巴自身抛错）都在
 * 内部收口，调用方可以直接 `void` 掉它。
 */
export async function runCompactionWithTokenWarm(
  runtime: MobileNovelMasterRuntime,
  scope: {readonly projectId: string; readonly sessionId: string},
  hooks: RunCompactionWithTokenWarmHooks = {},
): Promise<void> {
  const {projectId, sessionId} = scope;
  // 冻结计数 ++（与第 4 步的 -- 配对）
  beginChatTokenLabelFreeze(sessionId);
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
    if (result.ok) {
      // 预热本体自带 try/catch（失败只回退为两阶段跳变，不影响压缩流程）。
      await warmChatTokenLabelAfterCompaction(runtime, {projectId, sessionId});
      ok = true;
    }
  } catch (error) {
    failure = {error};
  } finally {
    // 解冻：与 beginChatTokenLabelFreeze 的 ++ 配对。计数归零才真解冻——预热那一路
    // 已在 warmChatTokenLabelAfterCompaction 自己的 finally 里配掉（配对关系见
    // chat-prompt-tokens.service 中 preciseWarmInflight 的注释）。
    endChatTokenLabelFreeze(sessionId);
  }
  const outcome: RunCompactionWithTokenWarmOutcome = {
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
