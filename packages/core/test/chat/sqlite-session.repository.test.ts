import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { execLegacyV107ChatDdl } from "../bootstrap/helpers/legacy-db-fixtures.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("SqliteSessionRepository", () => {
  it("insert → findById / listByProject 读回会话行", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "session-crud");

    const loaded = await repo.findById(session.id);
    assert.ok(loaded);
    assert.equal(loaded.id, session.id);
    assert.equal(loaded.title, "session-crud");
    assert.equal(loaded.projectId, project.id);

    const listed = await repo.listByProject(project.id);
    assert.equal(listed.some((s) => s.id === session.id), true);
  });

  it("updateTitle 更新标题", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "before");
    const now = Date.now();

    assert.equal(await repo.updateTitle(session.id, "after", now), true);
    const loaded = await repo.findById(session.id);
    assert.ok(loaded);
    assert.equal(loaded.title, "after");
    assert.equal(loaded.updatedAtMs, now);
  });
});

describe("SqliteSessionRepository legacy 库 bootstrap", () => {
  it("v1.0.7 风格缺列库 bootstrap 后无 user_vfs_pending_json 且可读会话", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    const sessionId = randomUUID();
    const projectId = randomUUID();
    const now = Date.now();

    await execLegacyV107ChatDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${projectId}', 'legacy-bootstrap', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const columns = await conn.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('chat_session')`,
    );
    assert.equal(
      columns.some((c) => c.name === "user_vfs_pending_json"),
      false,
    );

    const repo = new SqliteSessionRepository(conn);
    const sessions = await repo.listByProject(projectId);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.id, sessionId);
    assert.equal(sessions[0]!.title, "legacy-bootstrap");

    await conn.close();
  });
});
