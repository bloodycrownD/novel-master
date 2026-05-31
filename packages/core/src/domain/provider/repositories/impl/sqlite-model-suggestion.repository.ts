/**
 * SQLite `llm_model_suggestion` repository.
 *
 * @module domain/provider/repositories/impl/sqlite-model-suggestion.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { ModelSuggestion } from "../../model/model-suggestion.js";
import type { ModelSuggestionRepository } from "../model-suggestion.port.js";

function rowToSuggestion(row: Row): ModelSuggestion {
  return {
    providerId: String(row.provider_id),
    vendorModelId: String(row.vendor_model_id),
    displayName: row.display_name != null ? String(row.display_name) : null,
    stale: Number(row.stale) === 1,
    lastSeenAtMs: Number(row.last_seen_at_ms),
  };
}

/** TDBC-backed model suggestion repository. */
export class SqliteModelSuggestionRepository implements ModelSuggestionRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listByProvider(providerId: string): Promise<ModelSuggestion[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT provider_id, vendor_model_id, display_name, stale, last_seen_at_ms
       FROM llm_model_suggestion WHERE provider_id = #{providerId}
       ORDER BY vendor_model_id`,
      { providerId },
    );
    return rows.map(rowToSuggestion);
  }

  async upsert(suggestion: ModelSuggestion): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO llm_model_suggestion (
        provider_id, vendor_model_id, display_name, stale, last_seen_at_ms
      ) VALUES (
        #{providerId}, #{vendorModelId}, #{displayName}, #{stale}, #{lastSeenAtMs}
      )
      ON CONFLICT(provider_id, vendor_model_id) DO UPDATE SET
        display_name = excluded.display_name,
        stale = excluded.stale,
        last_seen_at_ms = excluded.last_seen_at_ms`,
      {
        providerId: suggestion.providerId,
        vendorModelId: suggestion.vendorModelId,
        displayName: suggestion.displayName,
        stale: suggestion.stale ? 1 : 0,
        lastSeenAtMs: suggestion.lastSeenAtMs,
      },
    );
  }

  async markStaleExcept(
    providerId: string,
    seen: ReadonlySet<string>,
  ): Promise<void> {
    const all = await this.listByProvider(providerId);
    const now = Date.now();
    for (const row of all) {
      if (!seen.has(row.vendorModelId)) {
        await this.upsert({
          ...row,
          stale: true,
          lastSeenAtMs: row.lastSeenAtMs,
        });
      }
    }
    for (const vendorModelId of seen) {
      const existing = all.find((r) => r.vendorModelId === vendorModelId);
      await this.upsert({
        providerId,
        vendorModelId,
        displayName: existing?.displayName ?? null,
        stale: false,
        lastSeenAtMs: now,
      });
    }
  }

  async deleteByProvider(providerId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM llm_model_suggestion WHERE provider_id = #{providerId}`,
      { providerId },
    );
  }
}
