/**
 * Desktop renderer 对 `@novel-master/core/format` 的具名薄再导出。
 * 禁止 `export *`。
 *
 * `formatStreamElapsed`（秒数文案）取 core 唯一实现——desktop hook 不再保留
 * 本地副本（C-2：两端 hook 无本地 elapsed 实现）。
 *
 * core 的 `buildStreamMetricsLine` 已返回 parts（prefix/elapsed/body，G3.6）：
 * 本层补 `formatStreamMetricsLineText` 把 parts 翻译拼成整行 string，双端
 * hook 消费。
 */

import { buildStreamMetricsLine, type StreamMetricsLineInput, type StreamMetricsLineParts } from "@novel-master/core/format";
import { coreT } from "./core-i18n.js";

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
  type StreamMetricsLineInput,
  type StreamMetricsLineParts,
  composeStreamTokens,
  reanchorStreamTokenBase,
} from "@novel-master/core/format";

/** metrics 条整行：`{prefix} · {elapsed} · {body}`（descriptor 经 coreT 翻译）。 */
// nm-style: keep-public — desktop shared/logic 是 renderer 唯一的 core-descriptor→string 翻译边界（apps/desktop/renderer 零 `@novel-master/core` import）；唯一调用方 renderer hook 经本层拿整行 string，内联会把它拉回直连 core + translator。
export function formatStreamMetricsLineText(metrics: StreamMetricsLineInput): string {
  const parts: StreamMetricsLineParts = buildStreamMetricsLine(metrics);
  return `${coreT(parts.prefix)} · ${parts.elapsed} · ${coreT(parts.body)}`;
}

