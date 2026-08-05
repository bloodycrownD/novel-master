import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  dumpProviderTableSnapshot,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  ProviderTableSnapshotError,
  restoreProviderTableSnapshot,
  scrubProviderTables,
  scrubProviderTablesInDatabase,
  type ProviderTableSnapshot,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { isSchemaMigrationApplied } from "../../src/bootstrap/schema-migrations/index.js";
import { SAVED_MODEL_IDENTITY_V1_ID } from "../../src/bootstrap/schema-migrations/saved-model-identity-v1.js";
import {
  execLegacySavedModelTable,
  seedLegacySavedModelRows,
} from "../bootstrap/helpers/legacy-db-fixtures.js";

const NOW_MS = 1_700_000_000_000;

/** 注册 better-sqlite3 驱动并打开内存库（不 bootstrap）。 */
async function openRawMemoryDb(): Promise<TdbcConnection> {
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

/** 注册 better-sqlite3 驱动并打开已 bootstrap 的内存库。 */
async function openMemoryDb(): Promise<TdbcConnection> {
  const conn = await openRawMemoryDb();
  await bootstrapNovelMaster(conn);
  return conn;
}

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-000000000001";

/** 写入测试用服务商与密钥行（与 bootstrap DDL 列对齐）。 */
async function seedTestProviderData(conn: TdbcConnection): Promise<void> {
  await conn.execute(
    `INSERT INTO llm_provider (
      id, protocol, base_url, display_name, secret_ref,
      headers_json, is_builtin, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "custom-openai",
      "openai",
      "https://api.example.com/v1",
      "Custom OpenAI",
      "sksp:custom-openai-key",
      "{}",
      0,
      NOW_MS,
      NOW_MS,
    ],
  );
  await conn.execute(
    `INSERT INTO llm_saved_model (
      id, provider_id, vendor_model_id, model_name,
      settings_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      TEST_SAVED_MODEL_ID,
      "custom-openai",
      "gpt-test",
      "GPT Test",
      '{"temperature":0.7}',
      NOW_MS,
      NOW_MS,
    ],
  );
  await conn.execute(
    `INSERT INTO sksp_secrets (
      ref, ciphertext, iv, algo, version, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "sksp:custom-openai-key",
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      "aes-gcm",
      1,
      NOW_MS,
    ],
  );
}

/** 统计三张服务商表总行数。 */
async function countProviderRows(conn: TdbcConnection): Promise<number> {
  let total = 0;
  for (const table of [
    "sksp_secrets",
    "llm_provider",
    "llm_saved_model",
  ] as const) {
    const rows = await conn.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    );
    total += Number(rows[0]!.count);
  }
  return total;
}

/** 将快照按表名排序后序列化，便于断言行级相等。 */
function normalizeSnapshot(snapshot: ProviderTableSnapshot): string {
  const normalized: Record<string, unknown[]> = {};
  for (const table of [
    "sksp_secrets",
    "llm_provider",
    "llm_saved_model",
  ] as const) {
    normalized[table] = [...snapshot[table]].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return JSON.stringify(normalized);
}

/** 构造一份与 seedTestProviderData 等价的快照，供非法变体用例改写后注入。 */
function buildValidSnapshot(): ProviderTableSnapshot {
  return {
    llm_provider: [
      {
        id: "custom-openai",
        builtin_key: null,
        protocol: "openai",
        base_url: "https://api.example.com/v1",
        display_name: "Custom OpenAI",
        secret_ref: "sksp:custom-openai-key",
        headers_json: "{}",
        is_builtin: 0,
        created_at_ms: NOW_MS,
        updated_at_ms: NOW_MS,
      },
    ],
    llm_saved_model: [
      {
        id: TEST_SAVED_MODEL_ID,
        provider_id: "custom-openai",
        vendor_model_id: "gpt-test",
        model_name: "GPT Test",
        settings_json: '{"temperature":0.7}',
        created_at_ms: NOW_MS,
        updated_at_ms: NOW_MS,
      },
    ],
    sksp_secrets: [
      {
        ref: "sksp:custom-openai-key",
        ciphertext: new Uint8Array([1, 2, 3, 4]),
        iv: new Uint8Array([5, 6, 7, 8]),
        algo: "aes-gcm",
        version: 1,
        updated_at_ms: NOW_MS,
      },
    ],
  };
}

describe("provider-table-snapshot", () => {
  it("DB-1: scrub 后三张服务商表行数为 0", async () => {
    const conn = await openMemoryDb();
    try {
      await seedTestProviderData(conn);
      assert.ok((await countProviderRows(conn)) > 0);
      await scrubProviderTables(conn);
      assert.equal(await countProviderRows(conn), 0);
    } finally {
      await conn.close();
    }
  });

  it("DB-2: dump → 新库 scrub → restore 后数据一致", async () => {
    const source = await openMemoryDb();
    const target = await openMemoryDb();
    try {
      await seedTestProviderData(source);
      const snapshot = await dumpProviderTableSnapshot(source);

      await scrubProviderTables(target);
      await restoreProviderTableSnapshot(target, snapshot);

      assert.equal(
        normalizeSnapshot(await dumpProviderTableSnapshot(target)),
        normalizeSnapshot(snapshot),
      );
    } finally {
      await source.close();
      await target.close();
    }
  });

  it("DB-3: ATTACH 副本 scrub 后附件库无服务商行且主库不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-db-backup-"));
    const attachPath = join(dir, "export.db");
    const mainConn = await openMemoryDb();

    try {
      await seedTestProviderData(mainConn);
      const mainRowsBefore = await countProviderRows(mainConn);

      const exportConn = await open(`tdbc:sqlite:file:${attachPath}`, {
        driver: BETTER_SQLITE3_DRIVER_NAME,
      });
      await bootstrapNovelMaster(exportConn);
      await seedTestProviderData(exportConn);
      assert.ok((await countProviderRows(exportConn)) > 0);
      await exportConn.close();

      await scrubProviderTablesInDatabase(mainConn, attachPath, "export_db");

      assert.equal(await countProviderRows(mainConn), mainRowsBefore);

      const verifyConn = await open(`tdbc:sqlite:file:${attachPath}`, {
        driver: BETTER_SQLITE3_DRIVER_NAME,
      });
      assert.equal(await countProviderRows(verifyConn), 0);
      await verifyConn.close();
    } finally {
      await mainConn.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T-SM9：legacy snapshot restore 后 rebootstrap 触发 v1 path A", async () => {
    const source = await openRawMemoryDb();
    const target = await openRawMemoryDb();
    try {
      await execLegacySavedModelTable(source);
      await seedLegacySavedModelRows(source);
      await execBootstrapSchemaDdl(source);
      const snapshot = await dumpProviderTableSnapshot(source);

      await execLegacySavedModelTable(target);
      await execBootstrapSchemaDdl(target);
      await scrubProviderTables(target);
      await restoreProviderTableSnapshot(target, snapshot);
      await bootstrapNovelMaster(target);

      const columns = await tableColumnNames(target, "llm_saved_model");
      assert.ok(columns.has("id"));
      assert.ok(columns.has("model_name"));
      assert.equal(columns.has("display_name"), false);

      const rows = await target.query<{ id: string; model_name: string }>(
        `SELECT id, model_name FROM llm_saved_model ORDER BY vendor_model_id`,
      );
      assert.equal(rows.length, 2);
      assert.equal(new Set(rows.map((row) => row.id)).size, 2);
      assert.match(rows[0]!.id, /^[0-9a-f-]{36}$/i);
      assert.equal(
        await isSchemaMigrationApplied(target, SAVED_MODEL_IDENTITY_V1_ID),
        true,
      );
    } finally {
      await source.close();
      await target.close();
    }
  });
});

describe("restoreProviderTableSnapshot 校验闸门 (T-SC12)", () => {
  it("T-SC12a：非法 protocol 被拒，主库未被 scrub", async () => {
    const conn = await openMemoryDb();
    try {
      await seedTestProviderData(conn);
      const before = await countProviderRows(conn);

      const snapshot = buildValidSnapshot();
      (snapshot.llm_provider[0]! as Record<string, unknown>).protocol =
        "unknown-protocol";

      await assert.rejects(
        () => restoreProviderTableSnapshot(conn, snapshot),
        (err: unknown) => {
          assert.ok(err instanceof ProviderTableSnapshotError);
          assert.equal(err.code, "INVALID_PROVIDER_ROW");
          assert.equal(err.table, "llm_provider");
          return true;
        },
      );
      // 校验在事务外抛错，主库行数应保持原样
      assert.equal(await countProviderRows(conn), before);
    } finally {
      await conn.close();
    }
  });

  it("T-SC12b：空 display_name 被拒", async () => {
    const conn = await openMemoryDb();
    try {
      const snapshot = buildValidSnapshot();
      (snapshot.llm_provider[0]! as Record<string, unknown>).display_name =
        "   ";
      await assert.rejects(
        () => restoreProviderTableSnapshot(conn, snapshot),
        (err: unknown) => {
          assert.ok(err instanceof ProviderTableSnapshotError);
          assert.equal(err.code, "INVALID_PROVIDER_ROW");
          return true;
        },
      );
    } finally {
      await conn.close();
    }
  });

  it("T-SC12c：saved_model 悬空 provider_id 被拒", async () => {
    const conn = await openMemoryDb();
    try {
      const snapshot = buildValidSnapshot();
      (snapshot.llm_saved_model[0]! as Record<string, unknown>).provider_id =
        "nonexistent-provider";
      await assert.rejects(
        () => restoreProviderTableSnapshot(conn, snapshot),
        (err: unknown) => {
          assert.ok(err instanceof ProviderTableSnapshotError);
          assert.equal(err.code, "DANGLING_SAVED_MODEL");
          assert.equal(err.table, "llm_saved_model");
          return true;
        },
      );
    } finally {
      await conn.close();
    }
  });

  it("T-SC12d：sksp_secrets 缺 ciphertext 被拒", async () => {
    const conn = await openMemoryDb();
    try {
      const snapshot = buildValidSnapshot();
      delete (snapshot.sksp_secrets[0]! as Record<string, unknown>).ciphertext;
      await assert.rejects(
        () => restoreProviderTableSnapshot(conn, snapshot),
        (err: unknown) => {
          assert.ok(err instanceof ProviderTableSnapshotError);
          assert.equal(err.code, "INVALID_SECRET_ROW");
          return true;
        },
      );
    } finally {
      await conn.close();
    }
  });

  it("T-SC12e：合法快照仍能正常 restore", async () => {
    const conn = await openMemoryDb();
    try {
      await scrubProviderTables(conn);
      const snapshot = buildValidSnapshot();
      await restoreProviderTableSnapshot(conn, snapshot);
      assert.ok((await countProviderRows(conn)) > 0);
    } finally {
      await conn.close();
    }
  });
});
