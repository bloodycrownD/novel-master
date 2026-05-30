/**
 * Per saved-model sampling profile (KKV-backed, not on AgentDefinition).
 *
 * @module domain/provider/model/model-sampling-profile
 */

import type { ModelSamplingParams } from "./model-sampling-params.js";

/** Persisted sampling profile for one applicationModelId. */
export interface ModelSamplingProfile {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly params?: ModelSamplingParams;
}
