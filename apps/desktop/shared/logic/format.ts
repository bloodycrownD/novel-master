/**
 * Desktop renderer 对 `@novel-master/core/format` 的具名薄再导出。
 * 禁止 `export *`。
 */

export {
  buildStreamMetricsLine,
  formatCharCount,
  slidingTokenRate,
  createTokenRateSampler,
  SLIDING_TOKEN_RATE_WINDOW_MS,
  type TokenRateSample,
  type TokenRateSampler,
} from "@novel-master/core/format";
