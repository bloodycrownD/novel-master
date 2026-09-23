/**
 * LLM 流式请求双 deadline 看门狗（首字 / 流空闲）。
 *
 * 传输无关的纯定时器原语：请求发出即启动首字 deadline；任何响应数据到达
 * （XHR onprogress / fetch reader.read 返回）经 {@link StreamWatchdog.noteActivity}
 * 撤销首字阶段并重置空闲 deadline。任一 deadline 到点回调 onTimeout，
 * 调用方负责以超时错误 settle 请求 Promise、再 abort 断流清理（时序见
 * `llm-sse-transport.ts` 的装配注释）。
 *
 * 阈值取舍（spec llm-stream-timeout 第 1 节）：空闲 90s 覆盖慢速模型与
 * thinking 静默段（连接建立后 thinking delta 持续流出，不触发）；首字 120s
 * 覆盖网关排队 / 上游建连 / 中转缓冲等请求建立阶段的整体静默，取保守大值
 * 避免误杀重负载时段。两常量导出便于热调，暂不做 provider 级配置。
 *
 * @module infra/llm-protocol/logic/stream-watchdog
 */

/** 首字超时默认值：请求发出后无任何响应数据的最长等待（thinking 模型首字慢）。 */
export const FIRST_CHUNK_TIMEOUT_MS = 120_000;

/** 流空闲超时默认值：距上一 chunk 的最长静默间隔。 */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;

/** 超时阶段：首字前（无任何输出，可重试）/ 流空闲（已有部分输出，不重试）。 */
export type StreamWatchdogPhase = "first-chunk" | "idle";

export interface StreamWatchdog {
  /**
   * 收到任何响应数据时调用（含空 chunk）：撤销首字阶段并重置空闲定时器。
   * onTimeout 触发或 dispose 后调用为空操作（看门狗已进入终态）。
   */
  noteActivity(): void;
  /** 清空全部定时器并进入终态（请求正常收尾 / 错误清理路径调用，幂等）。 */
  dispose(): void;
}

export interface StreamWatchdogOptions {
  /** 首字超时阈值，默认 {@link FIRST_CHUNK_TIMEOUT_MS}。 */
  readonly firstChunkTimeoutMs?: number;
  /** 流空闲超时阈值，默认 {@link STREAM_IDLE_TIMEOUT_MS}。 */
  readonly idleTimeoutMs?: number;
  /** 任一 deadline 到点时回调一次；此后看门狗进入终态，不再触发。 */
  readonly onTimeout: (phase: StreamWatchdogPhase) => void;
}

/**
 * 创建双 deadline 看门狗。构造即启动首字 deadline——调用方应在发出请求的
 * 同一时刻创建。纯 `setTimeout` 实现，fake timers 可直测。
 */
export function createStreamWatchdog(
  options: StreamWatchdogOptions
): StreamWatchdog {
  const firstChunkTimeoutMs =
    options.firstChunkTimeoutMs ?? FIRST_CHUNK_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;

  let firstChunkTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const clearFirstChunkTimer = (): void => {
    if (firstChunkTimer != null) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
  };
  const clearIdleTimer = (): void => {
    if (idleTimer != null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  firstChunkTimer = setTimeout(() => {
    firstChunkTimer = null;
    if (fired) {
      return;
    }
    fired = true;
    options.onTimeout("first-chunk");
  }, firstChunkTimeoutMs);

  return {
    noteActivity(): void {
      if (fired) {
        return;
      }
      // 首个数据到达即宣告首字阶段结束；此后只有空闲 deadline。
      clearFirstChunkTimer();
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (fired) {
          return;
        }
        fired = true;
        options.onTimeout("idle");
      }, idleTimeoutMs);
    },

    dispose(): void {
      // dispose 即终态：与 onTimeout 触发同级——此后迟到的 noteActivity
      // （正常收尾后偶发的活动回调）不得重启空闲定时器造成泄漏。
      fired = true;
      clearFirstChunkTimer();
      clearIdleTimer();
    },
  };
}
