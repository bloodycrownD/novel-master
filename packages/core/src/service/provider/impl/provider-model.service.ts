/**

 * Provider model suggestions and saved models.

 *

 * @module service/provider/impl/provider-model.service

 */



import { ProviderError } from "@/errors/provider-errors.js";

import type { ModelSuggestion } from "@/domain/provider/model/model-suggestion.js";

import type { SavedModel } from "@/domain/provider/model/saved-model.js";

import { defaultSavedModelSettings } from "@/domain/provider/model/default-saved-model-settings.js";

import {
  applySavedModelSettingsPatch,
  savedModelContextWindowTokens,
  savedModelTokenCounterMode,
  type SavedModelSettingsPatch,
} from "@/domain/provider/model/saved-model-settings.js";
import { assertSavedModelSettingsPersistable } from "@/domain/provider/model/saved-model-settings-from-json.js";
import { isValidTokenCounterModePref } from "@/infra/tokenizer/logic/read-token-counter-mode-pref.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import { resolveProviderApiKey } from "@/domain/provider/logic/resolve-provider-api-key.js";

import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";

import type { ModelSuggestionRepository } from "@/domain/provider/repositories/model-suggestion.port.js";

import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";

import { getProtocolAdapter } from "@/infra/llm-protocol/logic/registry.js";

import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";

import {
  normalizeVendorModelId,
  parseApplicationModelId,
} from "@/domain/provider/logic/application-model-id.js";

import type { ProviderModelService } from "../provider-model.port.js";

import type { ProviderService } from "../provider.port.js";



export interface DefaultProviderModelServiceDeps {

  readonly providers: ProviderService;

  readonly providerRepo: ProviderRepository;

  readonly suggestions: ModelSuggestionRepository;

  readonly savedModels: SavedModelRepository;

  readonly secretStore: SecretStore;

}



/** Model suggestion and saved-model service. */

export class DefaultProviderModelService implements ProviderModelService {

  constructor(private readonly deps: DefaultProviderModelServiceDeps) {}



  async suggestList(providerId: string): Promise<ModelSuggestion[]> {

    await this.deps.providers.get(providerId);

    return this.deps.suggestions.listByProvider(providerId);

  }



  async fetch(providerId: string): Promise<void> {

    const provider = await this.deps.providers.get(providerId);

    const apiKey = await resolveProviderApiKey(provider, this.deps.secretStore);

    const adapter = getProtocolAdapter(provider.protocol);

    const result = await adapter.listModels({

      baseUrl: provider.baseUrl,

      apiKey,

      extraHeaders: provider.headers,

    });

    const seen = new Set<string>();

    for (const m of result.models) {

      const vendorModelId = normalizeVendorModelId(providerId, m.vendorModelId);

      seen.add(vendorModelId);

      await this.deps.suggestions.upsert({

        providerId,

        vendorModelId,

        displayName: m.displayName ?? null,

        stale: false,

        lastSeenAtMs: Date.now(),

      });

    }

    await this.deps.suggestions.markStaleExcept(providerId, seen);

  }



  async save(

    providerId: string,

    vendorModelId: string,

    displayName?: string,

  ): Promise<SavedModel> {

    await this.deps.providers.get(providerId);

    const normalizedVendorModelId = normalizeVendorModelId(

      providerId,

      vendorModelId,

    );

    const suggestion = (

      await this.deps.suggestions.listByProvider(providerId)

    ).find((s) => s.vendorModelId === normalizedVendorModelId);

    const now = Date.now();

    const existing = await this.deps.savedModels.find(

      providerId,

      normalizedVendorModelId,

    );

    if (existing) {

      const updated: SavedModel = {

        ...existing,

        displayName:

          displayName ?? suggestion?.displayName ?? existing.displayName,

        updatedAtMs: now,

      };

      await this.deps.savedModels.update(updated);

      return updated;

    }

    const model: SavedModel = {

      providerId,

      vendorModelId: normalizedVendorModelId,

      displayName: displayName ?? suggestion?.displayName ?? null,

      settings: defaultSavedModelSettings(normalizedVendorModelId),

      createdAtMs: now,

      updatedAtMs: now,

    };

    await this.deps.savedModels.insert(model);

    return model;

  }



  async create(providerId: string, vendorModelId: string): Promise<SavedModel> {

    return this.save(providerId, vendorModelId);

  }



  async savedList(providerId: string): Promise<SavedModel[]> {

    await this.deps.providers.get(providerId);

    return this.deps.savedModels.listByProvider(providerId);

  }



  async editSaved(

    providerId: string,

    vendorModelId: string,

    displayName?: string | null,

  ): Promise<SavedModel> {

    const existing = await this.deps.savedModels.find(

      providerId,

      vendorModelId,

    );

    if (!existing) {

      throw new ProviderError(

        "MODEL_NOT_SAVED",

        `Model not saved: ${providerId}/${vendorModelId}`,

        { providerId, modelId: `${providerId}/${vendorModelId}` },

      );

    }

    const updated: SavedModel = {

      ...existing,

      ...(displayName !== undefined ? { displayName } : {}),

      updatedAtMs: Date.now(),

    };

    await this.deps.savedModels.update(updated);

    return updated;

  }



  async deleteSaved(providerId: string, vendorModelId: string): Promise<void> {

    const ok = await this.deps.savedModels.delete(providerId, vendorModelId);

    if (!ok) {

      throw new ProviderError(

        "NOT_FOUND",

        `Saved model not found: ${providerId}/${vendorModelId}`,

        { providerId, modelId: `${providerId}/${vendorModelId}` },

      );

    }

  }



  async updateSettings(

    providerId: string,

    vendorModelId: string,

    patch: SavedModelSettingsPatch,

  ): Promise<SavedModel> {

    const existing = await this.deps.savedModels.find(

      providerId,

      vendorModelId,

    );

    if (!existing) {

      throw new ProviderError(

        "MODEL_NOT_SAVED",

        `Model not saved: ${providerId}/${vendorModelId}`,

        { providerId, modelId: `${providerId}/${vendorModelId}` },

      );

    }

    if (
      patch.contextWindowTokens != null &&
      (!Number.isInteger(patch.contextWindowTokens) ||
        patch.contextWindowTokens <= 0)
    ) {
      throw new ProviderError(
        "INVALID_ARGUMENT",
        "contextWindowTokens must be a positive integer",
        { providerId, modelId: `${providerId}/${vendorModelId}` },
      );
    }

    if (
      patch.tokenCounterMode != null &&
      !isValidTokenCounterModePref(patch.tokenCounterMode)
    ) {
      throw new ProviderError(
        "INVALID_ARGUMENT",
        `Invalid tokenCounterMode: ${patch.tokenCounterMode}`,
        { providerId, modelId: `${providerId}/${vendorModelId}` },
      );
    }

    const mergedSettings = applySavedModelSettingsPatch(existing.settings, patch);
    assertSavedModelSettingsPersistable(mergedSettings);

    const updated: SavedModel = {
      ...existing,
      settings: mergedSettings,
      updatedAtMs: Date.now(),
    };

    await this.deps.savedModels.update(updated);

    return updated;

  }



  async resetContextWindowToDefault(

    providerId: string,

    vendorModelId: string,

  ): Promise<SavedModel> {

    const defaults = defaultSavedModelSettings(vendorModelId);

    return this.updateSettings(providerId, vendorModelId, {
      contextWindowTokens: defaults.internal.contextWindowTokens,
    });

  }



  async getSaved(applicationModelId: string): Promise<SavedModel | null> {

    const { providerId, vendorModelId } =

      parseApplicationModelId(applicationModelId);

    return this.deps.savedModels.find(providerId, vendorModelId);

  }



  async getContextWindow(applicationModelId: string): Promise<number | null> {

    const saved = await this.getSaved(applicationModelId);

    return saved != null ? savedModelContextWindowTokens(saved.settings) : null;

  }



  async getTokenCounterMode(applicationModelId: string): Promise<TokenizerOverride> {

    const saved = await this.getSaved(applicationModelId);

    return saved != null ? savedModelTokenCounterMode(saved.settings) : "auto";

  }

}


