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
  it("A1：legacy chat_session 缺 pending 列，bootstrap 后 listByProject 不抛错", async () => {
    const conn = await openInMemoryConnection();
    await execLegacyV107ChatDdl(conn);
    await execBootstrapSchemaDdl(conn);
    await bootstrapNovelMaster(conn);

    const columns = await tableColumnNames(conn, "chat_session");
    assert.ok(columns.has("user_vfs_pending_json"));

    const repo = new SqliteSessionRepository(conn);
    const sessions = await repo.listByProject(randomUUID());
    assert.deepEqual(sessions, []);

    await conn.close();
  });

  it("A2：legacy session 行数据 bootstrap 后保留且 pending 为 null", async () => {
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
    assert.equal(sessions[0]!.userVfsPendingJson, null);

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
    assert.ok(sessionCols.has("user_vfs_pending_json"));
    assert.equal(
      [...sessionCols].filter((name) => name === "user_vfs_pending_json").length,
      1,
    );

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

    assert.ok((await tableColumnNames(conn, "chat_session")).has("user_vfs_pending_json"));
    assert.ok((await tableColumnNames(conn, "chat_message")).has("hidden"));
    const vfsCols = await tableColumnNames(conn, "vfs_entry");
    assert.ok(vfsCols.has("entry_kind"));
    assert.ok(vfsCols.has("head_version"));

    await conn.close();
  });

  it("A7：legacy session bootstrap 后 pending JSON round-trip", async () => {
    const conn = await openInMemoryConnection();
    const sessionId = randomUUID();
    const now = 1_700_000_000_000;

    await execLegacyV107ChatDdl(conn);
    await execBootstrapSchemaDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${randomUUID()}', 'pending-round-trip', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const repo = new SqliteSessionRepository(conn);
    const pendingJson = JSON.stringify([
      {
        actionXml: "<user-vfs-action/>",
        tools: [{ id: "tu_legacy", name: "edit" }],
        createdAtMs: now,
      },
    ]);

    assert.equal(await repo.getUserVfsPendingJson(sessionId), null);
    assert.equal(await repo.setUserVfsPendingJson(sessionId, pendingJson), true);
    assert.equal(await repo.getUserVfsPendingJson(sessionId), pendingJson);

    await conn.close();
  });
});
