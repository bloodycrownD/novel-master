import { useCallback, useEffect } from "react";
import { ipcAgentRunIsActive } from "@/ipc/client";
import { probeReadOnlyRunEnded } from "./readOnlyRunProbeLogic";

/**
 * readOnly 子面板「生成中」状态兜底轮询周期（毫秒）。
 *
 * 主路径靠 RUN_FINISHED/RUN_FAILED 事件翻 uiRunning；IPC 抖动、渲染重启或时序竞态
 * 可能丢事件，导致「生成中」永久残留。这里加一道校准：窗口重新可见为主，低频轮询为辅，
 * 主动跨进程查 main 的 in-flight 状态。
 */
export const READONLY_RUN_PROBE_INTERVAL_MS = 30_000;

export type UseReadOnlyRunProbeParams = {
  /** 仅在 readOnly 分支挂载监听。 */
  enabled: boolean;
  /** 子会话 sessionId（readOnly 子面板的 session）。 */
  sessionId: string | undefined;
  /** 同步读 uiRunning（false 时跳过校准，主路径已处理）。 */
  isRunActive(): boolean;
  /** 走与 readOnlyOnRunFinished 相同的收尾路径（markExternalRunEnded + onStreamReset + reload）。 */
  onRunEnded(): void;
};

/**
 * readOnly 子面板「生成中」兜底校准 hook。
 *
 * 跨进程查 main 的 in-flight 状态（ipcAgentRunIsActive），比 mobile 的 registry
 * 查询语义更强；但 IPC 仍可能短暂抖动，所以查到 false 后短延迟复询一次仍 false 才收尾。
 *
 * 核心校准逻辑抽到 {@link probeReadOnlyRunEnded}（纯异步函数），便于在 node:test 下
 * 直接测「IPC 返回 false + 复询仍 false → 调收尾」的语义（T-G2-desktop）。
 *
 * 触发点：
 * - document visibilitychange（窗口重新可见）为主
 * - 低频轮询（READONLY_RUN_PROBE_INTERVAL_MS）为辅，仅 uiRunning 期间启动
 */
export function useReadOnlyRunProbe({
  enabled,
  sessionId,
  isRunActive,
  onRunEnded,
}: UseReadOnlyRunProbeParams): void {
  const probe = useCallback(() => {
    if (!enabled || sessionId == null) {
      return;
    }
    if (!isRunActive()) {
      return;
    }
    void probeReadOnlyRunEnded({
      sessionId,
      isActive: () => isRunActive(),
      queryActive: (sid) => ipcAgentRunIsActive({ sessionId: sid }),
      onRunEnded,
    });
  }, [enabled, sessionId, isRunActive, onRunEnded]);

  // 窗口重新可见为主触发点。
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = () => {
      if (document.visibilityState === "visible") {
        probe();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [enabled, probe]);

  // 低频轮询为辅：enabled 且 uiRunning 期间周期查。
  useEffect(() => {
    if (!enabled || !isRunActive()) {
      return;
    }
    const timer = setInterval(probe, READONLY_RUN_PROBE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, isRunActive, probe]);
}
