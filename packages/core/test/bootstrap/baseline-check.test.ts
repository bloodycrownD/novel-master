import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { open, type TdbcConnection } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  BASELINE_MIGRATION_IDS,
  BASELINE_TOO_OLD_MESSAGE,
  bootstrapNovelMaster,
  assertMinimumBaseline,
} from "../../src/bootstrap/novel-master-bootstrap.js";
import { ensureSchemaMigrationsTable } from "../../src/bootstrap/schema-migrations/schema-migrations-table.js";
import {
  execLegacyChatProjectWithAgentConfig,
  execLegacySavedModelTable,
  execLegacyV107ChatDdl,
  execLegacyVfsEntryTable,
  execLegacyWorktreeRuleTables,
} from "./helpers/legacy-db-fixtures.js";

/** 打开一个内存库连接。 */
async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

describe("bootstrap 版本基线检查（T-BL1 / T-BL2）", () => {
  it("T-BL1：缺旧 migration id + legacy 形态 → fail-fast", async () => {
    // 先建出 legacy 形态：llm_saved_model 无 id 列。
    const conn = await openMemoryConn();
    await execLegacySavedModelTable(conn);

    // schema_migrations 表里一条 baseline id 都没有登记。
    await ensureSchemaMigrationsTable(conn);
    await assert.rejects(
      assertMinimumBaseline(conn),
      (err: unknown) =>
        err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
      "legacy 形态 + 缺 baseline 登记，应抛出 v1.4.27 升级提示"
    );
  });

  it("T-BL1（worktree 形态）：缺旧 migration id + worktree_* 表 → fail-fast", async () => {
    const conn = await openMemoryConn();
    // 仅建 worktree_* 而不建 legacy llm_saved_model，覆盖另一个探测分支。
    await execLegacyWorktreeRuleTables(conn);

    await ensureSchemaMigrationsTable(conn);
    await assert.rejects(
      assertMinimumBaseline(conn),
      (err: unknown) =>
        err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
      "worktree_* 残留 + 缺 baseline 登记，应抛出 v1.4.27 升级提示"
    );
  });

  it("T-BL1（vfs_entry 旧主键形态）：path 作 pk + 缺 baseline 登记 → fail-fast", async () => {
    const conn = await openMemoryConn();
    // vfs-entry-id-redesign-v1 之前的形态：主键是 path，无 entry_id 主键。
    await execLegacyVfsEntryTable(conn);

    await ensureSchemaMigrationsTable(conn);
    await assert.rejects(
      assertMinimumBaseline(conn),
      (err: unknown) =>
        err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
      "vfs_entry 旧主键形态 + 缺 baseline 登记，应抛出 v1.4.27 升级提示"
    );
  });

  it("T-BL1（chat_session 缺 agent_config_json）：缺 baseline 登记 → fail-fast", async () => {
    const conn = await openMemoryConn();
    // session-agent-config-v2 之前的形态：chat_session 无 agent_config_json 列。
    await execLegacyV107ChatDdl(conn);

    await ensureSchemaMigrationsTable(conn);
    await assert.rejects(
      assertMinimumBaseline(conn),
      (err: unknown) =>
        err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
      "chat_session 缺 agent_config_json + 缺 baseline 登记，应抛出 v1.4.27 升级提示"
    );
  });

  it("T-BL1（chat_project 配置残留）：agent_config_json 非 NULL + 缺 baseline 登记 → fail-fast", async () => {
    const conn = await openMemoryConn();
    // project-agent-config-cleanup-v1 之前的形态：列里残留非 NULL 配置。
    await execLegacyChatProjectWithAgentConfig(conn);

    await ensureSchemaMigrationsTable(conn);
    await assert.rejects(
      assertMinimumBaseline(conn),
      (err: unknown) =>
        err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
      "chat_project 配置残留 + 缺 baseline 登记，应抛出 v1.4.27 升级提示"
    );
  });

  it("T-BL2：schema_migrations 含旧 id → 不触发 fail-fast", async () => {
    // 已 apply 用户：表里有至少一条 baseline id。
    const conn = await openMemoryConn();
    await execLegacySavedModelTable(conn);
    await ensureSchemaMigrationsTable(conn);

    const sentinelId = BASELINE_MIGRATION_IDS[0]!;
    await conn.execute(
      `INSERT INTO schema_migrations (id, applied_at_ms) VALUES (?, ?)`,
      [sentinelId, Date.now()]
    );

    // 不应抛错。
    await assertMinimumBaseline(conn);
    assert.ok(true, "已登记 baseline id 时不触发 fail-fast");
  });

  it("T-BL2（空库）：全新数据库无 legacy 形态 → 不触发 fail-fast", async () => {
    // 新装路径：没有任何实体表，也没有登记任何 migration，但也没有 legacy 表征。
    const conn = await openMemoryConn();
    await ensureSchemaMigrationsTable(conn);
    await assertMinimumBaseline(conn);
    assert.ok(true, "全新空库不触发 fail-fast");
  });

  it("bootstrapNovelMaster 在 legacy 形态下整体 fail-fast（端到端）", async () => {
    const conn = await openMemoryConn();
    await execLegacySavedModelTable(conn);

    await assert.rejects(
      bootstrapNovelMaster(conn),
      (err: unknown) =>
        err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
      "bootstrapNovelMaster 应在 migration runner 之前 fail-fast"
    );
  });
});
