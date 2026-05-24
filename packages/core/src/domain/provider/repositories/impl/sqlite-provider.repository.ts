/**
 * SQLite `llm_provider` repository.
 *
 * @module domain/provider/repositories/impl/sqlite-provider.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/adapter.port.js";
import type { LlmProvider } from "../../model/provider.js";
import type { ProviderRepository } from "../provider.port.js";

function parseHeaders(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function rowToProvider(row: Row): LlmProvider {
  return {
    id: String(row.id),
    protocol: String(row.protocol) as LlmProtocolKind,
    baseUrl: String(row.base_url),
    displayName: row.display_name != null ? String(row.display_name) : null,
    secretRef: row.secret_ref != null ? String(row.secret_ref) : null,
    defaultModelId:
      row.default_model_id != null ? String(row.default_model_id) : null,
    headers: parseHeaders(String(row.headers_json ?? "{}")),
    isBuiltin: Number(row.is_builtin) === 1,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed `llm_provider` repository. */
export class SqliteProviderRepository implements ProviderRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async list(): Promise<LlmProvider[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, protocol, base_url, display_name, secret_ref, default_model_id,
              headers_json, is_builtin, created_at_ms, updated_at_ms
       FROM llm_provider ORDER BY id`,
      {},
    );
    return rows.map(rowToProvider);
  }

  async findById(id: string): Promise<LlmProvider | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, protocol, base_url, display_name, secret_ref, default_model_id,
              headers_json, is_builtin, created_at_ms, updated_at_ms
       FROM llm_provider WHERE id = #{id}`,
      { id },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToProvider(rows[0]!);
  }

  async insert(provider: LlmProvider): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO llm_provider (
        id, protocol, base_url, display_name, secret_ref, default_model_id,
        headers_json, is_builtin, created_at_ms, updated_at_ms
      ) VALUES (
        #{id}, #{protocol}, #{baseUrl}, #{displayName}, #{secretRef}, #{defaultModelId},
        #{headersJson}, #{isBuiltin}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        id: provider.id,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        displayName: provider.displayName,
        secretRef: provider.secretRef,
        defaultModelId: provider.defaultModelId,
        headersJson: JSON.stringify(provider.headers),
        isBuiltin: provider.isBuiltin ? 1 : 0,
        createdAtMs: provider.createdAtMs,
        updatedAtMs: provider.updatedAtMs,
      },
    );
  }

  async update(provider: LlmProvider): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE llm_provider SET
        protocol = #{protocol},
        base_url = #{baseUrl},
        display_name = #{displayName},
        secret_ref = #{secretRef},
        default_model_id = #{defaultModelId},
        headers_json = #{headersJson},
        updated_at_ms = #{updatedAtMs}
       WHERE id = #{id}`,
      {
        id: provider.id,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        displayName: provider.displayName,
        secretRef: provider.secretRef,
        defaultModelId: provider.defaultModelId,
        headersJson: JSON.stringify(provider.headers),
        updatedAtMs: provider.updatedAtMs,
      },
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM llm_provider WHERE id = #{id}`,
      { id },
    );
    return result.changes > 0;
  }
}
