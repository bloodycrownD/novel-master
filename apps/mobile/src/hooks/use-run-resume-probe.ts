/**
 * 「mount 恢复 + 收尾校准」双方向 run 探针 hook（mobile，主/子会话共用）。
 *
 * 从 SubagentSessionScreen 抽出：原来 mount 探测（sessionId 生效时查
 * abortRegistry.has → 合成 markRunStarted）内联在 Screen 里、收尾校准在
 * useSubagentRunProbe/useSubagentRunPolling——主会话需要同样的两个方向，
 * 抽成通用 hook 避免复制装配逻辑。
 *
 * - 恢复方向：sessionId 变化（含 mount）时查一次 isRunRegistered()，为 true
 *   则调 onRunActive()（调用方自行合成 markRunStarted / reload）。
 * - 收尾方向（防「生成中」永久残留）：app 回前台为主触发点、低频轮询为辅，
 *   逻辑复用 useSubagentRunProbe / useSubagentRunPolling（含复询防抖）。
 *
 * 本探针/轮询节点同时是 registry.has 的**唯一复评点**：core registry 只有
 * 同步 has() 查询、没有变更订阅，两次节点之间不感知 has 变化（明确接受的
 * 时序口径）；「has 变 false」不承担恢复窗口关窗，只用于收尾校准。
 *
 * 本 hook 不触碰 agent-activity refcount——refcount 归属发起方（主会话恢复
 * 不加 refcount，由 lifecycle 单元单一归属管理）。
 */
import {useEffect, useRef} from 'react';
import {
  useSubagentRunProbe,
  useSubagentRunPolling,
} from '@/screens/stack/useSubagentRunProbe';

export type UseRunResumeProbeParams = {
  readonly sessionId: string | undefined;
  /** 查 core abortRegistry 是否仍注册了该 sessionId 的 in-flight run。 */
  readonly isRunRegistered: () => boolean;
  /** 恢复方向：sessionId 生效且 isRunRegistered() 为 true 时调用。 */
  readonly onRunActive: () => void;
  /** 收尾方向：走与 RUN_FINISHED 相同的收尾路径（如 markRunEnded + reload）。 */
  readonly onRunEnded: () => void;
  /** React state 版 uiRunning，决定低频轮询是否启用。 */
  readonly uiRunning: boolean;
  /** 同步读 uiRunning（bus 回调/探针内部用，禁止读 React state）。 */
  readonly isRunActive: () => boolean;
};

export function useRunResumeProbe({
  sessionId,
  isRunRegistered,
  onRunActive,
  onRunEnded,
  uiRunning,
  isRunActive,
}: UseRunResumeProbeParams): void {
  // 恢复方向：仅 sessionId 生效（含 mount）时查询一次；两个回调用 ref 持最新，
  // 避免 effect 依赖回调重建而重复触发 mount 恢复。
  const isRunRegisteredRef = useRef(isRunRegistered);
  isRunRegisteredRef.current = isRunRegistered;
  const onRunActiveRef = useRef(onRunActive);
  onRunActiveRef.current = onRunActive;
  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    if (isRunRegisteredRef.current()) {
      onRunActiveRef.current();
    }
  }, [sessionId]);

  // 收尾方向：前台触发 + 低频轮询（内部含 800ms 复询防抖）。
  useSubagentRunProbe({isRunActive, isRunRegistered, onRunEnded});
  useSubagentRunPolling(uiRunning, isRunActive, isRunRegistered, onRunEnded);
}
