/**
 * Idempotent seed for built-in LLM providers.
 *
 * @module bootstrap/provider/seed-builtin-providers
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate } from "@/infra/tdbc/template-helper.js";

const BUILTIN = [
  {
    id: "openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    displayName: "OpenAI",
  },
  {
    id: "anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    displayName: "Anthropic",
  },
  {
    id: "google",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    displayName: "Google Gemini",
  },
  {
    id: "openrouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    displayName: "OpenRouter",
  },
] as const;

/**
 * Inserts built-in providers when missing (does not overwrite user edits).
 */
export async function seedBuiltinProviders(conn: TdbcConnection): Promise<void> {
  const parser = new SqlTemplateParser();
  const now = Date.now();
  for (const row of BUILTIN) {
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
