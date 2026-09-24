/**
 * LLM 流式请求空闲看门狗（回炉版：仅 idle，无首字臂）。
 *
 * 传输无关的纯定时器原语：构造时不启动任何定时器（首字阶段不设自动
 * 超时——缓冲型模型首字可远超任何阈值，spec llm-stream-timeout 回炉
 * 拍板）；任何响应数据到达（XHR onprogress / fetch reader.read 返回）
 * 经 {@link StreamWatchdog.noteActivity} 重置空闲 deadline，静默超过
 * 阈值回调 onTimeout，调用方负责以超时错误 settle 请求 Promise、再
 * abort 断流清理（时序见 `llm-sse-transport.ts` 的装配注释）。
 *
 * 首字阶段的黑洞（请求发出后 0 字节）由传输层的整调用兜底覆盖
 * （XHR `xhr.timeout` / fetch whole-call 定时器，映射 OkHttp
 * callTimeout），不在本原语职责内。
 *
 * 阈值取舍：空闲 30s——用户节奏「十几秒手动重试」下 30s 是流中静默的
 * 安全下限（thinking 模型连接建立后 delta 持续流出不受影响）。常量导出
 * 便于热调，暂不做 provider 级配置。
 *
 * @module infra/llm-protocol/logic/stream-watchdog
 */

/** 流空闲超时默认值：距上一 chunk 的最长静默间隔。 */
export const STREAM_IDLE_TIMEOUT_MS = 30_000;

export interface StreamWatchdog {
  /**
   * 收到任何响应数据时调用（含空 chunk）：重置空闲定时器。
   * onTimeout 触发或 dispose 后调用为空操作（看门狗已进入终态）。
   */
  noteActivity(): void;
  /** 清空全部定时器并进入终态（请求正常收尾 / 错误清理路径调用，幂等）。 */
  dispose(): void;
}

export interface StreamWatchdogOptions {
  /** 流空闲超时阈值，默认 {@link STREAM_IDLE_TIMEOUT_MS}。 */
  readonly idleTimeoutMs?: number;
  /** 空闲 deadline 到点时回调一次；此后看门狗进入终态，不再触发。 */
  readonly onTimeout: () => void;
}

/**
 * 创建空闲看门狗。构造时不启动定时器——首个 {@link StreamWatchdog.noteActivity}
 * 才武装空闲 deadline。纯 `setTimeout` 实现，fake timers 可直测。
 */
export function createStreamWatchdog(
  options: StreamWatchdogOptions
): StreamWatchdog {
  const idleTimeoutMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const clearIdleTimer = (): void => {
    if (idleTimer != null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  return {
    noteActivity(): void {
      if (fired) {
        return;
      }
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (fired) {
          return;
        }
        fired = true;
        options.onTimeout();
      }, idleTimeoutMs);
    },

    dispose(): void {
      // dispose 即终态：与 onTimeout 触发同级——此后迟到的 noteActivity
      // （正常收尾后偶发的活动回调）不得重启空闲定时器造成泄漏。
      fired = true;
      clearIdleTimer();
    },
  };
}
