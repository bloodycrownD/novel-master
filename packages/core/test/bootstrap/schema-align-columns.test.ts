import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  USER_VFS_PENDING_QUEUE_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {
  execLegacyChatMessageWithoutHidden,
  execLegacyV107ChatDdl,
  execLegacyVfsEntryTable,
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
    const conn = await openInMemoryConnection();
    const path = "/legacy/vfs.txt";
    const mtime = 1_700_000_000_000;

    await execLegacyVfsEntryTable(conn);
    await execBootstrapSchemaDdl(conn);
    await conn.execute(
      `INSERT INTO vfs_entry (path, content, version, mtime_ms)
       VALUES ('${path}', 'legacy-content', 3, ${mtime})`,
    );
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "vfs_entry");
    assert.ok(columns.has("entry_kind"));
    assert.ok(columns.has("head_version"));

    const rows = await conn.query<{ head_version: number; entry_kind: string }>(
      `SELECT head_version, entry_kind FROM vfs_entry WHERE path = '${path}'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.head_version, 3);
    assert.equal(rows[0]!.entry_kind, "file");

    await conn.close();
  });

  it("A5：完整 schema 库连续 bootstrap 三次幂等无错", async () => {
    const conn = await openInMemoryConnection();
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn);

    const sessionCols = await tableColumnNames(conn, "chat_session");
    assert.equal(sessionCols.has("user_vfs_pending_json"), false);

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
    assert.ok((await tableColumnNames(conn, "chat_message")).has("hidden"));
    assert.ok((await tableColumnNames(conn, "chat_project")).has("agent_config_json"));
    const vfsCols = await tableColumnNames(conn, "vfs_entry");
    assert.ok(vfsCols.has("entry_kind"));
    assert.ok(vfsCols.has("head_version"));

    await conn.close();
  });

  it("A7：T-OP1 pending 仅存 kkv；含旧列库 bootstrap 后物理列删除", async () => {
    const conn = await openInMemoryConnection();
    const sessionId = randomUUID();
    const now = 1_700_000_000_000;

    await conn.execute(`
      CREATE TABLE chat_session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT,
        user_vfs_pending_json TEXT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `);
    await conn.execute(`
      CREATE INDEX idx_chat_session_project ON chat_session(project_id)
    `);
    await conn.execute(
      `INSERT INTO chat_session (
         id, project_id, title, user_vfs_pending_json, created_at_ms, updated_at_ms
       ) VALUES (
         '${sessionId}', '${randomUUID()}', 'pending-drop', '[]', ${now}, ${now}
       )`,
    );
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "chat_session");
    assert.equal(columns.has("user_vfs_pending_json"), false);

    const sessionKkv = createSessionKkvService(conn);
    const pendingJson = JSON.stringify([
      {
        actionXml: "<user-vfs-action/>",
        tools: [{ id: "tu_kkv", name: "edit" }],
        createdAtMs: now,
      },
    ]);
    await sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_USER_VFS_PENDING,
      USER_VFS_PENDING_QUEUE_KEY,
      pendingJson,
    );
    assert.equal(
      await sessionKkv.get(
        sessionId,
        SESSION_KKV_DOMAIN_USER_VFS_PENDING,
        USER_VFS_PENDING_QUEUE_KEY,
      ),
      pendingJson,
    );

    const repo = new SqliteSessionRepository(conn);
    const loaded = await repo.findById(sessionId);
    assert.ok(loaded);
    assert.equal(loaded.title, "pending-drop");

    await conn.close();
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
});
