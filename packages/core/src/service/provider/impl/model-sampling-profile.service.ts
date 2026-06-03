/**
 * Default {@link ModelSamplingProfileService} backed by internal KKV.
 *
 * KKV key: `profile/{applicationModelId}` (slash preserved, same as model id).
 *
 * @module service/provider/impl/model-sampling-profile.service
 */

import {
  modelSamplingProfileFromJson,
  modelSamplingProfileToJson,
} from "@/domain/provider/model/model-sampling-profile-from-json.js";
import type { ModelSamplingProfile } from "@/domain/provider/model/model-sampling-profile.js";
import { ProviderError } from "@/errors/provider-errors.js";
import { isKkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { ModelSamplingProfileService } from "../model-sampling-profile.port.js";

/** KKV module for per-model sampling profiles (not agent YAML). */
const MODULE = "nm-model-sampling";

function profileKey(applicationModelId: string): string {
  return `profile/${applicationModelId}`;
}

/** Persists sampling profiles in novel.db KKV. */
export class DefaultModelSamplingProfileService implements ModelSamplingProfileService {
  constructor(private readonly kkv: KkvService) {}

  async getProfile(applicationModelId: string): Promise<ModelSamplingProfile | null> {
    const raw = await this.getRaw(applicationModelId);
    if (raw === undefined) {
      return null;
    }
    try {
      return modelSamplingProfileFromJson(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        "INVALID_ARGUMENT",
        error instanceof Error ? error.message : "invalid profile JSON",
      );
    }
  }

  async setProfile(
    applicationModelId: string,
    profile: ModelSamplingProfile,
  ): Promise<void> {
    const json = JSON.stringify(modelSamplingProfileToJson(profile));
    await this.kkv.set(MODULE, profileKey(applicationModelId), json);
  }

  async clearProfile(applicationModelId: string): Promise<void> {
    try {
      await this.kkv.delete(MODULE, profileKey(applicationModelId));
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }

  private async getRaw(applicationModelId: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, profileKey(applicationModelId));
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return undefined;
      }
      throw error;
    }
  }
}
