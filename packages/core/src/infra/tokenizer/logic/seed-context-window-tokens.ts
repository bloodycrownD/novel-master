/**
 * Seeds per-model context window from vendor id map (save/backfill only).
 *
 * WHY: runtime bar/compaction read persisted settings; map is not a runtime fallback.
 *
 * @module infra/tokenizer/logic/seed-context-window-tokens
 */

import { DEFAULT_CONTEXT_WINDOW_TOKENS } from "./context-window-map.js";
import { ContextWindow } from "./resolve-context-window.js";

export const ContextWindowSeed = {
  /**
   * Context window for new/backfilled saved models when no user override exists.
   *
   * @param vendorModelId Provider model name.
   *
   * nm-style: keep-local — 新建/回填模型的上下文窗口默认值回落口径
   */
  seed(vendorModelId: string): number {
    return (
      ContextWindow.resolve(vendorModelId) ?? DEFAULT_CONTEXT_WINDOW_TOKENS
    );
  },
} as const;
