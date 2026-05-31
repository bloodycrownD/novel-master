/**
 * Factory for {@link ModelSamplingProfileService}.
 *
 * @module service/provider/create-model-sampling-profile-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultModelSamplingProfileService } from "./impl/model-sampling-profile.service.js";
import type { ModelSamplingProfileService } from "./model-sampling-profile.port.js";

/**
 * Creates model sampling profile storage on KKV module `nm-model-sampling`.
 */
export function createModelSamplingProfileService(
  conn: TdbcConnection,
): ModelSamplingProfileService {
  const kkv = createKkvService(conn);
  return new DefaultModelSamplingProfileService(kkv);
}
