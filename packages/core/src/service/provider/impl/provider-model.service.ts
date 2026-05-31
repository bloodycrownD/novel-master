/**
 * Provider model suggestions and saved models.
 *
 * @module service/provider/impl/provider-model.service
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { ModelSuggestion } from "@/domain/provider/model/model-suggestion.js";
import type { SavedModel } from "@/domain/provider/model/saved-model.js";
import { providerApiKeyRef } from "@/domain/provider/model/provider.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { ModelSuggestionRepository } from "@/domain/provider/repositories/model-suggestion.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { getProtocolAdapter } from "@/infra/llm-protocol/logic/registry.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  formatApplicationModelId,
  normalizeVendorModelId,
} from "@/domain/provider/logic/application-model-id.js";
import type { ModelSamplingProfileService } from "../model-sampling-profile.port.js";
import type { ProviderModelService } from "../provider-model.port.js";
import type { ProviderService } from "../provider.port.js";

export interface DefaultProviderModelServiceDeps {
  readonly providers: ProviderService;
  readonly providerRepo: ProviderRepository;
  readonly suggestions: ModelSuggestionRepository;
  readonly savedModels: SavedModelRepository;
  readonly secretStore: SecretStore;
  readonly samplingProfiles: ModelSamplingProfileService;
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
    const apiKey = await this.resolveApiKey(provider.id, provider.secretRef);
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
    const applicationModelId = formatApplicationModelId(providerId, vendorModelId);
    await this.deps.samplingProfiles.clearProfile(applicationModelId);
  }

  private async resolveApiKey(
    providerId: string,
    secretRef: string | null,
  ): Promise<string> {
    const ref = secretRef ?? providerApiKeyRef(providerId);
    const key = await this.deps.secretStore.get(ref);
    if (key == null || key === "") {
      throw new ProviderError(
        "API_KEY_NOT_SET",
        `API key not set for provider ${providerId} (run: nm provider edit --providerId ${providerId} --apiKey <key>)`,
        { providerId },
      );
    }
    return key;
  }
}
