/**
 * Drops legacy `agent_definition.model` and `runtime_json` columns.
 *
 * WHY: agent payload is canonical in `prompts_json`; legacy columns were
 * write-only duplicates left from the compaction-agent-update migration.
 *
 * @module bootstrap/agent/migrate-drop-agent-definition-legacy-columns
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Pragma-guarded DROP COLUMN for legacy agent_definition fields (idempotent). */
export async function migrateDropAgentDefinitionLegacyColumns(
  tx: TdbcConnection,
): Promise<void> {
  let rows = await tx.query(
    "SELECT name FROM pragma_table_info('agent_definition')",
  );
  let names = rows.map((r) => String(r.name));
  if (names.includes("model")) {
    await tx.execute("ALTER TABLE agent_definition DROP COLUMN model");
  }
  rows = await tx.query(
    "SELECT name FROM pragma_table_info('agent_definition')",
  );
  names = rows.map((r) => String(r.name));
  if (names.includes("runtime_json")) {
    await tx.execute("ALTER TABLE agent_definition DROP COLUMN runtime_json");
  }
}
