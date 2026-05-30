/**
 * {@link CompactionPolicyStore} factory.
 *
 * @module service/compaction/create-compaction-policy-store
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultCompactionPolicyStore } from "./impl/compaction-policy-store.service.js";
import type { CompactionPolicyStore } from "./compaction-policy-store.port.js";

/**
 * Creates compaction policy storage on KKV module `nm-compaction`.
 */
export function createCompactionPolicyStore(
  conn: TdbcConnection,
): CompactionPolicyStore {
  const kkv = createKkvService(conn);
  return new DefaultCompactionPolicyStore(kkv);
}
