export { formatCharCount } from "../domain/format/format-char-count.js";
export {
  buildStreamMetricsLine,
  formatStreamElapsed,
  type StreamMetricsLineInput,
} from "../domain/format/format-stream-metrics-line.js";
export {
  SLIDING_TOKEN_RATE_WINDOW_MS,
  createTokenRateSampler,
  slidingTokenRate,
  type TokenRateSample,
  type TokenRateSampler,
} from "../domain/format/sliding-token-rate.js";
export {
  parseStreamFinalRateSnapshot,
  serializeStreamFinalRateSnapshot,
  type StreamFinalRateSnapshot,
} from "../domain/format/stream-final-rate.js";
/**
 * 指标条 token 来源的中立类型（声明在 session-run-state 行模型，与
 * `SessionRunStateTokenSource` 同一份）：双端 hook 已消费本 barrel，就近
 * 转出，避免为一句类型新增子路径依赖。
 */
export type { StreamTokenSource } from "../domain/session-run-state/model/session-run-state.js";
