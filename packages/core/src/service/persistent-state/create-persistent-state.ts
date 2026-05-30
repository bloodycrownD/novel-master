/**
 * {@link PersistentState} factory.
 *
 * @module service/persistent-state/create-persistent-state
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultPersistentState } from "./impl/persistent-state.service.js";
import type { PersistentState } from "./persistent-state.port.js";

/**
 * Creates workspace pointer persistence on `nm-workspace-state`.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createPersistentState(conn: TdbcConnection): PersistentState {
  const kkv = createKkvService(conn);
  return new DefaultPersistentState(kkv);
}
