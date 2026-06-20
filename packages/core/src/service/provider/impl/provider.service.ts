/**
 * Default provider CRUD service.
 *
 * @module service/provider/impl/provider.service
 */

import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { ProviderError } from "@/errors/provider-errors.js";
import type { LlmProvider } from "@/domain/provider/model/provider.js";
import { providerApiKeyRef } from "@/domain/provider/model/provider.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { ModelSuggestionRepository } from "@/domain/provider/repositories/model-suggestion.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { BUILTIN_PROVIDER_IDS } from "@/domain/provider/logic/builtin-providers.js";
import { normalizeBaseUrl } from "@/infra/llm-protocol/logic/http-util.js";
import type {
  CreateProviderInput,
  EditProviderPatch,
  ProviderListItem,
  ProviderService,
} from "../provider.port.js";

const BUILTIN_IDS = new Set(BUILTIN_PROVIDER_IDS);

export interface DefaultProviderServiceDeps {
  readonly providers: ProviderRepository;
  readonly suggestions: ModelSuggestionRepository;
  readonly savedModels: SavedModelRepository;
  readonly secretStore: SecretStore;
}

/** Provider configuration service. */
export class DefaultProviderService implements ProviderService {
  constructor(private readonly deps: DefaultProviderServiceDeps) {}

  async list(): Promise<ProviderListItem[]> {
    const rows = await this.deps.providers.list();
    return Promise.all(
      rows.map(async (p) => ({
        ...p,
        apiKeyStatus: await this.apiKeyStatus(p),
      })),
    );
  }

  async get(id: string): Promise<LlmProvider> {
    const p = await this.deps.providers.findById(id);
    if (!p) {
      throw new ProviderError("NOT_FOUND", `Provider not found: ${id}`, {
        providerId: id,
      });
    }
    return p;
  }

  async create(input: CreateProviderInput): Promise<LlmProvider> {
    if (BUILTIN_IDS.has(input.id)) {
      throw new ProviderError(
        "BUILTIN_PROVIDER",
        `Cannot create built-in provider id: ${input.id}`,
        { providerId: input.id },
      );
    }
    const existing = await this.deps.providers.findById(input.id);
    if (existing) {
      throw new ProviderError("CONFLICT", `Provider already exists: ${input.id}`, {
        providerId: input.id,
      });
    }
    const now = Date.now();
    const secretRef = input.apiKey
      ? providerApiKeyRef(input.id)
      : null;
    if (input.apiKey) {
      await this.deps.secretStore.set(secretRef!, input.apiKey);
    }
    const provider: LlmProvider = {
      id: input.id,
      protocol: input.protocol,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      displayName: input.displayName ?? null,
      secretRef,
      headers: input.headers ?? {},
      isBuiltin: false,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.providers.insert(provider);
    return provider;
  }

  async edit(id: string, patch: EditProviderPatch): Promise<LlmProvider> {
    const provider = await this.get(id);
    if (provider.isBuiltin && patch.protocol !== undefined) {
      throw new ProviderError(
        "BUILTIN_PROVIDER",
        `Cannot change protocol of built-in provider: ${id}`,
        { providerId: id },
      );
    }
    let secretRef = provider.secretRef;
    if (patch.apiKey !== undefined) {
      secretRef = providerApiKeyRef(id);
      await this.deps.secretStore.set(secretRef, patch.apiKey);
    }
    const updated: LlmProvider = {
      ...provider,
      protocol: patch.protocol ?? provider.protocol,
      baseUrl: patch.baseUrl
        ? normalizeBaseUrl(patch.baseUrl)
        : provider.baseUrl,
      displayName:
        patch.displayName !== undefined ? patch.displayName : provider.displayName,
      headers: patch.headers ?? provider.headers,
      secretRef,
      updatedAtMs: Date.now(),
    };
    await this.deps.providers.update(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const provider = await this.get(id);
    if (provider.isBuiltin) {
      throw new ProviderError(
        "BUILTIN_PROVIDER",
        `Cannot delete built-in provider: ${id}`,
        { providerId: id },
      );
    }
    await this.deps.suggestions.deleteByProvider(id);
    await this.deps.savedModels.deleteByProvider(id);
    await this.deps.providers.delete(id);
    if (provider.secretRef) {
      await this.deps.secretStore.delete(provider.secretRef);
    }
  }

  private async apiKeyStatus(
    provider: LlmProvider,
  ): Promise<"set" | "not set"> {
    const ref = provider.secretRef ?? providerApiKeyRef(provider.id);
    if (await this.deps.secretStore.has(ref)) {
      return "set";
    }
    return "not set";
  }
}

