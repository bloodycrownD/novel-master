/**
 * KKV service factory.
 *
 * @module service/kkv/create-kkv-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { DefaultKkvService } from "./impl/kkv.service.js";
import type { KkvService } from "./kkv.port.js";

/**
 * Creates a {@link KkvService} backed by SQLite `kkv_entry` storage.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createKkvService(conn: TdbcConnection): KkvService {
  const repo = new SqliteKkvRepository(conn);
  return new DefaultKkvService(repo);
}
