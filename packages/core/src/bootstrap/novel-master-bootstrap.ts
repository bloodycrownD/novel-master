/**
 * Aggregated schema bootstrap for Novel Master SQLite databases.
 *
 * Runs idempotent DDL (`CREATE IF NOT EXISTS`), pragma-guarded column migrations,
 * KKV purges/moves, and provider seeding inside a single transaction.
 *
 * **Column migrations** (legacy DBs): `chat_message.hidden`, `vfs_entry.entry_kind`,
 * `session_execute_batch.message_id`, regex depth rename, `llm_saved_model.settings_json`,
 * `llm_provider.default_model_id` drop, `agent_definition` legacy column drop.
 *
 * **KKV migrations**: purge `nm-model-sampling` + `global-config`; move Client UI
 * behavior keys → `nm-preferences` (Preferences v2).
 *
 * **Data backfills**: `worktree_dir_rule.fill_policy` `full` → `hidden`.
 *
 * @module bootstrap/novel-master-bootstrap
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { VFS_SCHEMA_STATEMENTS } from "./vfs/vfs-schema.js";
import { KKV_SCHEMA_STATEMENTS } from "./kkv/kkv-schema.js";
import { CHAT_SCHEMA_STATEMENTS } from "./chat/chat-schema.js";
import { SESSION_FS_SCHEMA_STATEMENTS } from "./session-fs/session-fs-schema.js";
import { WORKTREE_SCHEMA_STATEMENTS } from "./worktree/worktree-schema.js";
import { SKSP_SCHEMA_STATEMENTS } from "./sksp/sksp-schema.js";
import { PROVIDER_SCHEMA_STATEMENTS } from "./provider/provider-schema.js";
import { REGEX_SCHEMA_STATEMENTS } from "./regex/regex-schema.js";
import { AGENT_SCHEMA_STATEMENTS } from "./agent/agent-schema.js";
import { migrateDropAgentDefinitionLegacyColumns } from "./agent/migrate-drop-agent-definition-legacy-columns.js";
import { seedBuiltinProviders } from "./provider/seed-builtin-providers.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { migrateChatMessageHidden } from "./chat/migrate-chat-message-hidden.js";
import { migrateVfsEntryKind } from "./vfs/migrate-vfs-entry-kind.js";
import { migrateWorktreeFillPolicy } from "./worktree/migrate-worktree-fill-policy.js";
import { migrateClientUiBehaviorPrefsToPreferences } from "./preferences/migrate-client-ui-behavior-prefs.js";
import { migratePurgeGlobalConfigKkv } from "./preferences/migrate-purge-global-config-kkv.js";
import { migratePurgeRemovedPreferenceKeys } from "./preferences/migrate-purge-removed-preference-keys.js";
import {
  migrateAddSavedModelSettingsJson,
  migrateDropLlmModelSuggestionTable,
  migratePurgeNmModelSamplingKkv,
} from "./provider/migrate-model-context-settings.js";
/** All module DDL statements in dependency-safe execution order. */
export const NOVEL_MASTER_SCHEMA_STATEMENTS: readonly string[] = [
  ...VFS_SCHEMA_STATEMENTS,
  ...KKV_SCHEMA_STATEMENTS,
  ...CHAT_SCHEMA_STATEMENTS,
  ...SESSION_FS_SCHEMA_STATEMENTS,
  ...WORKTREE_SCHEMA_STATEMENTS,
  ...SKSP_SCHEMA_STATEMENTS,
  ...PROVIDER_SCHEMA_STATEMENTS,
  ...REGEX_SCHEMA_STATEMENTS,
  ...AGENT_SCHEMA_STATEMENTS,
];

/**
 * Ensures all entity tables exist and applies inline migrations. Safe to call multiple times.
 *
 * @param conn - Open TDBC connection
 */
async function migrateDropProviderDefaultModelId(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('llm_provider')",
  );
  const names = rows.map((r) => String(r.name));
  if (names.includes("default_model_id")) {
    await tx.execute(
      "ALTER TABLE llm_provider DROP COLUMN default_model_id",
    );
  }
}

async function migrateAddBatchMessageId(tx: TdbcConnection): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('session_execute_batch')",
  );
  const names = rows.map((r) => String(r.name));
  if (!names.includes("message_id")) {
    await tx.execute(
      "ALTER TABLE session_execute_batch ADD COLUMN message_id TEXT",
    );
  }
}

async function migrateRegexRuleDepthColumns(tx: TdbcConnection): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('regex_rule')",
  );
  const names = rows.map((r) => String(r.name));
  if (names.includes("min_depth") && !names.includes("start_depth")) {
    await tx.execute(
      "ALTER TABLE regex_rule RENAME COLUMN min_depth TO start_depth",
    );
    await tx.execute(
      "ALTER TABLE regex_rule RENAME COLUMN max_depth TO end_depth",
    );
  }
}

export async function bootstrapNovelMaster(conn: TdbcConnection): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    await migrateRegexRuleDepthColumns(tx);
    await migrateAddBatchMessageId(tx);
    await migrateChatMessageHidden(tx);
    await migrateVfsEntryKind(tx);
    await migrateWorktreeFillPolicy(tx);
    await migrateDropProviderDefaultModelId(tx);
    await migrateDropAgentDefinitionLegacyColumns(tx);
    const kkv = createKkvService(tx);
    await migratePurgeNmModelSamplingKkv(kkv);
    await migratePurgeGlobalConfigKkv(kkv);
    await migrateDropLlmModelSuggestionTable(tx);
    await migrateAddSavedModelSettingsJson(tx);
    await migrateClientUiBehaviorPrefsToPreferences(kkv);
    await migratePurgeRemovedPreferenceKeys(kkv);
    await seedBuiltinProviders(tx);
  });
}
