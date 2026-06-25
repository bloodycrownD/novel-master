/**
 * 新建/回填时的默认 per-model 设置。
 *
 * @module domain/provider/model/default-saved-model-settings
 */

import { seedContextWindowTokens } from "@/infra/tokenizer/logic/seed-context-window-tokens.js";
import type { SavedModelSettings } from "./saved-model-settings.js";

/**
 * 按 vendor model id 生成默认设置（上下文窗口来自 seed map）。
 *
 * @param vendorModelId Provider 模型名。
 */
export function defaultSavedModelSettings(vendorModelId: string): SavedModelSettings {
  return {
    schemaVersion: 2,
    internal: {
      contextWindowTokens: seedContextWindowTokens(vendorModelId),
      tokenCounterMode: "auto",
    },
    generation: {
      sampling: { enabled: false },
      thinking: { enabled: false },
    },
  };
}
