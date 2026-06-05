/**
 * Saved (user-selected) LLM model.
 *
 * @module domain/provider/model/saved-model
 */

import type { SavedModelSettings } from "./saved-model-settings.js";

export interface SavedModel {
  readonly providerId: string;
  readonly vendorModelId: string;
  readonly displayName: string | null;
  readonly settings: SavedModelSettings;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
