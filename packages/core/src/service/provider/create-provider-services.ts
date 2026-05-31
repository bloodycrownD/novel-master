/**
 * Provider service factories.
 *
 * @module service/provider/create-provider-services
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { SqliteProviderRepository } from "@/domain/provider/repositories/impl/sqlite-provider.repository.js";
import { SqliteModelSuggestionRepository } from "@/domain/provider/repositories/impl/sqlite-model-suggestion.repository.js";
import { SqliteSavedModelRepository } from "@/domain/provider/repositories/impl/sqlite-saved-model.repository.js";
import { DefaultProviderService } from "./impl/provider.service.js";
import { DefaultProviderModelService } from "./impl/provider-model.service.js";
import { DefaultModelRequestService } from "./impl/model-request.service.js";
import { createModelSamplingProfileService } from "./create-model-sampling-profile-service.js";
import type { ProviderService } from "./provider.port.js";
import type { ProviderModelService } from "./provider-model.port.js";
import type { ModelRequestService } from "./model-request.port.js";
import type { ModelSamplingProfileService } from "./model-sampling-profile.port.js";

export interface ProviderServiceBundle {
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly modelRequests: ModelRequestService;
  readonly modelSamplingProfiles: ModelSamplingProfileService;
}

/**
 * Creates provider, model, and request services.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param secretStore - SKSP composite store
 */
export function createProviderServices(
  conn: TdbcConnection,
  secretStore: SecretStore,
): ProviderServiceBundle {
  const providerRepo = new SqliteProviderRepository(conn);
  const suggestionRepo = new SqliteModelSuggestionRepository(conn);
  const savedRepo = new SqliteSavedModelRepository(conn);

  const providers = new DefaultProviderService({
    providers: providerRepo,
    suggestions: suggestionRepo,
    savedModels: savedRepo,
    secretStore,
  });

  const modelSamplingProfiles = createModelSamplingProfileService(conn);

  const providerModels = new DefaultProviderModelService({
    providers,
    providerRepo,
    suggestions: suggestionRepo,
    savedModels: savedRepo,
    secretStore,
    samplingProfiles: modelSamplingProfiles,
  });

  const modelRequests = new DefaultModelRequestService({
    providers: providerRepo,
    savedModels: savedRepo,
    secretStore,
    samplingProfiles: modelSamplingProfiles,
  });

  return { providers, providerModels, modelRequests, modelSamplingProfiles };
}
