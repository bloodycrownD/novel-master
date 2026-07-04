/**
 * Schema migration 模块契约。
 *
 * @module bootstrap/schema-migrations/schema-migration.types
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** 单条已登记 schema migration。 */
export interface SchemaMigration {
  readonly id: string;
  up(tx: TdbcConnection): Promise<void>;
}
