/**
 * LLM 流式超时错误：watchdog 任一 deadline 到点时由传输层以本错误 settle
 * 请求 Promise（先抢占 settle、再 abort 断流，时序见 `llm-sse-transport.ts`）。
 *
 * 分级语义（spec llm-stream-timeout 第 4 节）：
 * - `first-chunk`：首字前超时，无任何输出、无副作用 → `isRetryableError` 判 true，
 *   与 429/5xx 同列按既有重试上限/退避执行；
 * - `idle`：流中断，已有部分输出 → 不自动重试（避免重复输出/计费），错误上抛
 *   走 runner 主 catch → 既有失败收尾链（[生成失败] 占位 + FAILED 事件）。
 *
 * 依赖链（实施与测试须共同保持）：本错误三条均不命中
 * `request-abort.ts` 的 `isRequestAborted` 判 true 条件——signal 未 abort、
 * name 非 "AbortError"、非 ProviderError——因此 adapter catch 走 rethrow，
 * 不会被吞成 partial 正常完成。
 *
 * @module infra/llm-protocol/logic/llm-stream-timeout-error
 */

import type { StreamWatchdogPhase } from "./stream-watchdog.js";

/** 超时错误统一 name（区别于 AbortError，防止被识别为用户取消）。 */
export const LLM_STREAM_TIMEOUT_ERROR_NAME = "LlmStreamTimeoutError";

export class LlmStreamTimeoutError extends Error {
  /** 超时阶段：首字前（可重试）/ 流空闲（不重试）。 */
  readonly phase: StreamWatchdogPhase;

  constructor(phase: StreamWatchdogPhase, timeoutMs: number) {
    super(
      phase === "first-chunk"
        ? `LLM stream timed out after ${timeoutMs}ms waiting for the first chunk`
        : `LLM stream idle for ${timeoutMs}ms after the last chunk`
    );
    this.name = LLM_STREAM_TIMEOUT_ERROR_NAME;
    this.phase = phase;
  }
}
