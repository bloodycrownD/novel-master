/**
 * Configuration service factory.
 *
 * @module service/config/create-config-service
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultConfigService } from "./impl/config.service.js";
import type { ConfigService } from "./config.port.js";

/**
 * Creates a {@link ConfigService} backed by KKV storage.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createConfigService(conn: TdbcConnection): ConfigService {
  const kkv = createKkvService(conn);
  return new DefaultConfigService(kkv);
}
