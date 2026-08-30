/**
 * Session abort 单元：uiRunning + freezeCount + abortRetainPending 状态机。
 *
 * 从 {@link useAgentRunLifecycle} 拆出来的 abort 相关状态——只关心
 * 「用户/系统按下停止」「run 自然结束」时 uiRunning 与 freeze/retain 的转换，
 * 以及调用 {@link AgentAbortRegistry.abort} 触发 Core 层中断。
 *
 * 与 stream 单元的双向依赖（abort 触发后要清掉半成品 stream text）通过
 * `onStreamResetRef` 解耦：Provider 先实例化本单元并传一个占位 ref，
 * 再实例化 stream 单元，把 stream 输出的 handleStreamReset 写入同一个 ref，
 * 这样本单元调 `onStreamResetRef.current()` 即可，两个单元不直接 import。
 *
 * `getTranscriptFreezeCount()` 以 getter 形态暴露（不是 state）：
 * freeze 计数会被高频 bus 回调读取，state 读取会触发额外的 React 订阅/重渲染开销，
 * 换成 getter 后调用方拿到的总是最新值，bus 回调里读它零成本。
 */
import {useCallback, useRef, useState} from 'react';
import type {MutableRefObject} from 'react';
import type {AgentAbortRegistry} from '@novel-master/core/agent';

export type UseSessionAbortParams = {
  sessionId: string | undefined;
  /** Core abort registry；停止按钮经此触发 Core 层中断。 */
  abortRegistry: AgentAbortRegistry | undefined;
  /**
   * stream 单元写入的 reset 回调 ref。
   *
   * 初始为 no-op，stream 单元 mount 后由 Provider 把它的 handleStreamReset
   * 赋给 `onStreamResetRef.current`。abort 状态机调用 `onStreamResetRef.current()`
   * 即可清掉半成品 stream text，避免两个单元互相 import。
   */
  onStreamResetRef: MutableRefObject<() => void>;
};

export type UseSessionAbortResult = {
  readonly uiRunning: boolean;
  /** 同步读 uiRunning（bus 回调须用此，禁止读 React state）。 */
  getUiRunning(): boolean;
  /** 用户停止：uiRunning=false + retain=true + freeze=snapshot + abortRegistry.abort。 */
  abortUiRun(freezeAt?: number): void;
  /** 同步读 abort 时快照的消息条数；非 null 时禁止增列表 reload（abort retain 例外）。 */
  getTranscriptFreezeCount(): number | null;
  /** abort 后等待一次 assistant STEP reload / FINISHED fallback。 */
  getAbortRetainPending(): boolean;
  /** retain reload 或 FINISHED fallback 完成后清除。 */
  clearAbortRetainPending(): void;
  /** lifecycle 的 onRunStarted / beginUiRun 调用：uiRunning=true + 清 freeze/retain。 */
  markRunStarted(): void;
  /** lifecycle 的 onRunFinished / onRunFailed 调用：uiRunning=false + 清 freeze。 */
  markRunEnded(): void;
  /** session 切换：uiRunning=false + 清 freeze/retain + 触发 onStreamReset（清半成品 stream）。 */
  resetForSessionChange(): void;
};

export function useSessionAbort({
  sessionId,
  abortRegistry,
  onStreamResetRef,
}: UseSessionAbortParams): UseSessionAbortResult {
  const [uiRunning, setUiRunning] = useState(false);
  const uiRunningRef = useRef(false);
  const transcriptFreezeCountRef = useRef<number | null>(null);
  const abortRetainPendingRef = useRef(false);

  const setUiRunningSynced = useCallback((next: boolean) => {
    uiRunningRef.current = next;
    setUiRunning(next);
  }, []);

  const getUiRunning = useCallback((): boolean => uiRunningRef.current, []);

  const getTranscriptFreezeCount = useCallback(
    (): number | null => transcriptFreezeCountRef.current,
    [],
  );

  const getAbortRetainPending = useCallback(
    (): boolean => abortRetainPendingRef.current,
    [],
  );

  const clearAbortRetainPending = useCallback((): void => {
    abortRetainPendingRef.current = false;
  }, []);

  const abortUiRun = useCallback(
    (freezeAt?: number) => {
      setUiRunningSynced(false);
      abortRetainPendingRef.current = true;
      transcriptFreezeCountRef.current = freezeAt ?? null;
      // defer onStreamReset 至 retain reload 或 FINISHED fallback。
      // 这里不直接调 onStreamResetRef.current()，由 step/finished 事件路径触发。
      if (sessionId != null) {
        abortRegistry?.abort(sessionId);
      }
    },
    [abortRegistry, sessionId, setUiRunningSynced],
  );

  const markRunStarted = useCallback(() => {
    transcriptFreezeCountRef.current = null;
    abortRetainPendingRef.current = false;
    setUiRunningSynced(true);
  }, [setUiRunningSynced]);

  const markRunEnded = useCallback(() => {
    transcriptFreezeCountRef.current = null;
    setUiRunningSynced(false);
  }, [setUiRunningSynced]);

  const resetForSessionChange = useCallback(() => {
    transcriptFreezeCountRef.current = null;
    abortRetainPendingRef.current = false;
    setUiRunningSynced(false);
    // session 切换时主动清掉半成品 stream text（stream 单元注入实现）。
    onStreamResetRef.current();
  }, [onStreamResetRef, setUiRunningSynced]);

  return {
    uiRunning,
    getUiRunning,
    abortUiRun,
    getTranscriptFreezeCount,
    getAbortRetainPending,
    clearAbortRetainPending,
    markRunStarted,
    markRunEnded,
    resetForSessionChange,
  };
}
