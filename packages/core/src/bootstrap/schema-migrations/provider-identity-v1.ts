/**
 * provider-identity-v1：llm_provider UUID 化 + builtin_key + display_name NOT NULL。
 *
 * 路径 B 仅以 builtin_key 列存在判定（禁止 has("id")）。
 *
 * @module bootstrap/schema-migrations/provider-identity-v1
 */

import { randomUUID } from "@/infra/random-uuid.js";
import {
  BUILTIN_KEY_TO_UUID,
  BUILTIN_PROVIDER_ROWS,
} from "@/domain/provider/logic/builtin-providers.js";
import { providerApiKeyRef } from "@/domain/provider/model/provider.js";
import { ProviderError } from "@/errors/provider-errors.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import {
  KEY_CURRENT_PROVIDER_ID,
  WORKSPACE_STATE_MODULE,
} from "@/service/persistent-state/impl/workspace-state-keys.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const PROVIDER_IDENTITY_V1_ID = "provider-identity-v1";

const SUGGESTIONS_MODULE = "nm-model-suggestions";

const parser = new SqlTemplateParser();

const BUILTIN_FRIENDLY_NAME: Readonly<Record<string, string>> =
  Object.fromEntries(
    BUILTIN_PROVIDER_ROWS.map((row) => [row.key, row.displayName]),
  );

interface LegacyProviderRow extends Row {
  id: string;
  protocol: string;
  base_url: string;
  display_name: string | null;
  secret_ref: string | null;
  headers_json: string;
  is_builtin: number;
  created_at_ms: number;
  updated_at_ms: number;
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

function throwOrphanRef(locations: readonly string[]): never {
  throw new ProviderError(
    "MIGRATION_ORPHAN_POINTER",
    `迁移发现无法映射的 provider 引用：${locations.join("; ")}`,
  );
}

function resolveDisplayName(
  oldId: string,
  raw: string | null,
  isBuiltin: boolean,
): string {
  const trimmed = raw != null ? String(raw).trim() : "";
  if (trimmed !== "") {
    return trimmed;
  }
  if (isBuiltin) {
    return BUILTIN_FRIENDLY_NAME[oldId] ?? oldId;
  }
  return oldId;
}

async function setForeignKeys(tx: TdbcConnection, on: boolean): Promise<void> {
  await tx.execute(`PRAGMA foreign_keys = ${on ? "ON" : "OFF"}`);
}

async function migrateProviderTable(
  tx: TdbcConnection,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();

  await tx.execute(`
    CREATE TABLE llm_provider_new (
      id TEXT PRIMARY KEY,
      builtin_key TEXT UNIQUE,
      protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
      base_url TEXT NOT NULL,
      display_name TEXT NOT NULL,
      secret_ref TEXT,
      headers_json TEXT NOT NULL DEFAULT '{}',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  const legacyRows = await queryTemplate<LegacyProviderRow>(
    tx,
    parser,
    `SELECT id, protocol, base_url, display_name, secret_ref, headers_json,
            is_builtin, created_at_ms, updated_at_ms
     FROM llm_provider`,
    {},
  );

  for (const row of legacyRows) {
    const oldId = String(row.id);
    const isBuiltin =
      Number(row.is_builtin) === 1 || BUILTIN_KEY_TO_UUID[oldId] != null;
    const fixedUuid = BUILTIN_KEY_TO_UUID[oldId];
    const newUuid = fixedUuid ?? randomUUID();
    const builtinKey = fixedUuid != null ? oldId : null;
    const displayName = resolveDisplayName(oldId, row.display_name, isBuiltin);

    await executeTemplate(
      tx,
      parser,
      `INSERT INTO llm_provider_new (
        id, builtin_key, protocol, base_url, display_name, secret_ref,
        headers_json, is_builtin, created_at_ms, updated_at_ms
      ) VALUES (
        #{id}, #{builtinKey}, #{protocol}, #{baseUrl}, #{displayName}, #{secretRef},
        #{headersJson}, #{isBuiltin}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        id: newUuid,
        builtinKey,
        protocol: String(row.protocol),
        baseUrl: String(row.base_url),
        displayName,
        secretRef: row.secret_ref != null ? String(row.secret_ref) : null,
        headersJson: String(row.headers_json ?? "{}"),
        isBuiltin: isBuiltin ? 1 : 0,
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
      },
    );

    mapping.set(oldId, newUuid);
  }

  return mapping;
}

async function rewriteSavedModelProviderIds(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
): Promise<void> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_saved_model'`,
  );
  if (tables.length === 0) {
    return;
  }

  // 事务内 PRAGMA foreign_keys=OFF 无效；用无 FK 临时表重写 provider_id。
  await tx.execute(`DROP INDEX IF EXISTS idx_llm_saved_model_provider`);
  await tx.execute(`
    CREATE TABLE llm_saved_model_remap (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      vendor_model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  const orphans: string[] = [];
  const rows = await queryTemplate<{
    id: string;
    provider_id: string;
    vendor_model_id: string;
    model_name: string;
    settings_json: string;
    created_at_ms: number;
    updated_at_ms: number;
  }>(
    tx,
    parser,
    `SELECT id, provider_id, vendor_model_id, model_name, settings_json,
            created_at_ms, updated_at_ms
     FROM llm_saved_model`,
    {},
  );

  for (const row of rows) {
    const oldId = String(row.provider_id);
    const newId = mapping.get(oldId);
    if (newId === undefined) {
      orphans.push(`llm_saved_model.id=${row.id}: ${oldId}`);
      continue;
    }
    await executeTemplate(
      tx,
      parser,
      `INSERT INTO llm_saved_model_remap (
        id, provider_id, vendor_model_id, model_name, settings_json,
        created_at_ms, updated_at_ms
      ) VALUES (
        #{id}, #{providerId}, #{vendorModelId}, #{modelName}, #{settingsJson},
        #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        id: String(row.id),
        providerId: newId,
        vendorModelId: String(row.vendor_model_id),
        modelName: String(row.model_name),
        settingsJson: String(row.settings_json),
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
      },
    );
  }

  if (orphans.length > 0) {
    throwOrphanRef(orphans);
  }

  await tx.execute(`DROP TABLE llm_saved_model`);
  await tx.execute(
    `ALTER TABLE llm_saved_model_remap RENAME TO llm_saved_model`,
  );
}

async function restoreSavedModelForeignKey(tx: TdbcConnection): Promise<void> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_saved_model'`,
  );
  if (tables.length === 0) {
    return;
  }

  await tx.execute(`DROP INDEX IF EXISTS idx_llm_saved_model_provider`);
  await tx.execute(`
    CREATE TABLE llm_saved_model_fk (
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
    INSERT INTO llm_saved_model_fk (
      id, provider_id, vendor_model_id, model_name, settings_json,
      created_at_ms, updated_at_ms
    )
    SELECT id, provider_id, vendor_model_id, model_name, settings_json,
           created_at_ms, updated_at_ms
    FROM llm_saved_model
  `);
  await tx.execute(`DROP TABLE llm_saved_model`);
  await tx.execute(`ALTER TABLE llm_saved_model_fk RENAME TO llm_saved_model`);
  await tx.execute(`
    CREATE INDEX IF NOT EXISTS idx_llm_saved_model_provider
      ON llm_saved_model(provider_id)
  `);
}

async function renameSkspSecrets(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
): Promise<void> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sksp_secrets'`,
  );
  if (tables.length === 0) {
    return;
  }

  const orphans: string[] = [];
  const rows = await queryTemplate<{ ref: string }>(
    tx,
    parser,
    `SELECT ref FROM sksp_secrets WHERE ref LIKE 'provider/%/apiKey'`,
    {},
  );

  for (const row of rows) {
    const ref = String(row.ref);
    const match = /^provider\/([^/]+)\/apiKey$/.exec(ref);
    if (match == null) {
      continue;
    }
    const oldId = match[1]!;
    const newId = mapping.get(oldId);
    if (newId === undefined) {
      // 可能已是新 UUID（映射值侧）；若既非旧 id 也非新 uuid 则孤儿
      const isNewUuid = [...mapping.values()].includes(oldId);
      if (!isNewUuid) {
        orphans.push(`sksp_secrets.ref: ${ref}`);
      }
      continue;
    }
    if (newId === oldId) {
      continue;
    }
    const newRef = providerApiKeyRef(newId);
    await executeTemplate(
      tx,
      parser,
      `UPDATE sksp_secrets SET ref = #{newRef} WHERE ref = #{oldRef}`,
      { newRef, oldRef: ref },
    );
    await executeTemplate(
      tx,
      parser,
      `UPDATE llm_provider_new SET secret_ref = #{newRef}
       WHERE id = #{id} AND secret_ref = #{oldRef}`,
      { newRef, oldRef: ref, id: newId },
    );
  }

  // 同步行内 secret_ref（即使 sksp 表无对应行）
  for (const [oldId, newId] of mapping) {
    if (oldId === newId) {
      continue;
    }
    const oldRef = providerApiKeyRef(oldId);
    const newRef = providerApiKeyRef(newId);
    await executeTemplate(
      tx,
      parser,
      `UPDATE llm_provider_new SET secret_ref = #{newRef}
       WHERE id = #{id} AND secret_ref = #{oldRef}`,
      { newRef, oldRef, id: newId },
    );
  }

  if (orphans.length > 0) {
    throwOrphanRef(orphans);
  }
}

async function renameSuggestionKeys(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
): Promise<void> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kkv_entry'`,
  );
  if (tables.length === 0) {
    return;
  }

  const orphans: string[] = [];
  const rows = await queryTemplate<{ key: string; value: string }>(
    tx,
    parser,
    `SELECT key, value FROM kkv_entry WHERE module = #{module}`,
    { module: SUGGESTIONS_MODULE },
  );

  for (const row of rows) {
    const oldKey = String(row.key);
    const newKey = mapping.get(oldKey);
    if (newKey === undefined) {
      const isNewUuid = [...mapping.values()].includes(oldKey);
      if (!isNewUuid) {
        orphans.push(`kkv:${SUGGESTIONS_MODULE}/${oldKey}`);
      }
      continue;
    }
    if (newKey === oldKey) {
      continue;
    }
    // 若目标 key 已存在则 fail-fast
    const existing = await queryTemplate<{ key: string }>(
      tx,
      parser,
      `SELECT key FROM kkv_entry WHERE module = #{module} AND key = #{key}`,
      { module: SUGGESTIONS_MODULE, key: newKey },
    );
    if (existing.length > 0) {
      throwOrphanRef([
        `kkv:${SUGGESTIONS_MODULE} 目标 key 已存在: ${oldKey} → ${newKey}`,
      ]);
    }
    await executeTemplate(
      tx,
      parser,
      `UPDATE kkv_entry SET key = #{newKey}
       WHERE module = #{module} AND key = #{oldKey}`,
      { module: SUGGESTIONS_MODULE, newKey, oldKey },
    );
  }

  if (orphans.length > 0) {
    throwOrphanRef(orphans);
  }
}

async function migrateCurrentProviderId(
  tx: TdbcConnection,
  mapping: ReadonlyMap<string, string>,
): Promise<void> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kkv_entry'`,
  );
  if (tables.length === 0) {
    return;
  }

  const rows = await queryTemplate<{ value: string }>(
    tx,
    parser,
    `SELECT value FROM kkv_entry
     WHERE module = #{module} AND key = #{key}`,
    { module: WORKSPACE_STATE_MODULE, key: KEY_CURRENT_PROVIDER_ID },
  );
  if (rows.length === 0) {
    return;
  }

  const current = String(rows[0]!.value).trim();
  if (current === "") {
    return;
  }
  const resolved = mapping.get(current);
  if (resolved === undefined) {
    const isNewUuid = [...mapping.values()].includes(current);
    if (isNewUuid) {
      return;
    }
    throwOrphanRef([
      `kkv:${WORKSPACE_STATE_MODULE}/${KEY_CURRENT_PROVIDER_ID}: ${current}`,
    ]);
  }
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
      key: KEY_CURRENT_PROVIDER_ID,
      value: resolved,
    },
  );
}

async function assertMigratedShape(tx: TdbcConnection): Promise<void> {
  const emptyNames = await tx.query<{ id: string }>(
    `SELECT id FROM llm_provider WHERE display_name IS NULL OR trim(display_name) = ''`,
  );
  if (emptyNames.length > 0) {
    throw new ProviderError(
      "MIGRATION_ORPHAN_POINTER",
      `迁移后仍有空 display_name：${emptyNames.map((r) => r.id).join(", ")}`,
    );
  }

  const builtinMissingKey = await tx.query<{ id: string }>(
    `SELECT id FROM llm_provider WHERE is_builtin = 1 AND (builtin_key IS NULL OR trim(builtin_key) = '')`,
  );
  if (builtinMissingKey.length > 0) {
    throw new ProviderError(
      "MIGRATION_ORPHAN_POINTER",
      `内置行缺少 builtin_key：${builtinMissingKey.map((r) => r.id).join(", ")}`,
    );
  }
}

async function upPathA(tx: TdbcConnection): Promise<void> {
  // 事务内 PRAGMA foreign_keys 无效；子表改写走无 FK 临时表。
  await setForeignKeys(tx, false);
  try {
    const mapping = await migrateProviderTable(tx);
    await rewriteSavedModelProviderIds(tx, mapping);
    await renameSkspSecrets(tx, mapping);
    await renameSuggestionKeys(tx, mapping);
    await migrateCurrentProviderId(tx, mapping);

    await tx.execute(`DROP TABLE llm_provider`);
    await tx.execute(`ALTER TABLE llm_provider_new RENAME TO llm_provider`);
    await restoreSavedModelForeignKey(tx);

    await assertMigratedShape(tx);
  } finally {
    await setForeignKeys(tx, true);
  }
}

async function up(tx: TdbcConnection): Promise<void> {
  const columns = await getTableColumns(tx, "llm_provider");
  // 路径 B：仅当存在 builtin_key 列时视为已迁移形态（禁止用 has("id")）。
  if (columns.has("builtin_key")) {
    return;
  }

  await upPathA(tx);
}

/** provider UUID 身份 migration（路径 A 表重建 + 引用级联；路径 B no-op）。 */
export const providerIdentityV1Migration: SchemaMigration = {
  id: PROVIDER_IDENTITY_V1_ID,
  up,
};

export { up as providerIdentityV1Up };
