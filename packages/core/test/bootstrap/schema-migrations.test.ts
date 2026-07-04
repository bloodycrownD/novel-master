import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, mock } from "node:test";
import {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { TdbcError } from "../../src/infra/tdbc/errors.js";
import {
  isSchemaMigrationApplied,
  markSchemaMigrationApplied,
  SCHEMA_MIGRATIONS,
} from "../../src/bootstrap/schema-migrations/index.js";
import { SAVED_MODEL_IDENTITY_V1_ID } from "../../src/bootstrap/schema-migrations/saved-model-identity-v1.js";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/logic/registry.js";
import {
  execLegacySavedModelTable,
  LEGACY_DB_NOW_MS,
  seedLegacySavedModelRows,
} from "./helpers/legacy-db-fixtures.js";

const NOW_MS = LEGACY_DB_NOW_MS;

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async has(ref) {
      return map.has(ref);
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
  };
}

async function openMemoryConn() {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function tableColumnNames(
  conn: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => row.name));
}

async function execBootstrapSchemaDdl(conn: TdbcConnection): Promise<void> {
  for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
    await conn.execute(sql);
  }
}

function unwrapProviderError(error: unknown): ProviderError | null {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof TdbcError && error.cause instanceof ProviderError) {
    return error.cause;
  }
  return null;
}

/** B3：迁移后 KKV / agent / project 不应残留含 `/` 的 legacy 模型指针。 */
async function assertNoLegacyModelPointers(conn: TdbcConnection): Promise<void> {
  const kkv = await conn.query<{ value: string }>(
    `SELECT value FROM kkv_entry WHERE module = ? AND key = ?`,
    ["nm-workspace-state", "currentModelId"],
  );
  for (const row of kkv) {
    const value = row.value.trim();
    if (value.length > 0) {
      assert.equal(value.includes("/"), false, `kkv currentModelId: ${value}`);
    }
  }

  const agents = await conn.query<{ agent_id: string; prompts_json: string }>(
    `SELECT agent_id, prompts_json FROM agent_definition`,
  );
  for (const row of agents) {
    const wire = JSON.parse(row.prompts_json) as { model?: string };
    if (typeof wire.model === "string" && wire.model.trim().length > 0) {
      assert.equal(
        wire.model.includes("/"),
        false,
        `agent_definition:${row.agent_id}: ${wire.model}`,
      );
    }
  }

  const projects = await conn.query<{
    id: string;
    agent_config_json: string | null;
  }>(`SELECT id, agent_config_json FROM chat_project`);
  for (const row of projects) {
    if (row.agent_config_json == null) {
      continue;
    }
    const config = JSON.parse(row.agent_config_json) as {
      definition?: { model?: string };
    };
    const model = config.definition?.model;
    if (typeof model === "string" && model.trim().length > 0) {
      assert.equal(
        model.includes("/"),
        false,
        `chat_project:${row.id}: ${model}`,
      );
    }
  }
}

describe("schema migrations（T-SM1 / T-SM2 框架）", () => {
  it("空库 bootstrap 后存在 schema_migrations 表且含 saved-model-identity-v1（T-SM1）", async () => {
    const conn = await openMemoryConn();
    try {
      await bootstrapNovelMaster(conn);
      const tables = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
      );
      assert.equal(tables.length, 1);
      assert.equal(
        await isSchemaMigrationApplied(conn, SAVED_MODEL_IDENTITY_V1_ID),
        true,
      );
    } finally {
      await conn.close();
    }
  });

  it("二次 bootstrap 幂等且不重复登记 migration id（T-SM2）", async () => {
    const conn = await openMemoryConn();
    try {
      await bootstrapNovelMaster(conn);
      await bootstrapNovelMaster(conn);
      const rows = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = ?`,
        [SAVED_MODEL_IDENTITY_V1_ID],
      );
      assert.equal(rows.length, 1);
    } finally {
      await conn.close();
    }
  });

  it("SCHEMA_MIGRATIONS 注册 id 唯一", () => {
    const ids = SCHEMA_MIGRATIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("markSchemaMigrationApplied 后 isSchemaMigrationApplied 为 true", async () => {
    const conn = await openMemoryConn();
    try {
      await conn.transaction(async (tx) => {
        const { ensureSchemaMigrationsTable } = await import(
          "../../src/bootstrap/schema-migrations/schema-migrations-table.js"
        );
        await ensureSchemaMigrationsTable(tx);
        assert.equal(await isSchemaMigrationApplied(tx, "test-v0"), false);
        await markSchemaMigrationApplied(tx, "test-v0", 1);
        assert.equal(await isSchemaMigrationApplied(tx, "test-v0"), true);
      });
    } finally {
      await conn.close();
    }
  });
});

describe("saved-model-identity-v1 migration", () => {
  it("T-SM11：新库 canonical DDL 首次 bootstrap 登记 v1 且无表重建", async () => {
    const conn = await openMemoryConn();
    try {
      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "llm_saved_model");
      assert.ok(columns.has("id"));
      assert.ok(columns.has("model_name"));
      assert.equal(
        await isSchemaMigrationApplied(conn, SAVED_MODEL_IDENTITY_V1_ID),
        true,
      );

      const tempTable = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_saved_model_new'`,
      );
      assert.equal(tempTable.length, 0);
    } finally {
      await conn.close();
    }
  });

  it("T-SM3：legacy 库跑 v1 后含 id 列、行数不变、每行 id 唯一", async () => {
    const conn = await openMemoryConn();
    try {
      await execLegacySavedModelTable(conn);
      await seedLegacySavedModelRows(conn);
      await execBootstrapSchemaDdl(conn);

      const beforeCount = await conn.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM llm_saved_model`,
      );
      assert.equal(Number(beforeCount[0]!.count), 2);

      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "llm_saved_model");
      assert.ok(columns.has("id"));
      assert.ok(columns.has("model_name"));
      assert.equal(columns.has("display_name"), false);

      const afterRows = await conn.query<{
        id: string;
        model_name: string;
        vendor_model_id: string;
      }>(`SELECT id, model_name, vendor_model_id FROM llm_saved_model ORDER BY vendor_model_id`);
      assert.equal(afterRows.length, 2);
      assert.equal(new Set(afterRows.map((row) => row.id)).size, 2);
      assert.match(afterRows[0]!.id, /^[0-9a-f-]{36}$/i);
      assert.equal(afterRows[0]!.model_name, "gpt-4o");
      assert.equal(afterRows[1]!.model_name, "写作专用");
      assert.equal(
        await isSchemaMigrationApplied(conn, SAVED_MODEL_IDENTITY_V1_ID),
        true,
      );
    } finally {
      await conn.close();
    }
  });

  it("T-SM12：孤儿 legacy 指针 migration fail-fast 且事务回滚", async () => {
    const conn = await openMemoryConn();
    try {
      await execLegacySavedModelTable(conn);
      await seedLegacySavedModelRows(conn);
      await execBootstrapSchemaDdl(conn);
      await conn.execute(
        `INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?)`,
        ["nm-workspace-state", "currentModelId", "openai/unknown-model"],
      );

      await assert.rejects(
        () => bootstrapNovelMaster(conn),
        (error: unknown) =>
          unwrapProviderError(error)?.code === "MIGRATION_ORPHAN_POINTER",
      );

      const columns = await tableColumnNames(conn, "llm_saved_model");
      assert.equal(columns.has("id"), false);
      assert.equal(columns.has("display_name"), true);

      const migrationTable = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
      );
      assert.equal(migrationTable.length, 0);

      const kkv = await conn.query<{ value: string }>(
        `SELECT value FROM kkv_entry WHERE module = ? AND key = ?`,
        ["nm-workspace-state", "currentModelId"],
      );
      assert.equal(kkv[0]!.value, "openai/unknown-model");
    } finally {
      await conn.close();
    }
  });

  it("T-SM4：legacy currentModelId 迁移后为 UUID 且 request 可解析", async () => {
    const conn = await openMemoryConn();
    const agentId = randomUUID();
    const projectId = randomUUID();
    try {
      await execLegacySavedModelTable(conn);
      await seedLegacySavedModelRows(conn);
      await execBootstrapSchemaDdl(conn);
      await conn.execute(
        `INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?)`,
        ["nm-workspace-state", "currentModelId", "openai/gpt-4o"],
      );
      await conn.execute(
        `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?)`,
        [
          agentId,
          JSON.stringify({
            schemaVersion: 1,
            name: "test-agent",
            prompts: { persist: {}, dynamic: {} },
            model: "openai/gpt-4o-mini",
          }),
          NOW_MS,
          NOW_MS,
        ],
      );
      await conn.execute(
        `INSERT INTO chat_project (id, name, agent_config_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          projectId,
          "legacy-project",
          JSON.stringify({
            mode: "custom",
            definition: {
              name: "项目助手",
              prompts: { persist: {}, dynamic: {} },
              model: "openai/gpt-4o",
            },
          }),
          NOW_MS,
          NOW_MS,
        ],
      );

      await bootstrapNovelMaster(conn);

      const kkv = await conn.query<{ value: string }>(
        `SELECT value FROM kkv_entry WHERE module = ? AND key = ?`,
        ["nm-workspace-state", "currentModelId"],
      );
      const currentModelId = kkv[0]!.value;
      assert.match(currentModelId, /^[0-9a-f-]{36}$/i);
      assert.equal(currentModelId.includes("/"), false);

      const saved = await conn.query<{ id: string }>(
        `SELECT id FROM llm_saved_model WHERE vendor_model_id = ?`,
        ["gpt-4o"],
      );
      assert.equal(saved[0]!.id, currentModelId);

      await assertNoLegacyModelPointers(conn);

      clearProtocolAdapters();
      const fetchFn = mock.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      getProtocolAdapter("openai", fetchFn as typeof fetch);

      const secrets = memorySecretStore();
      await secrets.set("provider/openai/apiKey", "sk-test");
      const bundle = createProviderServices(conn, secrets);
      const out = await bundle.modelRequests.request(currentModelId, "hi");
      assert.equal(out.assistantText, "ok");
      clearProtocolAdapters();
    } finally {
      await conn.close();
    }
  });

  it("T-SM7：chat_project.agent_config_json legacy model 迁移后为 UUID", async () => {
    const conn = await openMemoryConn();
    const projectId = randomUUID();
    try {
      await execLegacySavedModelTable(conn);
      await seedLegacySavedModelRows(conn);
      await execBootstrapSchemaDdl(conn);
      await conn.execute(
        `INSERT INTO chat_project (id, name, agent_config_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          projectId,
          "legacy-project",
          JSON.stringify({
            mode: "custom",
            definition: {
              name: "项目助手",
              prompts: { persist: {}, dynamic: {} },
              model: "openai/gpt-4o-mini",
            },
          }),
          NOW_MS,
          NOW_MS,
        ],
      );

      await bootstrapNovelMaster(conn);

      const rows = await conn.query<{ agent_config_json: string }>(
        `SELECT agent_config_json FROM chat_project WHERE id = ?`,
        [projectId],
      );
      const config = JSON.parse(rows[0]!.agent_config_json) as {
        definition?: { model?: string };
      };
      const model = config.definition?.model ?? "";
      assert.match(model, /^[0-9a-f-]{36}$/i);
      assert.equal(model.includes("/"), false);

      const saved = await conn.query<{ id: string }>(
        `SELECT id FROM llm_saved_model WHERE vendor_model_id = ?`,
        ["gpt-4o-mini"],
      );
      assert.equal(saved[0]!.id, model);
    } finally {
      await conn.close();
    }
  });

  it("legacy agent_definition.model 迁移后为 UUID", async () => {
    const conn = await openMemoryConn();
    const agentId = randomUUID();
    try {
      await execLegacySavedModelTable(conn);
      await seedLegacySavedModelRows(conn);
      await execBootstrapSchemaDdl(conn);
      await conn.execute(
        `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?)`,
        [
          agentId,
          JSON.stringify({
            schemaVersion: 1,
            name: "test-agent",
            prompts: { persist: {}, dynamic: {} },
            model: "openai/gpt-4o-mini",
          }),
          NOW_MS,
          NOW_MS,
        ],
      );

      await bootstrapNovelMaster(conn);

      const rows = await conn.query<{ prompts_json: string }>(
        `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`,
        [agentId],
      );
      const wire = JSON.parse(rows[0]!.prompts_json) as { model?: string };
      assert.match(wire.model ?? "", /^[0-9a-f-]{36}$/i);
    } finally {
      await conn.close();
    }
  });
});
