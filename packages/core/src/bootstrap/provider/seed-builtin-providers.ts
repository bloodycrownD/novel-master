/**
 * Idempotent seed for built-in LLM providers.
 *
 * @module bootstrap/provider/seed-builtin-providers
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { BUILTIN_PROVIDER_ROWS } from "@/domain/provider/logic/builtin-providers.js";

/**
 * Inserts built-in providers when missing (does not overwrite user edits).
 */
export async function seedBuiltinProviders(conn: TdbcConnection): Promise<void> {
  const parser = new SqlTemplateParser();
  const now = Date.now();
  for (const row of BUILTIN_PROVIDER_ROWS) {
    await executeTemplate(
      conn,
      parser,
      `INSERT INTO llm_provider (
        id, protocol, base_url, display_name, secret_ref, headers_json,
        is_builtin, created_at_ms, updated_at_ms
      )
      SELECT #{id}, #{protocol}, #{baseUrl}, #{displayName}, NULL, '{}', 1, #{now}, #{now}
      WHERE NOT EXISTS (SELECT 1 FROM llm_provider WHERE id = #{id})`,
      {
        id: row.id,
        protocol: row.protocol,
        baseUrl: row.baseUrl,
        displayName: row.displayName,
        now,
      },
    );
  }
}
