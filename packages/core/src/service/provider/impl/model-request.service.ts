/**
 * LLM chat request for saved models.
 *
 * @module service/provider/impl/model-request.service
 */

import { ProviderError } from "@/errors/provider-errors.js";
import { parseApplicationModelId } from "@/domain/provider/application-model-id.js";
import { providerApiKeyRef } from "@/domain/provider/model/provider.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import { getProtocolAdapter } from "@/infra/llm-protocol/registry.js";
import type { LlmChatResult } from "@/infra/llm-protocol/adapter.port.js";
import type { SecretStore } from "@/infra/sksp/secret-store.port.js";
import type { ModelSamplingProfileService } from "../model-sampling-profile.port.js";
import type {
  ModelRequestOptions,
  ModelRequestService,
} from "../model-request.port.js";

export interface DefaultModelRequestServiceDeps {
  readonly providers: ProviderRepository;
  readonly savedModels: SavedModelRepository;
  readonly secretStore: SecretStore;
  readonly samplingProfiles: ModelSamplingProfileService;
}

/** Sends chat requests via protocol adapters. */
export class DefaultModelRequestService implements ModelRequestService {
  constructor(private readonly deps: DefaultModelRequestServiceDeps) {}

  async request(
    applicationModelId: string,
    userContent: string,
    options?: ModelRequestOptions,
  ): Promise<LlmChatResult> {
    const { providerId, vendorModelId } =
      parseApplicationModelId(applicationModelId);
    const saved = await this.deps.savedModels.find(providerId, vendorModelId);
    if (!saved) {
      throw new ProviderError(
        "MODEL_NOT_SAVED",
        `Model not saved: ${applicationModelId} (run: nm provider model save --vendorModelId ${vendorModelId})`,
        { modelId: applicationModelId, providerId },
      );
    }
    const provider = await this.deps.providers.findById(providerId);
    if (!provider) {
      throw new ProviderError("NOT_FOUND", `Provider not found: ${providerId}`, {
        providerId,
      });
    }
    const ref = provider.secretRef ?? providerApiKeyRef(providerId);
    const apiKey = await this.deps.secretStore.get(ref);
    if (apiKey == null || apiKey === "") {
      throw new ProviderError(
        "API_KEY_NOT_SET",
        `API key not set for provider ${providerId} (run: nm provider edit --providerId ${providerId} --apiKey <key>)`,
        { providerId },
      );
    }
    let sampling = options?.sampling;
    if (sampling === undefined) {
      const profile = await this.deps.samplingProfiles.getProfile(applicationModelId);
      if (profile?.enabled && profile.params != null) {
        sampling = profile.params;
      }
    }

    const adapter = getProtocolAdapter(provider.protocol);
    return adapter.chat({
      baseUrl: provider.baseUrl,
      apiKey,
      vendorModelId,
      userContent,
      extraHeaders: provider.headers,
      history: options?.history,
      system: options?.system,
      tools: options?.tools,
      stream: options?.stream,
      onStream: options?.onStream,
      sampling,
    });
  }
}
