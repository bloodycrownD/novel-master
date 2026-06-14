import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
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
