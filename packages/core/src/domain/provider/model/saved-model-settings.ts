/**
 * Per saved-model settings persisted in `llm_saved_model.settings_json`.
 *
 * @module domain/provider/model/saved-model-settings
 */

import type { ModelSamplingParams } from "./model-sampling-params.js";

/** Sampling subsection of {@link SavedModelSettings}. */
export interface SavedModelSamplingSettings {
  readonly enabled: boolean;
  readonly params?: ModelSamplingParams;
}

/** Context window + sampling for one saved model. */
export interface SavedModelSettings {
  readonly schemaVersion: 1;
  readonly contextWindowTokens: number;
  readonly sampling: SavedModelSamplingSettings;
}

/** Partial update for {@link SavedModelSettings}. */
export interface SavedModelSettingsPatch {
  readonly contextWindowTokens?: number;
  readonly sampling?: SavedModelSamplingSettings;
}
