/**
 * 收尾校准探针（最小版，Step 7 自 use-run-resume-probe 收尾方向迁入）。
 *
 * 主路径靠 RUN_FINISHED/RUN_FAILED 事件收尾单元；但 IPC 抖动、渲染重启
 * 或时序竞态可能丢事件，导致「生成中」永久残留（单元卡 running、refcount
 * 不归零）。本探针在事件驱动之外加一道校准：低频轮询（默认 30s）+
 * 调用方手动触发（manager 接 AppState 回前台），对活跃会话查 core
 * abortRegistry——两次查询（复询防抖）都无注册即认定 run 已死，走
 * onRunLost 收尾。
 *
 * 与旧探针的差异（恢复方向随单元水合消失）：
 * - 无恢复方向——重启现场由 Step 5 的持久层水合恢复，mount 探测退役；
 * - 无 React 依赖——纯服务（React 树外），由 SessionStreamUnitManager
 *   装配并接线，回调用 ref 持有的需求不复存在（manager 恒定）；
 * - 校准对象只含已回填 runId 的 running 单元（manager 侧过滤）——
 *   starting（受理空窗内 registry 尚未注册）不参与，防误杀；starting
 *   死单由 startRun 的 promise 链尾 finally 兜底。
 *
 * 复询防抖的原因：mobile 查的是本进程内存里的 core registry 注册状态，
 * run 被 main 主动结束、unregister 事件还没派发到 renderer 时，has 可能
 * 短暂仍返回 true；反过来第一次查到未注册也可能只是注册在途——短延迟
 * 复查一次仍 false 才收尾。
 *
 * @module services/run-finish-calibration-probe
 */

/** 兜底轮询周期（毫秒）。事件驱动为主，30s 足够。 */
export const RUN_FINISH_CALIBRATION_INTERVAL_MS = 30_000;
/** 复询防抖延迟：第一次 false 后短延迟再查一次仍 false 才收尾。 */
export const RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS = 800;

export interface RunFinishCalibrationProbeParams {
  /** 待校准的活跃会话列举（调用方过滤——manager 只给 runId 已回填的 running 单元）。 */
  readonly activeSessionIds: () => readonly string[];
  /** 查 core abortRegistry 是否仍注册了该会话的 in-flight run。 */
  readonly isRunRegistered: (sessionId: string) => boolean;
  /** 校准收尾：走与事件丢失的 FINISHED/FAILED 等效的收尾路径。 */
  readonly onRunLost: (sessionId: string) => void;
  /** 轮询周期（测试覆盖用；缺省 RUN_FINISH_CALIBRATION_INTERVAL_MS）。 */
  readonly intervalMs?: number;
  /** 复询防抖延迟（测试覆盖用；缺省 RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS）。 */
  readonly reconfirmDelayMs?: number;
}

export interface RunFinishCalibrationProbe {
  /** 触发一次校准（轮询周期到 / 前台回焦等外部触发点共用）。 */
  calibrate(): void;
  /**
   * 启停轮询（幂等）：存在待校准会话时开启、全部收尾后关闭——空闲期
   * 不留常驻 interval（测试/析构场景零残留）。手动 calibrate() 不受
   * 轮询开关影响。
   */
  setPollingEnabled(enabled: boolean): void;
  /** 全量清理：停轮询、清掉全部未决的复询定时器（之后不再触发 onRunLost）。 */
  dispose(): void;
}

/**
 * 创建收尾校准探针。轮询 interval 惰性启停（setPollingEnabled）——
 * 无待校准会话时不占任何常驻定时器；per-session 复询定时器去重排程，
 * 同一会话在复询未决期间不重复排入。
 */
export function createRunFinishCalibrationProbe(
  params: RunFinishCalibrationProbeParams,
): RunFinishCalibrationProbe {
  const intervalMs = params.intervalMs ?? RUN_FINISH_CALIBRATION_INTERVAL_MS;
  const reconfirmDelayMs =
    params.reconfirmDelayMs ?? RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS;
  /** per-session 复询定时器（未决期间防重复排程）。 */
  const reconfirmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let pollingInterval: ReturnType<typeof setInterval> | null = null;

  const clearReconfirm = (sessionId: string): void => {
    const timer = reconfirmTimers.get(sessionId);
    if (timer != null) {
      clearTimeout(timer);
      reconfirmTimers.delete(sessionId);
    }
  };

  const calibrate = (): void => {
    for (const sessionId of params.activeSessionIds()) {
      if (params.isRunRegistered(sessionId)) {
        continue;
      }
      // 第一次查到未注册：已排复询则等待，否则排入。
      if (reconfirmTimers.has(sessionId)) {
        continue;
      }
      const timer = setTimeout(() => {
        reconfirmTimers.delete(sessionId);
        // 复询仍要过活跃 + 注册两道关：期间 run 可能正常结束（事件路径
        // 已收尾、activeSessionIds 不再包含）或 registry 已补注册。
        if (!params.activeSessionIds().includes(sessionId)) {
          return;
        }
        if (params.isRunRegistered(sessionId)) {
          return;
        }
        params.onRunLost(sessionId);
      }, reconfirmDelayMs);
      reconfirmTimers.set(sessionId, timer);
    }
  };

  return {
    calibrate,
    setPollingEnabled(enabled: boolean): void {
      if (enabled && pollingInterval == null) {
        pollingInterval = setInterval(calibrate, intervalMs);
      } else if (!enabled && pollingInterval != null) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    },
    dispose(): void {
      if (pollingInterval != null) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      for (const sessionId of [...reconfirmTimers.keys()]) {
        clearReconfirm(sessionId);
      }
    },
  };
}
