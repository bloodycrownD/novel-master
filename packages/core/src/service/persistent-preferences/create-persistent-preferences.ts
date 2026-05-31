/**
 * {@link PersistentPreferences} factory.
 *
 * @module service/persistent-preferences/create-persistent-preferences
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultPersistentPreferences } from "./impl/persistent-preferences.service.js";
import type { PersistentPreferences } from "./persistent-preferences.port.js";

/**
 * Creates preference storage on `nm-preferences`.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createPersistentPreferences(
  conn: TdbcConnection,
): PersistentPreferences {
  const kkv = createKkvService(conn);
  return new DefaultPersistentPreferences(kkv);
}
