/**
 * Desktop renderer 对 `@novel-master/core/format` 的具名薄再导出。
 * 禁止 `export *`。
 *
 * `formatStreamElapsed`（秒数文案）取 core 唯一实现——desktop hook 不再保留
 * 本地副本（C-2：两端 hook 无本地 elapsed 实现）。
 */

export {
  buildStreamMetricsLine,
  formatCharCount,
  formatStreamElapsed,
  slidingTokenRate,
  createTokenRateSampler,
  createIncrementalTokenCounter,
  SLIDING_TOKEN_RATE_WINDOW_MS,
  type StreamTokenSource,
  type TokenRateSample,
  type TokenRateSampler,
  type IncrementalTokenCounter,
} from "@novel-master/core/format";
