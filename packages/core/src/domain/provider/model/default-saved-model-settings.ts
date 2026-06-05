/**
 * Default per-model settings for save/create/backfill.
 *
 * @module domain/provider/model/default-saved-model-settings
 */

import { seedContextWindowTokens } from "@/infra/tokenizer/logic/seed-context-window-tokens.js";
import type { SavedModelSettings } from "./saved-model-settings.js";

/**
 * Default settings for a vendor model id (context window from seed map).
 *
 * @param vendorModelId Provider model name.
 */
export function defaultSavedModelSettings(vendorModelId: string): SavedModelSettings {
  return {
    schemaVersion: 1,
    contextWindowTokens: seedContextWindowTokens(vendorModelId),
    sampling: { enabled: false },
  };
}
