/**
 * Factory for ConfigService.
 *
 * @module service/config/create-config-service
 */

import type { KkvService } from "../kkv/kkv.port.js";
import type { ConfigService } from "./config.port.js";
import { DefaultConfigService } from "./impl/config.service.js";

/**
 * Creates a ConfigService instance backed by KKV.
 */
export function createConfigService(kkv: KkvService): ConfigService {
  return new DefaultConfigService(kkv);
}
