/**
 * LLM 流式请求空闲看门狗（**已退役，无接入方**）。
 *
 * 退役记录（2026-09-26，产品拍板）：流式的合法停顿（思考、工具调用非流段
 * 服务端憋生成——GLM `tool_stream` 默认 false 实锤、服务端排队）与死流无法
 * 区分，固定空闲阈值必然误杀；流式现无任何空闲自动超时，唯一自动兜底是
 * 整调用预算（callTimeout / whole-call），死流由用户手动终止（sseAbort）。
 * `llm-sse-transport.ts` 已移除本原语的装配与武装。
 *
 * 本文件与原语级测试保留（纯定时器工具，无外部依赖），供未来配置化
 * 空闲策略（如按 provider 开关）复用；`STREAM_IDLE_TIMEOUT_MS` 仍从
 * provider 子入口导出（allowlist 冻结面）。
 *
 * 原语义留档：构造时不启动定时器；任何响应数据到达经
 * {@link StreamWatchdog.noteActivity} 重置空闲 deadline，静默超过阈值回调
 * onTimeout。
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
