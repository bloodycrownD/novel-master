/**
 * Model sampling profile persistence port (KKV `nm-model-sampling`).
 *
 * @module service/provider/model-sampling-profile.port
 */

import type { ModelSamplingProfile } from "@/domain/provider/model/model-sampling-profile.js";

/** Read/write per saved-model sampling profiles. */
export interface ModelSamplingProfileService {
  /** Returns profile or `null` when no KKV record exists. */
  getProfile(applicationModelId: string): Promise<ModelSamplingProfile | null>;

  setProfile(applicationModelId: string, profile: ModelSamplingProfile): Promise<void>;

  clearProfile(applicationModelId: string): Promise<void>;
}
