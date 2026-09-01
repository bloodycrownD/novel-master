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
 *
 * 实现约束：回调经 ref 转发、probe 引用恒定。调用方（ChatTabProvider 等）传的
 * 常是每次渲染新建的内联箭头函数，若 probe 随之重建，轮询 interval 会随任何无关
 * 重渲染（如流式计时条的 250ms ticker）反复拆建，30s 兜底永远走不完——这正是
 * 本兜底最该工作的 uiRunning 卡死场景。
 */
import {useEffect, useMemo, useRef} from 'react';
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

/** 探针函数：可直接调用触发一次校准；cancel() 清掉未决的复询定时器。 */
export type RunEndedProbe = {
  (): void;
  cancel(): void;
};

/**
 * 共享探针工厂：两个 hook（前台触发 / 轮询触发）复用同一段校准逻辑。
 *
 * 复询 setTimeout 的句柄存在工厂闭包的 reconfirmTimer 里（ref 语义），
 * 调用方须在 effect cleanup 里调 probe.cancel()，保证卸载后 800ms 内不会触发 onRunEnded。
 */
export function createRunEndedProbe({
  isRunActive,
  isRunRegistered,
  onRunEnded,
}: UseSubagentRunProbeParams): RunEndedProbe {
  let reconfirmTimer: ReturnType<typeof setTimeout> | null = null;
  const probe = () => {
    if (!isRunActive()) {
      return;
    }
    if (isRunRegistered()) {
      return;
    }
    // 第一次查到未注册：短延迟复询一次仍未注册才认定 run 真的结束。
    reconfirmTimer = setTimeout(() => {
      reconfirmTimer = null;
      if (!isRunActive()) {
        return;
      }
      if (isRunRegistered()) {
        return;
      }
      onRunEnded();
    }, SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS);
  };
  probe.cancel = () => {
    if (reconfirmTimer !== null) {
      clearTimeout(reconfirmTimer);
      reconfirmTimer = null;
    }
  };
  return probe;
}

/** 回调经 ref 转发：probe 引用恒定，不受调用方内联函数影响。 */
export function useSubagentRunProbe({
  isRunActive,
  isRunRegistered,
  onRunEnded,
}: UseSubagentRunProbeParams): void {
  // 回调存 ref：调用方传内联函数也不导致 AppState 订阅反复拆建。
  const callbacksRef = useRef({isRunActive, isRunRegistered, onRunEnded});
  callbacksRef.current = {isRunActive, isRunRegistered, onRunEnded};
  const probe = useMemo(
    () =>
      createRunEndedProbe({
        isRunActive: () => callbacksRef.current.isRunActive(),
        isRunRegistered: () => callbacksRef.current.isRunRegistered(),
        onRunEnded: () => callbacksRef.current.onRunEnded(),
      }),
    [],
  );

  // app 回前台为主触发点。
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        probe();
      }
    });
    return () => {
      sub.remove();
      probe.cancel();
    };
  }, [probe]);
}

/**
 * 低频轮询 effect（独立导出，由调用方按 uiRunning 决定是否启用）。
 *
 * 轮询只在 uiRunning 期间启动；uiRunning 翻 false 时清 interval。
 * 依赖收敛为 [uiRunning, probe]（probe 恒定）：无关重渲染不得拆建 interval，
 * 否则 30s 兜底在 uiRunning 卡死场景永远无法落地。
 *
 * @param uiRunning 用于决定轮询 interval 是否启动（false 时不轮询）。
 * @param isRunActive 同步读 uiRunning（probe 内部自行判断，禁止读 React state）。
 * @param isRunRegistered 查 core abortRegistry 是否仍注册了该 sessionId 的 run。
 * @param onRunEnded 走与 RUN_FINISHED 相同的收尾路径（markRunEnded + reload）。
 */
export function useSubagentRunPolling(
  uiRunning: boolean,
  isRunActive: () => boolean,
  isRunRegistered: () => boolean,
  onRunEnded: () => void,
): void {
  const callbacksRef = useRef({isRunActive, isRunRegistered, onRunEnded});
  callbacksRef.current = {isRunActive, isRunRegistered, onRunEnded};
  const probe = useMemo(
    () =>
      createRunEndedProbe({
        isRunActive: () => callbacksRef.current.isRunActive(),
        isRunRegistered: () => callbacksRef.current.isRunRegistered(),
        onRunEnded: () => callbacksRef.current.onRunEnded(),
      }),
    [],
  );

  useEffect(() => {
    if (!uiRunning) {
      return;
    }
    const timer = setInterval(probe, SUBAGENT_RUN_PROBE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      probe.cancel();
    };
  }, [uiRunning, probe]);
}
