/**
 * Factory for {@link ModelRetryPolicyService}.
 *
 * @module service/provider/create-model-retry-policy-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultModelRetryPolicyService } from "./impl/model-retry-policy.service.js";
import type { ModelRetryPolicyService } from "./model-retry-policy.port.js";

/**
 * Creates model retry policy storage on KKV module `nm-model-retry`.
 */
export function createModelRetryPolicyService(
  conn: TdbcConnection,
): ModelRetryPolicyService {
  const kkv = createKkvService(conn);
  return new DefaultModelRetryPolicyService(kkv);
}

