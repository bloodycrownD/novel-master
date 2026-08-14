/**
 * 子会话「生成中」状态兜底 hook（mobile）。
 *
 * 主路径靠 RUN_FINISHED/RUN_FAILED 事件翻 uiRunning；但 IPC 抖动、渲染重启
 * 或时序竞态可能丢事件，导致「生成中」永久残留。本 hook 在事件驱动之外加一道校准：
 *
 * - app 回前台（AppState active）为主触发点
 * - 低频轮询（SUBAGENT_RUN_PROBE_INTERVAL_MS）为辅
 *
 * 校准逻辑：当 uiRunning 为 true 时查 isRunRegistered()，若返回 false 则短延迟
 * 复询一次仍 false，认定 run 已结束，调 onRunEnded() 走收尾。
 *
 * 复询防抖的原因：mobile 查的是本进程内存里的 core registry 注册状态，
 * run 被 main 主动结束、unregister 事件还没派发到 renderer 时，has 可能短暂仍返回 true。
 */
import {useCallback, useEffect} from 'react';
import {AppState} from 'react-native';

/** 兜底轮询周期（毫秒）。visibility 为主，轮询为辅，30s 足够。 */
export const SUBAGENT_RUN_PROBE_INTERVAL_MS = 30_000;
/** 复询防抖延迟：第一次 false 后短延迟再查一次仍 false 才收尾。 */
export const SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS = 800;

export type UseSubagentRunProbeParams = {
  /** 同步读 uiRunning（bus 回调须用此，禁止读 React state）。 */
  isRunActive(): boolean;
  /** 查 core abortRegistry 是否仍注册了该 sessionId 的 in-flight run。 */
  isRunRegistered(): boolean;
  /** 走与 RUN_FINISHED 相同的收尾路径（markRunEnded + reload）。 */
  onRunEnded(): void;
};

/**
 * @param uiRunning 用于决定轮询 interval 是否启动（false 时不轮询）。
 *                  AppState 监听始终挂载，但 probe 内部会读 isRunActive() 自行判断。
 */
export function useSubagentRunProbe({
  isRunActive,
  isRunRegistered,
  onRunEnded,
}: UseSubagentRunProbeParams): void {
  const probe = useCallback(() => {
    if (!isRunActive()) {
      return;
    }
    if (isRunRegistered()) {
      return;
    }
    // 第一次查到未注册：短延迟复询一次仍未注册才认定 run 真的结束。
    setTimeout(() => {
      if (!isRunActive()) {
        return;
      }
      if (isRunRegistered()) {
        return;
      }
      onRunEnded();
    }, SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS);
  }, [isRunActive, isRunRegistered, onRunEnded]);

  // app 回前台为主触发点。
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        probe();
      }
    });
    return () => sub.remove();
  }, [probe]);
}

/**
 * 低频轮询 effect（独立导出，由调用方按 uiRunning 决定是否启用）。
 *
 * 轮询只在 uiRunning 期间启动；uiRunning 翻 false 时清 interval。
 */
export function useSubagentRunPolling(
  uiRunning: boolean,
  isRunActive: () => boolean,
  isRunRegistered: () => boolean,
  onRunEnded: () => void,
): void {
  const probe = useCallback(() => {
    if (!isRunActive()) {
      return;
    }
    if (isRunRegistered()) {
      return;
    }
    setTimeout(() => {
      if (!isRunActive()) {
        return;
      }
      if (isRunRegistered()) {
        return;
      }
      onRunEnded();
    }, SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS);
  }, [isRunActive, isRunRegistered, onRunEnded]);

  useEffect(() => {
    if (!uiRunning) {
      return;
    }
    const timer = setInterval(probe, SUBAGENT_RUN_PROBE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [uiRunning, probe]);
}
