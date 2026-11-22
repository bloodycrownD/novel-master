/**
 * Provider model suggestions and saved models.
 *
 * @module service/provider/impl/provider-model.service
 */

import { Random } from "@/common/random.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { ModelSuggestion } from "@/domain/provider/model/model-suggestion.js";
import type { SavedModel } from "@/domain/provider/model/saved-model.js";
import type { AbortScope } from "@/domain/abort/model/abort-scope.js";
import { AbortScopeFactory } from "@/domain/abort/logic/create-abort-scope.js";
import { DefaultSavedModelSettings } from "@/domain/provider/model/default-saved-model-settings.js";
import { SavedModelSettings, type SavedModelSettingsPatch } from "@/domain/provider/model/saved-model-settings.js";
import { SavedModelSettingsJson } from "@/domain/provider/model/saved-model-settings-from-json.js";
import { TokenCounterModePref } from "@/infra/tokenizer/logic/read-token-counter-mode-pref.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import { ProviderApiKey } from "@/domain/provider/logic/resolve-provider-api-key.js";
import { SavedModelUuid } from "@/domain/provider/logic/assert-saved-model-uuid.js";
import { SavedModelReferences } from "@/domain/provider/logic/find-saved-model-references.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { ModelSuggestionRepository } from "@/domain/provider/repositories/model-suggestion.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { Registry } from "@/infra/llm-protocol/logic/registry.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { ApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { ProviderModelService } from "../provider-model.port.js";
import type { ProviderService } from "../provider.port.js";

interface DefaultProviderModelServiceDeps {
    readonly providers: ProviderService;
    readonly providerRepo: ProviderRepository;
    readonly suggestions: ModelSuggestionRepository;
    readonly savedModels: SavedModelRepository;
    readonly secretStore: SecretStore;
    /** Used for deleteSaved reference validation (currentModelId / agent pins). */
    readonly conn: TdbcConnection;
}

/** 解包 domain 的 Result，保持 service 对 app 的 AppError 契约（五期门⑦走返回值）。 */
async function requireSavedModel(savedModelId: string, savedModels: SavedModelRepository): Promise<Result<SavedModel, AppError>> {
    const asserted = await SavedModelUuid.assert(savedModelId, savedModels);
    if (!asserted.ok) {
        return Result.err(new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: asserted.error.message, modelId: savedModelId }));
    }
    return Result.ok(asserted.value);
}

/** Model suggestion and saved-model service. */
export class DefaultProviderModelService implements ProviderModelService {
    constructor(private readonly deps: DefaultProviderModelServiceDeps) {}

    async suggestList(providerId: string): Promise<Result<ModelSuggestion[], AppError>> {
        const got = await this.deps.providers.get(providerId);
        if (!got.ok) return Result.err(got.error);
        const listed = await this.deps.suggestions.listByProvider(providerId);
        if (!listed.ok) return Result.err(listed.error);
        return Result.ok(listed.value);
    }

    async fetch(providerId: string, scope?: AbortScope): Promise<Result<void, AppError>> {
        const got = await this.deps.providers.get(providerId);
        if (!got.ok) return Result.err(got.error);
        const provider = got.value;
        const apiKeyResult = await ProviderApiKey.resolve(provider, this.deps.secretStore);
        if (!apiKeyResult.ok) {
            return Result.err(new AppError("PROVIDER_API_KEY_NOT_SET", { detail: apiKeyResult.error.message, providerId }));
        }
        const apiKey = apiKeyResult.value;
        const adapter = Registry.getProtocolAdapter(provider.protocol);
        // 缺省 scope = 不可取消（CLI / 旧调用点）；desktop handler 会传入带 deadline 的 scope。
        const result = await adapter.listModels({ baseUrl: provider.baseUrl, apiKey, extraHeaders: provider.headers, scope: scope ?? AbortScopeFactory.create() });

        const seen = new Set<string>();
        for (const m of result.models) {
            const vendorModelId = ApplicationModelId.normalizeVendorModelId(providerId, m.vendorModelId);
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
        return Result.ok(undefined);
    }

    async save(providerId: string, vendorModelId: string, modelName?: string): Promise<Result<SavedModel, AppError>> {
        const got = await this.deps.providers.get(providerId);
        if (!got.ok) return Result.err(got.error);
        const normalizedVendorModelId = ApplicationModelId.normalizeVendorModelId(providerId, vendorModelId);
        const trimmedModelName = modelName?.trim();
        if (trimmedModelName != null && trimmedModelName.length === 0) return Result.err(new AppError("PROVIDER_INVALID_MODEL_NAME", { detail: "modelName must not be empty" }));
        const persistedModelName = trimmedModelName ?? normalizedVendorModelId;
        const now = Date.now();
        const model: SavedModel = {
            id: Random.uuid(),
            providerId,
            vendorModelId: normalizedVendorModelId,
            modelName: persistedModelName,
            settings: DefaultSavedModelSettings.of(normalizedVendorModelId),
            createdAtMs: now,
            updatedAtMs: now,
        };
        await this.deps.savedModels.insert(model);
        return Result.ok(model);
    }

    /** nm-style: keep-public — ProviderModelService 端口 create 兼容别名（save 的旧签名），120 处调用点按端口契约消费。 */
    async create(providerId: string, vendorModelId: string): Promise<Result<SavedModel, AppError>> {
        return this.save(providerId, vendorModelId);
    }

    async savedList(providerId: string): Promise<Result<SavedModel[], AppError>> {
        const got = await this.deps.providers.get(providerId);
        if (!got.ok) return Result.err(got.error);
        const listed = await this.deps.savedModels.listByProvider(providerId);
        if (!listed.ok) return Result.err(listed.error);
        return Result.ok(listed.value);
    }

    async editSaved(savedModelId: string, modelName?: string): Promise<Result<SavedModel, AppError>> {
        const found = await requireSavedModel(savedModelId, this.deps.savedModels);
        if (!found.ok) return Result.err(found.error);
        const existing = found.value;
        let nextModelName = existing.modelName;
        if (modelName === null) {
            return Result.err(new AppError("PROVIDER_INVALID_MODEL_NAME", { detail: "modelName must not be empty", modelId: savedModelId }));
        }
        if (modelName !== undefined) {
            const trimmed = modelName.trim();
            if (trimmed.length === 0) {
                return Result.err(new AppError("PROVIDER_INVALID_MODEL_NAME", { detail: "modelName must not be empty", modelId: savedModelId }));
            }
            nextModelName = trimmed;
        }
        const updated: SavedModel = {
            ...existing,
            modelName: nextModelName,
            updatedAtMs: Date.now(),
        };
        await this.deps.savedModels.updateById(updated);
        return Result.ok(updated);
    }

    async deleteSaved(savedModelId: string): Promise<Result<void, AppError>> {
        const found = await requireSavedModel(savedModelId, this.deps.savedModels);
        if (!found.ok) return Result.err(found.error);
        const existing = found.value;
        const refs = await SavedModelReferences.find(this.deps.conn, savedModelId);
        if (refs.length > 0) {
            return Result.err(new AppError("PROVIDER_SAVED_MODEL_IN_USE", { detail: `Saved model is in use: ${refs.join(", ")}`, modelId: savedModelId, providerId: existing.providerId }));
        }
        const ok = await this.deps.savedModels.deleteById(savedModelId);
        if (!ok) {
            return Result.err(new AppError("PROVIDER_NOT_FOUND", { detail: `Saved model not found: ${savedModelId}`, modelId: savedModelId }));
        }
        return Result.ok(undefined);
    }

    async updateSettings(savedModelId: string, patch: SavedModelSettingsPatch): Promise<Result<SavedModel, AppError>> {
        const found = await requireSavedModel(savedModelId, this.deps.savedModels);
        if (!found.ok) return Result.err(found.error);
        const existing = found.value;

        if (patch.contextWindowTokens != null && (!Number.isInteger(patch.contextWindowTokens) || patch.contextWindowTokens <= 0)) {
            return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: "contextWindowTokens must be a positive integer", modelId: savedModelId, providerId: existing.providerId }));
        }

        if (patch.tokenCounterMode != null && !TokenCounterModePref.isValid(patch.tokenCounterMode)) {
            return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: `Invalid tokenCounterMode: ${patch.tokenCounterMode}`, modelId: savedModelId, providerId: existing.providerId }));
        }

        const mergedSettings = SavedModelSettings.applyPatch(existing.settings, patch);
        const persistable = SavedModelSettingsJson.assertPersistable(mergedSettings);
        if (!persistable.ok) {
            return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: persistable.error.message }));
        }

        const updated: SavedModel = {
            ...existing,
            settings: mergedSettings,
            updatedAtMs: Date.now(),
        };

        await this.deps.savedModels.updateById(updated);
        return Result.ok(updated);
    }

    async resetContextWindowToDefault(savedModelId: string): Promise<Result<SavedModel, AppError>> {
        const found = await requireSavedModel(savedModelId, this.deps.savedModels);
        if (!found.ok) return Result.err(found.error);
        const existing = found.value;
        const defaults = DefaultSavedModelSettings.of(existing.vendorModelId);
        return this.updateSettings(savedModelId, {
            contextWindowTokens: defaults.internal.contextWindowTokens,
        });
    }

    async getSavedById(savedModelId: string): Promise<Result<SavedModel | null, AppError>> {
        const saved = await this.deps.savedModels.findById(savedModelId);
        if (!saved.ok) return Result.err(saved.error);
        return Result.ok(saved.value);
    }

    async getContextWindow(savedModelId: string): Promise<Result<number | null, AppError>> {
        const saved = await this.getSavedById(savedModelId);
        if (!saved.ok) return Result.err(saved.error);
        return Result.ok(saved.value != null ? SavedModelSettings.contextWindowTokens(saved.value.settings) : null);
    }

    async getTokenCounterMode(savedModelId: string): Promise<Result<TokenizerOverride, AppError>> {
        const saved = await this.getSavedById(savedModelId);
        if (!saved.ok) return Result.err(saved.error);
        return Result.ok(saved.value != null ? SavedModelSettings.tokenCounterMode(saved.value.settings) : "auto");
    }
}
