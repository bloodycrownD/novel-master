/**
 * saved-model-identity-v1：llm_saved_model 表重建与 legacy 指针 UUID 化。
 *
 * @module bootstrap/schema-migrations/saved-model-identity-v1
 */

import { randomUUID } from "node:crypto";
import { deriveModelNameFromLegacy } from "@/domain/provider/logic/derive-model-name-from-legacy.js";
import { formatApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import { ProviderError } from "@/errors/provider-errors.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import {
  KEY_CURRENT_MODEL_ID,
  WORKSPACE_STATE_MODULE,
} from "@/service/persistent-state/impl/workspace-state-keys.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const SAVED_MODEL_IDENTITY_V1_ID = "saved-model-identity-v1";

const parser = new SqlTemplateParser();

interface LegacySavedModelRow {
  provider_id: string;
  vendor_model_id: string;
  display_name: string | null;
  settings_json: string;
  created_at_ms: number;
  updated_at_ms: number;
}

interface AgentDefinitionRow {
  agent_id: string;
  prompts_json: string;
}

interface ChatProjectRow {
  id: string;
  agent_config_json: string | null;
}

/** legacy 指针：非空且含 `/`（迁移后应全部为 UUID）。 */
function isLegacyModelPointer(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.includes("/");
}

async function getTableColumns(
  tx: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => row.name));
}

function throwOrphanPointer(locations: readonly string[]): never {
  throw new ProviderError(
    "MIGRATION_ORPHAN_POINTER",
    `迁移发现无法解析的 legacy 模型指针：${locations.join("; ")}`,
  );
}

function resolveLegacyPointer(
  value: string,
  mapping: ReadonlyMap<string, string>,
  location: string,
  orphans: string[],
): string {
  if (!isLegacyModelPointer(value)) {
    return value;
  }
  const resolved = mapping.get(value.trim());
  if (resolved === undefined) {
    orphans.push(`${location}: ${value.trim()}`);
    return value;
  }
  return resolved;
}

async function migrateSavedModelTable(
  tx: TdbcConnection,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();

  // bootstrap canonical DDL 可能已在 legacy 表上创建同名索引，先删除避免全局索引名冲突。
  await tx.execute(`DROP INDEX IF EXISTS idx_llm_saved_model_provider`);

  await tx.execute(`
    CREATE TABLE llm_saved_model_new (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      vendor_model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
    )
  `);
  await tx.execute(`
    CREATE INDEX idx_llm_saved_model_provider
      ON llm_saved_model_new(provider_id)
  `);

  const legacyRows = await queryTemplate<LegacySavedModelRow>(
    tx,
    parser,
    `SELECT provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
     FROM llm_saved_model`,
    {},
  );

  for (const row of legacyRows) {
    const providerId = String(row.provider_id);
    const vendorModelId = String(row.vendor_model_id);
    const id = randomUUID();
    const modelName = deriveModelNameFromLegacy(
      providerId,
      vendorModelId,
      row.display_name != null ? String(row.display_name) : null,
    );

    await executeTemplate(
      tx,
      parser,
      `INSERT INTO llm_saved_model_new (
        id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms
      ) VALUES (
        #{id}, #{providerId}, #{vendorModelId}, #{modelName}, #{settingsJson}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        id,
        providerId,
        vendorModelId,
        modelName,
        settingsJson: String(row.settings_json),
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
      },
    );

    mapping.set(
      formatApplicationModelId(providerId, vendorModelId),
      id,
    );
  }

  await tx.execute(`DROP TABLE llm_saved_model`);
  await tx.execute(`ALTER TABLE llm_saved_model_new RENAME TO llm_saved_model`);

  return mapping;
}

async function migrateCurrentModelIdPointer(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
  orphans: string[],
): Promise<void> {
  const rows = await queryTemplate<{ value: string }>(
    tx,
    parser,
    `SELECT value FROM kkv_entry
     WHERE module = #{module} AND key = #{key}`,
    { module: WORKSPACE_STATE_MODULE, key: KEY_CURRENT_MODEL_ID },
  );
  if (rows.length === 0) {
    return;
  }

  const current = String(rows[0]!.value);
  const resolved = resolveLegacyPointer(
    current,
    mapping,
    `kkv:${WORKSPACE_STATE_MODULE}/${KEY_CURRENT_MODEL_ID}`,
    orphans,
  );
  if (resolved === current) {
    return;
  }

  await executeTemplate(
    tx,
    parser,
    `UPDATE kkv_entry SET value = #{value}
     WHERE module = #{module} AND key = #{key}`,
    {
      module: WORKSPACE_STATE_MODULE,
      key: KEY_CURRENT_MODEL_ID,
      value: resolved,
    },
  );
}

async function migrateAgentDefinitionPointers(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
  orphans: string[],
): Promise<void> {
  const rows = await queryTemplate<AgentDefinitionRow>(
    tx,
    parser,
    `SELECT agent_id, prompts_json FROM agent_definition`,
    {},
  );

  for (const row of rows) {
    const agentId = String(row.agent_id);
    const wire = JSON.parse(String(row.prompts_json)) as Record<string, unknown>;
    const model = wire.model;
    if (typeof model !== "string" || !isLegacyModelPointer(model)) {
      continue;
    }

    const resolved = resolveLegacyPointer(
      model,
      mapping,
      `agent_definition:${agentId}`,
      orphans,
    );
    if (resolved === model) {
      continue;
    }

    wire.model = resolved;
    await executeTemplate(
      tx,
      parser,
      `UPDATE agent_definition SET prompts_json = #{promptsJson}
       WHERE agent_id = #{agentId}`,
      {
        agentId,
        promptsJson: JSON.stringify(wire),
      },
    );
  }
}

async function migrateProjectAgentConfigPointers(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
  orphans: string[],
): Promise<void> {
  const rows = await queryTemplate<ChatProjectRow>(
    tx,
    parser,
    `SELECT id, agent_config_json FROM chat_project`,
    {},
  );

  for (const row of rows) {
    const projectId = String(row.id);
    const raw = row.agent_config_json;
    if (raw == null) {
      continue;
    }

    const config = JSON.parse(String(raw)) as Record<string, unknown>;
    const definition = config.definition;
    if (definition == null || typeof definition !== "object" || Array.isArray(definition)) {
      continue;
    }

    const defRecord = definition as Record<string, unknown>;
    const model = defRecord.model;
    if (typeof model !== "string" || !isLegacyModelPointer(model)) {
      continue;
    }

    const resolved = resolveLegacyPointer(
      model,
      mapping,
      `chat_project:${projectId}`,
      orphans,
    );
    if (resolved === model) {
      continue;
    }

    defRecord.model = resolved;
    await executeTemplate(
      tx,
      parser,
      `UPDATE chat_project SET agent_config_json = #{configJson}
       WHERE id = #{projectId}`,
      {
        projectId,
        configJson: JSON.stringify(config),
      },
    );
  }
}

async function assertNoRemainingLegacyPointers(tx: TdbcConnection): Promise<void> {
  const violations: string[] = [];

  const kkvRows = await queryTemplate<{ value: string }>(
    tx,
    parser,
    `SELECT value FROM kkv_entry
     WHERE module = #{module} AND key = #{key}`,
    { module: WORKSPACE_STATE_MODULE, key: KEY_CURRENT_MODEL_ID },
  );
  if (kkvRows.length > 0) {
    const value = String(kkvRows[0]!.value);
    if (isLegacyModelPointer(value)) {
      violations.push(
        `kkv:${WORKSPACE_STATE_MODULE}/${KEY_CURRENT_MODEL_ID}: ${value.trim()}`,
      );
    }
  }

  const agentRows = await queryTemplate<AgentDefinitionRow>(
    tx,
    parser,
    `SELECT agent_id, prompts_json FROM agent_definition`,
    {},
  );
  for (const row of agentRows) {
    const wire = JSON.parse(String(row.prompts_json)) as Record<string, unknown>;
    const model = wire.model;
    if (typeof model === "string" && isLegacyModelPointer(model)) {
      violations.push(`agent_definition:${row.agent_id}: ${model.trim()}`);
    }
  }

  const projectRows = await queryTemplate<ChatProjectRow>(
    tx,
    parser,
    `SELECT id, agent_config_json FROM chat_project`,
    {},
  );
  for (const row of projectRows) {
    const raw = row.agent_config_json;
    if (raw == null) {
      continue;
    }
    const config = JSON.parse(String(raw)) as Record<string, unknown>;
    const definition = config.definition;
    if (definition == null || typeof definition !== "object" || Array.isArray(definition)) {
      continue;
    }
    const model = (definition as Record<string, unknown>).model;
    if (typeof model === "string" && isLegacyModelPointer(model)) {
      violations.push(`chat_project:${row.id}: ${model.trim()}`);
    }
  }

  if (violations.length > 0) {
    throwOrphanPointer(violations);
  }
}

async function upPathA(tx: TdbcConnection): Promise<void> {
  const mapping = await migrateSavedModelTable(tx);
  const orphans: string[] = [];

  await migrateCurrentModelIdPointer(tx, mapping, orphans);
  await migrateAgentDefinitionPointers(tx, mapping, orphans);
  await migrateProjectAgentConfigPointers(tx, mapping, orphans);

  if (orphans.length > 0) {
    throwOrphanPointer(orphans);
  }

  await assertNoRemainingLegacyPointers(tx);
}

async function up(tx: TdbcConnection): Promise<void> {
  const columns = await getTableColumns(tx, "llm_saved_model");
  if (columns.has("id")) {
    // 路径 B：canonical DDL 已含 id 列，runner 在 up 成功后 mark。
    return;
  }

  await upPathA(tx);
}

/** saved model UUID 身份 migration（路径 A 表重建 + 指针替换；路径 B no-op）。 */
export const savedModelIdentityV1Migration: SchemaMigration = {
  id: SAVED_MODEL_IDENTITY_V1_ID,
  up,
};

export { up as savedModelIdentityV1Up };
