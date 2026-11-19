export { StreamMetricsLine } from "../domain/format/format-stream-metrics-line.js";
export type { StreamMetricsLineInput, StreamMetricsLineParts } from "../domain/format/format-stream-metrics-line.js";
export {
  SLIDING_TOKEN_RATE_WINDOW_MS,
  SlidingTokenRate,
  type TokenRateSampler,
} from "../domain/format/sliding-token-rate.js";
export { StreamFinalRate } from "../domain/format/stream-final-rate.js";
/**
 * 「基线 + 增量」读值口径的两个纯函数（stream-metrics-native ①）：双端
 * 单元 / hook 共用的单点声明，避免同一公式各写一遍、命名各写一套。
 */
export { StreamTokenAnchor } from "../domain/format/stream-token-anchor.js";
