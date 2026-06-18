import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, NOVEL_MASTER_SCHEMA_STATEMENTS, open } from "@novel-master/core";
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

describe("SqliteSessionRepository user_vfs_pending_json", () => {
  it("set → get 读回 pending JSON", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "pending-test");

    const pendingJson = JSON.stringify([
      {
        actionXml: "<user-vfs-action/>",
        tools: [{ id: "tu_1", name: "edit" }],
        createdAtMs: Date.now(),
      },
    ]);
    assert.equal(await repo.getUserVfsPendingJson(session.id), null);

    assert.equal(
      await repo.setUserVfsPendingJson(session.id, pendingJson),
      true,
    );
    assert.equal(await repo.getUserVfsPendingJson(session.id), pendingJson);

    const loaded = await repo.findById(session.id);
    assert.ok(loaded);
    assert.equal(loaded.userVfsPendingJson, pendingJson);
  });

  it("set null 清空 pending 列", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const now = Date.now();
    const sessionId = randomUUID();
    const pendingJson = '[{"actionXml":"<a/>","tools":[],"createdAtMs":1}]';
    await repo.insert({
      id: sessionId,
      projectId: project.id,
      title: "clear-pending",
      userVfsPendingJson: pendingJson,
      createdAtMs: now,
      updatedAtMs: now,
    });

    assert.equal(await repo.getUserVfsPendingJson(sessionId), pendingJson);
    assert.equal(await repo.setUserVfsPendingJson(sessionId, null), true);
    assert.equal(await repo.getUserVfsPendingJson(sessionId), null);

    const loaded = await repo.findById(sessionId);
    assert.ok(loaded);
    assert.equal(loaded.userVfsPendingJson, null);
  });
});

describe("SqliteSessionRepository legacy 库 bootstrap 后 pending", () => {
  it("v1.0.7 风格缺列库 bootstrap 后可读写 user_vfs_pending_json", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    const sessionId = randomUUID();
    const projectId = randomUUID();
    const now = Date.now();

    await execLegacyV107ChatDdl(conn);
    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await conn.execute(sql);
    }
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${projectId}', 'legacy-bootstrap', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const repo = new SqliteSessionRepository(conn);
    const pendingJson = '[{"actionXml":"<a/>","tools":[],"createdAtMs":1}]';
    assert.equal(await repo.setUserVfsPendingJson(sessionId, pendingJson), true);
    assert.equal(await repo.getUserVfsPendingJson(sessionId), pendingJson);

    const sessions = await repo.listByProject(projectId);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.userVfsPendingJson, pendingJson);

    await conn.close();
  });
});
