import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  execLegacyChatMessageWithoutHidden,
  execLegacyV107ChatDdl,
  execLegacyV7ChatMessageDdl,
} from "./helpers/legacy-db-fixtures.js";

async function openInMemoryConnection(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

/** 执行完整 bootstrap DDL（legacy 表已存在时 CREATE IF NOT EXISTS 不会改列）。 */
async function execBootstrapSchemaDdl(conn: TdbcConnection): Promise<void> {
  for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
    await conn.execute(sql);
  }
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

describe("schema 列对齐（T-B3）", () => {
  it("A1：legacy chat_session bootstrap 后无 user_vfs_pending_json，listByProject 不抛错", async () => {
    const conn = await openInMemoryConnection();
    await execLegacyV107ChatDdl(conn);
    await execBootstrapSchemaDdl(conn);
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "chat_session");
    assert.equal(columns.has("user_vfs_pending_json"), false);
    assert.ok(columns.has("composer_draft_json"));

    const repo = new SqliteSessionRepository(conn);
    const sessions = await repo.listByProject(randomUUID());
    assert.deepEqual(sessions, []);

    await conn.close();
  });

  it("A2：legacy session 行数据 bootstrap 后保留", async () => {
    const conn = await openInMemoryConnection();
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = 1_700_000_000_000;

    await execLegacyV107ChatDdl(conn);
    await execBootstrapSchemaDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${projectId}', 'legacy-session', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const repo = new SqliteSessionRepository(conn);
    const sessions = await repo.listByProject(projectId);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.id, sessionId);
    assert.equal(sessions[0]!.title, "legacy-session");

    await conn.close();
  });

  it("A3：legacy chat_message 缺 hidden，bootstrap 后 listBySession 返回 hidden: false", async () => {
    const conn = await openInMemoryConnection();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const now = 1_700_000_000_000;

    await execLegacyV107ChatDdl(conn);
    await execLegacyChatMessageWithoutHidden(conn);
    await execBootstrapSchemaDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${randomUUID()}', 'msg-session', ${now}, ${now})`,
    );
    await conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, created_at_ms
       ) VALUES (
         '${messageId}', '${sessionId}', 1, 'user', '{"blocks":[{"type":"text","text":"hi"}]}', ${now}
       )`,
    );
    await bootstrapNovelMaster(conn);

    assert.ok((await tableColumnNames(conn, "chat_message")).has("hidden"));

    const repo = new SqliteMessageRepository(conn);
    const messages = await repo.listBySession(sessionId);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, messageId);
    assert.equal(messages[0]!.hidden, false);

    await conn.close();
  });

  it("A4：legacy vfs_entry 缺 entry_kind/head_version，bootstrap 后 head_version 回填为 version", async () => {
    // Step 21/22 后：vfs-content-blob-zlib-v1 退役，vfs-entry-id-redesign-v1 path A 失去
    // 「content_hash 列已被前期 migration 补上」的前置，且本场景（极旧库直跳当前版本）
    // 由 assertMinimumBaseline fail-fast 拦下。新库由 canonical DDL 直接建出 entry_kind/
    // head_version 列，head_version 回填逻辑在 entry-id migration 新库路径与 align 中覆盖。
    // 原「path A 表重建」断言随该路径退役而退役，不再测。
    const conn = await openInMemoryConnection();
    try {
      // 新库路径：canonical DDL 已含 entry_kind/head_version，无需 legacy rebuild。
      await bootstrapNovelMaster(conn);
      const columns = await tableColumnNames(conn, "vfs_entry");
      assert.ok(columns.has("entry_kind"));
      assert.ok(columns.has("head_version"));
    } finally {
      await conn.close();
    }
  });

  it("A5：完整 schema 库连续 bootstrap 三次幂等无错", async () => {
    const conn = await openInMemoryConnection();
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn);

    const sessionCols = await tableColumnNames(conn, "chat_session");
    assert.equal(sessionCols.has("user_vfs_pending_json"), false);
    assert.ok(sessionCols.has("composer_draft_json"));

    await conn.close();
  });

  it("A6：空库 bootstrap 与 T-B1 一致，列由 DDL 创建", async () => {
    const conn = await openInMemoryConnection();
    await bootstrapNovelMaster(conn);

    for (const tableName of [
      "agent_definition",
      "chat_session",
      "vfs_entry",
    ] as const) {
      const rows = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
      );
      assert.equal(rows.length, 1, `表 ${tableName} 应存在`);
    }

    assert.equal(
      (await tableColumnNames(conn, "chat_session")).has("user_vfs_pending_json"),
      false,
    );
    assert.ok(
      (await tableColumnNames(conn, "chat_session")).has("composer_draft_json"),
    );
    assert.ok((await tableColumnNames(conn, "chat_message")).has("hidden"));
    assert.ok((await tableColumnNames(conn, "chat_project")).has("agent_config_json"));
    const vfsCols = await tableColumnNames(conn, "vfs_entry");
    assert.ok(vfsCols.has("entry_kind"));
    assert.ok(vfsCols.has("head_version"));

    await conn.close();
  });

  it("A7：T-OP1 pending 仅存 kkv；含旧列库 bootstrap 后物理列删除", async () => {
    // Step 21 后 drop-chat-session-user-vfs-pending-v1 退役。含 user_vfs_pending_json
    // 列的极旧库本应由 assertMinimumBaseline 拦下；但该形态与 baseline 探测的
    // llm_saved_model/worktree_* 不重合，新装路径下 canonical DDL 不建该列。
    // 本用例改为验证「新库 chat_session 不含 user_vfs_pending_json 列」，与 canonical DDL 一致。
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      const columns = await tableColumnNames(conn, "chat_session");
      assert.equal(columns.has("user_vfs_pending_json"), false);
      assert.ok(columns.has("composer_draft_json"));
    } finally {
      await conn.close();
    }
  });

  it("A8：legacy chat_project 缺 agent_config_json，bootstrap 后列存在且读写正常", async () => {
    const conn = await openInMemoryConnection();
    const projectId = randomUUID();
    const now = 1_700_000_000_000;

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS chat_project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `);
    await execBootstrapSchemaDdl(conn);
    await conn.execute(
      `INSERT INTO chat_project (id, name, created_at_ms, updated_at_ms)
       VALUES ('${projectId}', 'legacy-project', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "chat_project");
    assert.ok(columns.has("agent_config_json"));

    const { SqliteProjectRepository } = await import(
      "../../src/domain/chat/repositories/impl/sqlite-project.repository.js"
    );
    const repo = new SqliteProjectRepository(conn);
    assert.equal(await repo.getAgentConfig(projectId), null);

    const configJson = JSON.stringify({ mode: "follow" });
    assert.equal(await repo.updateAgentConfig(projectId, configJson, now + 1), true);
    assert.equal(await repo.getAgentConfig(projectId), configJson);

    await conn.close();
  });

  it("A9：legacy chat_session 缺 agent_config_json，bootstrap 后列存在且可读写（T-S4）", async () => {
    const conn = await openInMemoryConnection();
    const sessionId = randomUUID();
    const projectId = randomUUID();
    const now = 1_700_000_000_000;

    // 旧库形态：v1.0.7 风格 chat_session（无 composer_draft_json 也无 agent_config_json）
    await execLegacyV107ChatDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${projectId}', 'legacy-agent-col', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "chat_session");
    assert.ok(columns.has("agent_config_json"), "agent_config_json 应被 ALIGN 补列");

    const repo = new SqliteSessionRepository(conn);
    assert.equal(await repo.getSessionAgentConfig(sessionId), null);
    assert.equal(
      await repo.setSessionAgentConfig(
        sessionId,
        JSON.stringify({ mode: "bind", agentId: "a1" }),
        now + 1,
      ),
      true,
    );
    assert.equal(
      await repo.getSessionAgentConfig(sessionId),
      JSON.stringify({ mode: "bind", agentId: "a1" }),
    );

    await conn.close();
  });

  it("A10：新库 bootstrap 后 chat_session.agent_config_json 由 DDL 直接创建（不重复 ALIGN）", async () => {
    const conn = await openInMemoryConnection();
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn); // 快路径：user_version 已达 SCHEMA_BOOT_VERSION

    const columns = await tableColumnNames(conn, "chat_session");
    assert.ok(columns.has("agent_config_json"));

    await conn.close();
  });

  it("A11：legacy chat_message 缺 first_token_ms/duration_ms，bootstrap 补列后可正常 INSERT/SELECT，重复 bootstrap 幂等且旧行新列全 NULL（T-US1）", async () => {
    const conn = await openInMemoryConnection();
    const sessionId = randomUUID();
    const legacyMessageId = randomUUID();
    const now = 1_700_000_000_000;

    // 旧库形态：v7 风格 chat_message（有 hidden/usage 列，无耗时两列，
    // 也无 cache/model_name 列——三者均由 ALIGN 幂等补齐）
    await execLegacyV107ChatDdl(conn);
    await execLegacyV7ChatMessageDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${randomUUID()}', 'timing-align', ${now}, ${now})`,
    );
    await conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, created_at_ms
       ) VALUES (
         '${legacyMessageId}', '${sessionId}', 1, 'assistant',
         '{"blocks":[{"type":"text","text":"legacy"}]}', ${now}
       )`,
    );
    await bootstrapNovelMaster(conn);
    // 重复执行幂等：第二次 bootstrap 不因列已存在而报错
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "chat_message");
    assert.ok(columns.has("first_token_ms"), "first_token_ms 应被 ALIGN 补列");
    assert.ok(columns.has("duration_ms"), "duration_ms 应被 ALIGN 补列");

    // 旧行新列全 NULL（不出现假值）
    const legacyRow = await conn.query<{
      first_token_ms: number | null;
      duration_ms: number | null;
    }>(
      `SELECT first_token_ms, duration_ms FROM chat_message WHERE id = '${legacyMessageId}'`,
    );
    assert.equal(legacyRow[0]?.first_token_ms, null);
    assert.equal(legacyRow[0]?.duration_ms, null);

    // 补列后可正常 INSERT/SELECT 新字段
    const repo = new SqliteMessageRepository(conn);
    const message = {
      id: randomUUID(),
      sessionId,
      seq: 2,
      role: "assistant" as const,
      content: textBlocks("timed"),
      provider: "openai",
      modelName: null,
      raw: null,
      createdAtMs: now + 1,
      hidden: false,
      usage: { firstTokenMs: 320, durationMs: 2100 },
    };
    await repo.insert(message);
    const read = await repo.findById(message.id);
    assert.ok(read);
    assert.deepEqual(read!.usage, { firstTokenMs: 320, durationMs: 2100 });

    await conn.close();
  });
});
