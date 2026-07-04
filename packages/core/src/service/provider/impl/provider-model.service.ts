/**
 * Provider model suggestions and saved models.
 *
 * @module service/provider/impl/provider-model.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
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
import { assertSavedModelUuid } from "@/domain/provider/logic/assert-saved-model-uuid.js";
import { findSavedModelReferences } from "@/domain/provider/logic/find-saved-model-references.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { ModelSuggestionRepository } from "@/domain/provider/repositories/model-suggestion.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { getProtocolAdapter } from "@/infra/llm-protocol/logic/registry.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { normalizeVendorModelId } from "@/domain/provider/logic/application-model-id.js";
import type { ProviderModelService } from "../provider-model.port.js";
import type { ProviderService } from "../provider.port.js";

export interface DefaultProviderModelServiceDeps {
  readonly providers: ProviderService;
  readonly providerRepo: ProviderRepository;
  readonly suggestions: ModelSuggestionRepository;
  readonly savedModels: SavedModelRepository;
  readonly secretStore: SecretStore;
  /** Used for deleteSaved reference validation (currentModelId / agent pins). */
  readonly conn: TdbcConnection;
}

function resolvePersistedModelName(
  vendorModelId: string,
  modelName?: string,
): string {
  if (modelName === undefined) {
    return vendorModelId;
  }
  const trimmed = modelName.trim();
  if (trimmed.length === 0) {
    throw new ProviderError(
      "INVALID_MODEL_NAME",
      "modelName must not be empty",
    );
  }
  return trimmed;
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
    modelName?: string,
  ): Promise<SavedModel> {
    await this.deps.providers.get(providerId);
    const normalizedVendorModelId = normalizeVendorModelId(
      providerId,
      vendorModelId,
    );
    const persistedModelName = resolvePersistedModelName(
      normalizedVendorModelId,
      modelName,
    );
    const now = Date.now();
    const model: SavedModel = {
      id: randomUUID(),
      providerId,
      vendorModelId: normalizedVendorModelId,
      modelName: persistedModelName,
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

  async editSaved(savedModelId: string, modelName?: string): Promise<SavedModel> {
    const existing = await assertSavedModelUuid(
      savedModelId,
      this.deps.savedModels,
    );
    let nextModelName = existing.modelName;
    if (modelName === null) {
      throw new ProviderError(
        "INVALID_MODEL_NAME",
        "modelName must not be empty",
        { modelId: savedModelId },
      );
    }
    if (modelName !== undefined) {
      const trimmed = modelName.trim();
      if (trimmed.length === 0) {
        throw new ProviderError(
          "INVALID_MODEL_NAME",
          "modelName must not be empty",
          { modelId: savedModelId },
        );
      }
      nextModelName = trimmed;
    }
    const updated: SavedModel = {
      ...existing,
      modelName: nextModelName,
      updatedAtMs: Date.now(),
    };
    await this.deps.savedModels.updateById(updated);
    return updated;
  }

  async deleteSaved(savedModelId: string): Promise<void> {
    const existing = await assertSavedModelUuid(
      savedModelId,
      this.deps.savedModels,
    );
    const refs = await findSavedModelReferences(this.deps.conn, savedModelId);
    if (refs.length > 0) {
      throw new ProviderError(
        "SAVED_MODEL_IN_USE",
        `Saved model is in use: ${refs.join(", ")}`,
        { modelId: savedModelId, providerId: existing.providerId },
      );
    }
    const ok = await this.deps.savedModels.deleteById(savedModelId);
    if (!ok) {
      throw new ProviderError(
        "NOT_FOUND",
        `Saved model not found: ${savedModelId}`,
        { modelId: savedModelId },
      );
    }
  }

  async updateSettings(
    savedModelId: string,
    patch: SavedModelSettingsPatch,
  ): Promise<SavedModel> {
    const existing = await assertSavedModelUuid(
      savedModelId,
      this.deps.savedModels,
    );

    if (
      patch.contextWindowTokens != null &&
      (!Number.isInteger(patch.contextWindowTokens) ||
        patch.contextWindowTokens <= 0)
    ) {
      throw new ProviderError(
        "INVALID_ARGUMENT",
        "contextWindowTokens must be a positive integer",
        { modelId: savedModelId, providerId: existing.providerId },
      );
    }

    if (
      patch.tokenCounterMode != null &&
      !isValidTokenCounterModePref(patch.tokenCounterMode)
    ) {
      throw new ProviderError(
        "INVALID_ARGUMENT",
        `Invalid tokenCounterMode: ${patch.tokenCounterMode}`,
        { modelId: savedModelId, providerId: existing.providerId },
      );
    }

    const mergedSettings = applySavedModelSettingsPatch(existing.settings, patch);
    assertSavedModelSettingsPersistable(mergedSettings);

    const updated: SavedModel = {
      ...existing,
      settings: mergedSettings,
      updatedAtMs: Date.now(),
    };

    await this.deps.savedModels.updateById(updated);
    return updated;
  }

  async resetContextWindowToDefault(savedModelId: string): Promise<SavedModel> {
    const existing = await assertSavedModelUuid(
      savedModelId,
      this.deps.savedModels,
    );
    const defaults = defaultSavedModelSettings(existing.vendorModelId);
    return this.updateSettings(savedModelId, {
      contextWindowTokens: defaults.internal.contextWindowTokens,
    });
  }

  async getSavedById(savedModelId: string): Promise<SavedModel | null> {
    return this.deps.savedModels.findById(savedModelId);
  }

  async getContextWindow(savedModelId: string): Promise<number | null> {
    const saved = await this.getSavedById(savedModelId);
    return saved != null ? savedModelContextWindowTokens(saved.settings) : null;
  }

  async getTokenCounterMode(savedModelId: string): Promise<TokenizerOverride> {
    const saved = await this.getSavedById(savedModelId);
    return saved != null ? savedModelTokenCounterMode(saved.settings) : "auto";
  }
}
