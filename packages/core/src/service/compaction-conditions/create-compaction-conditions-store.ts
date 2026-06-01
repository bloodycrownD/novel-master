/**
 * Factory for {@link DefaultCompactionConditionsStore}.
 *
 * @module service/compaction-conditions/create-compaction-conditions-store
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultCompactionConditionsStore } from "./impl/compaction-conditions-store.service.js";
import type { CompactionConditionsStore } from "./compaction-conditions-store.port.js";

export function createCompactionConditionsStore(
  conn: TdbcConnection,
): CompactionConditionsStore {
  return new DefaultCompactionConditionsStore(createKkvService(conn));
}
