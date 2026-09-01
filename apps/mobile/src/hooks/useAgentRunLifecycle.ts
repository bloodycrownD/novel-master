/**
 * Agent 回合 run 生命周期：activeRunId 状态 + agentActivity refcount。
 *
 * Phase 2 拆分后：abort 状态机（uiRunning / freezeCount / abortRetainPending /
 * abortUiRun）已挪到 {@link useSessionAbort}；本 hook 只保留 run 生命周期——
 * activeRunId 跟踪、stale RUN_STARTED 守卫、agentActive 引用计数。
 *
 * refcount 单一归属：beginUiRun 加、onRunFinished/onRunFailed 减。stream 单元的
 * FINISHED/FAILED 不再直接 decrementAgentActive，改为通知本 hook。
 *
 * uiRunning 的同步通过 `onRunUiActivate` / `onRunUiDeactivate` 回调注入——
 * Provider 实例化顺序是「先 abort 单元、再 lifecycle」，把 abort.markRunStarted /
 * markRunEnded 注入 lifecycle，让 lifecycle 在 onRunStarted/onRunFinished 时
 * 同步刷新 abort 单元的 uiRunning state（同步更新 ref，bus 回调读 ref 零延迟）。
 */
import {
  shouldAcceptRunEvent,
  shouldApplyTranscriptReload,
  shouldIgnoreStaleRunStarted,
} from '@novel-master/core/agent';
import {useCallback, useRef, useState} from 'react';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
} from '@novel-master/core/events';
import {
  decrementAgentActive,
  incrementAgentActive,
} from '@/runtime/agent-activity';

export {shouldApplyTranscriptReload};

/**
 * 发起保护窗时长（MF-4）：beginUiRun 到 core 侧 abortRegistry.register 之间
 * 的正常延迟窗口。窗口内探针把 registry.has=false 视为「尚未 register」而非
 * 「run 已结束」、不收尾；须覆盖 agent-runner 启动到 register 的正常耗时
 * （数百毫秒量级），3s 留有余量。窗口过期后仍 !has 才允许收尾校准。
 * 守卫本身在 ChatTabProvider 的 onRunEnded 闭包（一处覆盖前台探针与轮询）。
 */
export const RUN_LAUNCH_PROTECT_WINDOW_MS = 3_000;

export type AgentRunLifecycle = {
  readonly activeRunId: string | null;
  /** 发 run 前：递增 agentActive；同时通过回调通知 abort 单元 markRunStarted。 */
  beginUiRun(): void;
  /**
   * 最近一次 beginUiRun 的时刻（Date.now()，从未发起为 0）。
   *
   * 发起保护窗判据：beginUiRun 置 uiRunning=true 后、core 侧
   * abortRegistry.register 尚未发生的窗口内，收尾探针不得把
   * registry.has=false 误判为「run 已结束」（详见 ChatTabProvider 的守卫）。
   */
  getBeginUiRunAt(): number;
  /** runId 不匹配则丢弃。 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 设 activeRunId=runId（幂等，stale 守卫过滤迟到的 RUN_STARTED）；通知 abort 单元 uiRunning=true。 */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** accept 后：activeRunId=null、递减 agentActive；通知 abort 单元 uiRunning=false。 */
  onRunFinished(payload: AgentRunFinishedPayload): void;
  onRunFailed(payload: AgentRunFailedPayload): void;
  /**
   * UI 侧 run 异常收尾（如 runAgentTurn 同步 throw）。
   *
   * 幂等：用 uiActiveRef 跟踪 beginUiRun / onRunStarted 是否已激活 UI run 态，
   * 未激活时直接 no-op；激活过则清 activeRunId、通知 abort 单元 uiRunning=false、
   * 递减 agentActive，并把 uiActiveRef 翻回未激活。
   *
   * 这样 composer 不再需要 finally 兜底递减——refcount 单一归属 lifecycle。
   */
  endUiRunOnError(): void;
  /** session 切换：清 activeRunId（abort 状态与 stream 清理由 abort 单元负责）。 */
  resetUiForSessionChange(): void;
};

export type UseAgentRunLifecycleParams = {
  /** run 启动时同步通知 abort 单元（markRunStarted：uiRunning=true + 清 freeze/retain）。 */
  readonly onRunUiActivate?: () => void;
  /** run 结束时同步通知 abort 单元（markRunEnded：uiRunning=false + 清 freeze）。 */
  readonly onRunUiDeactivate?: () => void;
  /**
   * 同步读 abort 单元的 uiRunning——stale RUN_STARTED 守卫要用它
   * （abort 后 uiRunning=false，迟到的 RUN_STARTED 不应再激活）。
   */
  readonly getUiRunning?: () => boolean;
  /**
   * session 切换时查询是否开启恢复窗口（core abortRegistry 仍注册该 session 的
   * in-flight run 时为 true）。返回 true 时 `resetUiForSessionChange` 会开窗，
   * 让 `activeRunId == null` 期间的事件接纳放宽为任何非空 runId（子会话口径）。
   *
   * 关窗只由两个信号承担：窗口内任何带 runId 的事件被接纳（反填即关窗）、
   * session 切换（旧窗随 reset 关闭、新窗按本回调按需开启）。core registry
   * 只有同步 has() 查询、没有变更订阅，「has 变 false」不承担关窗，其复评
   * 挂到既有探针/轮询节点，仅作收尾校准。
   */
  readonly getResumeWindowEligible?: () => boolean;
};

export function useAgentRunLifecycle({
  onRunUiActivate,
  onRunUiDeactivate,
  getUiRunning,
  getResumeWindowEligible,
}: UseAgentRunLifecycleParams = {}): AgentRunLifecycle {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  // 跟踪 beginUiRun / onRunStarted 是否已激活 UI run 态，给 endUiRunOnError 做幂等守卫。
  const uiActiveRef = useRef(false);
  // refcount 归属标记：仅本单元 beginUiRun 加过 agentActive 计数且尚未抵扣时为 true。
  const refCountedRef = useRef(false);
  // 最近一次发起（beginUiRun）时刻：发起保护窗判据。不记在 abort.markRunStarted
  // ——探针的合成恢复也调它，记那边会把合法的兑底收尾一并推迟保护窗时长。
  const beginUiRunAtRef = useRef(0);

  const onRunUiActivateRef = useRef(onRunUiActivate);
  onRunUiActivateRef.current = onRunUiActivate;
  const onRunUiDeactivateRef = useRef(onRunUiDeactivate);
  onRunUiDeactivateRef.current = onRunUiDeactivate;
  const getUiRunningRef = useRef(getUiRunning);
  getUiRunningRef.current = getUiRunning;
  const getResumeWindowEligibleRef = useRef(getResumeWindowEligible);
  getResumeWindowEligibleRef.current = getResumeWindowEligible;

  // 恢复窗口：开启期间 activeRunId==null 时事件接纳放宽为任何非空 runId。
  // 无「窗口超时关闭」机制——activeRunId 反填后放宽条件自然失效，收尾残留
  // 由探针兜底（见 use-run-resume-probe），不为超时另发明信号。
  const resumeWindowRef = useRef(false);

  const syncActiveRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const beginUiRun = useCallback(() => {
    // abort 状态机的 freeze/retain 清理由 abort.markRunStarted 完成。
    uiActiveRef.current = true;
    refCountedRef.current = true;
    beginUiRunAtRef.current = Date.now();
    onRunUiActivateRef.current?.();
    incrementAgentActive();
  }, []);

  const getBeginUiRunAt = useCallback(() => beginUiRunAtRef.current, []);

  const acceptRunEvent = useCallback(
    (runId: string | undefined): boolean => {
      if (shouldAcceptRunEvent(activeRunIdRef.current, runId)) {
        return true;
      }
      // 恢复窗口内的放宽接纳是带副作用的（显式设计决策）：accept 通过的同一
      // 同步路径里反填 activeRunId 并关窗恢复严格匹配。反填必须先于
      // onRunFinished / onRunFailed 内部的 shouldAcceptRunEvent 守卫求值——
      // 若 FINISHED/FAILED 是窗口内第一条事件而反填不同步，内部守卫求值时
      // activeRunId 仍为 null 必拒，uiRunning 永久残留、refcount 不减。
      // core registry 只有 has() 拿不到 runId，反填是拿到真实 runId 的唯一途径。
      if (
        activeRunIdRef.current == null &&
        resumeWindowRef.current &&
        runId != null &&
        runId !== ''
      ) {
        resumeWindowRef.current = false;
        syncActiveRunId(runId);
        return true;
      }
      return false;
    },
    [syncActiveRunId],
  );

  const onRunStarted = useCallback(
    (payload: AgentRunStartedPayload) => {
      // abort 后 uiRunning=false 时忽略迟到 RUN_STARTED（与 Desktop 对称）。
      // uiRunning 在 abort 单元，这里经注入的 getter 同步读取。
      const uiRunning = getUiRunningRef.current?.() ?? false;
      if (shouldIgnoreStaleRunStarted(uiRunning, activeRunIdRef.current)) {
        return;
      }
      syncActiveRunId(payload.runId);
      // 迟到的真 RUN_STARTED 也承担关窗（uiRunning 已被合成恢复置 true，
      // 不会被 stale 守卫拒收）——反填真实 runId 后立即恢复严格匹配。
      resumeWindowRef.current = false;
      uiActiveRef.current = true;
      onRunUiActivateRef.current?.();
    },
    [syncActiveRunId],
  );

  const onRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      // 守卫：runId 不匹配（含 endUiRunOnError 已清空 activeRunId 的迟到事件）则拒绝，
      // 避免二次递减导致 refcount 负数。
      if (!shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)) {
        return;
      }
      syncActiveRunId(null);
      uiActiveRef.current = false;
      onRunUiDeactivateRef.current?.();
      // refcount 单一归属：仅本单元 beginUiRun 加过计数才递减。子会话屏经
      // 恢复窗口反填接受的 FINISHED 属于父会话发起的 run（计数由父加），
      // 若在此也递减，会把父会话的计数提前扣空——窗口内全局忙门禁假开，
      // 父会话收尾的真实递减又被 ≤0 针位吞掉。
      if (refCountedRef.current) {
        refCountedRef.current = false;
        decrementAgentActive();
      }
    },
    [syncActiveRunId],
  );

  const onRunFailed = useCallback(
    (payload: AgentRunFailedPayload) => {
      // 同 onRunFinished：守卫拒绝迟到的 RUN_FAILED。
      if (!shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)) {
        return;
      }
      syncActiveRunId(null);
      uiActiveRef.current = false;
      onRunUiDeactivateRef.current?.();
      if (refCountedRef.current) {
        refCountedRef.current = false;
        decrementAgentActive();
      }
    },
    [syncActiveRunId],
  );

  const endUiRunOnError = useCallback(() => {
    // 幂等：未激活过 UI run 态时直接 return（比如还没 beginUiRun 就报错）。
    if (!uiActiveRef.current) {
      return;
    }
    syncActiveRunId(null);
    uiActiveRef.current = false;
    onRunUiDeactivateRef.current?.();
    if (refCountedRef.current) {
      refCountedRef.current = false;
      decrementAgentActive();
    }
  }, [syncActiveRunId]);

  const resetUiForSessionChange = useCallback(() => {
    syncActiveRunId(null);
    // session 切换：旧窗口随 reset 关闭；registry 仍注册 in-flight run 时开新窗。
    resumeWindowRef.current = getResumeWindowEligibleRef.current?.() ?? false;
  }, [syncActiveRunId]);

  return {
    activeRunId,
    beginUiRun,
    getBeginUiRunAt,
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
    endUiRunOnError,
    resetUiForSessionChange,
  };
}
