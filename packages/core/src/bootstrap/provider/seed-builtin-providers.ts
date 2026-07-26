/**
 * 幂等写入内置 LLM providers（按 builtin_key，不覆盖用户改动）。
 *
 * @module bootstrap/provider/seed-builtin-providers
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { BUILTIN_PROVIDER_ROWS } from "@/domain/provider/logic/builtin-providers.js";

/**
 * 按 builtin_key 幂等插入内置服务商（已存在则跳过，不覆盖用户编辑）。
 */
export async function seedBuiltinProviders(conn: TdbcConnection): Promise<void> {
  const parser = new SqlTemplateParser();
  const now = Date.now();
  for (const row of BUILTIN_PROVIDER_ROWS) {
    await executeTemplate(
      conn,
      parser,
      `INSERT INTO llm_provider (
        id, builtin_key, protocol, base_url, display_name, secret_ref, headers_json,
        is_builtin, created_at_ms, updated_at_ms
      )
      SELECT #{id}, #{builtinKey}, #{protocol}, #{baseUrl}, #{displayName}, NULL, '{}', 1, #{now}, #{now}
      WHERE NOT EXISTS (SELECT 1 FROM llm_provider WHERE builtin_key = #{builtinKey})`,
      {
        id: row.id,
        builtinKey: row.key,
        protocol: row.protocol,
        baseUrl: row.baseUrl,
        displayName: row.displayName,
        now,
      },
    );
  }
}
