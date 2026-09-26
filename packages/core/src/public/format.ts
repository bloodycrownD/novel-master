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
 * 「基线 + 增量」读值口径的两个纯函数（stream-metrics-native ①）：双端
 * 单元 / hook 共用的单点声明，避免同一公式各写一遍、命名各写一套。
 */
export {
  composeStreamTokens,
  reanchorStreamTokenBase,
} from "../domain/format/stream-token-anchor.js";
/**
 * 尾窗增量 token 计数器（stream-metrics-native ②）：双端实时 token 估算的
 * 共用纯逻辑（宿主注入 encode 绑定）。声明在 infra/tokenizer/logic，经本
 * barrel 就近转出，避免新增子路径依赖。
 */
export {
  DEFAULT_COMMIT_STEP_CHARS,
  DEFAULT_LOOKBACK_CHARS,
  DEFAULT_TAIL_CHARS,
  createIncrementalTokenCounter,
  type IncrementalTokenCounter,
  type IncrementalTokenCounterDeps,
} from "../infra/tokenizer/logic/incremental-token-counter.js";
/**
 * 指标条 token 来源的中立类型（声明在 session-run-state 行模型，与
 * `SessionRunStateTokenSource` 同一份）：双端 hook 已消费本 barrel，就近
 * 转出，避免为一句类型新增子路径依赖。
 */
export type { StreamTokenSource } from "../domain/session-run-state/model/session-run-state.js";
