/**
 * Provider service factories.
 *
 * @module service/provider/create-provider-services
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { SqliteProviderRepository } from "@/domain/provider/repositories/impl/sqlite-provider.repository.js";
import { KkvModelSuggestionRepository } from "@/domain/provider/repositories/impl/kkv-model-suggestion.repository.js";
import { SqliteSavedModelRepository } from "@/domain/provider/repositories/impl/sqlite-saved-model.repository.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultProviderService } from "./impl/provider.service.js";
import { DefaultProviderModelService } from "./impl/provider-model.service.js";
import { DefaultModelRequestService } from "./impl/model-request.service.js";
import { createModelRetryPolicyService } from "./create-model-retry-policy-service.js";
import type { ProviderService } from "./provider.port.js";
import type { ProviderModelService } from "./provider-model.port.js";
import type { ModelRequestService } from "./model-request.port.js";

export interface ProviderServiceBundle {
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly modelRequests: ModelRequestService;
  readonly providerRepo: SqliteProviderRepository;
  readonly savedModelRepo: SqliteSavedModelRepository;
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
  const kkv = createKkvService(conn);
  const suggestionRepo = new KkvModelSuggestionRepository(kkv);
  const savedRepo = new SqliteSavedModelRepository(conn);

  const providers = new DefaultProviderService({
    providers: providerRepo,
    suggestions: suggestionRepo,
    savedModels: savedRepo,
    secretStore,
  });

  const retryPolicies = createModelRetryPolicyService(conn);

  const providerModels = new DefaultProviderModelService({
    providers,
    providerRepo,
    suggestions: suggestionRepo,
    savedModels: savedRepo,
    secretStore,
  });

  const modelRequests = new DefaultModelRequestService({
    providers: providerRepo,
    savedModels: savedRepo,
    secretStore,
    retryPolicies,
  });

  return {
    providers,
    providerModels,
    modelRequests,
    providerRepo,
    savedModelRepo: savedRepo,
  };
}
