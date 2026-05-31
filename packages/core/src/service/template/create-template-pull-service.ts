/**
 * Template pull service factory.
 *
 * @module service/template/create-template-pull-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { DefaultTemplatePullService } from "./impl/template-pull.service.js";
import type { TemplatePullService } from "./template-pull.port.js";

/**
 * Creates a {@link TemplatePullService} for the given connection.
 */
export function createTemplatePullService(
  conn: TdbcConnection,
): TemplatePullService {
  return new DefaultTemplatePullService(conn);
}
