import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("MessageCheckpointService.capture", () => {
  it("records file path and head version pointers", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/a.md", "alpha", { versionCheck: false });
    await svfs.write("/nested/b.md", "beta", { versionCheck: false });

    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, assistant.id);
    assert.ok(tree);
    assert.equal(tree.size, 2);
    assert.equal((await svfs.read("/a.md")).version, tree.get("/a.md"));
    assert.equal((await svfs.read("/nested/b.md")).version, tree.get("/nested/b.md"));
  });

  it("skips checkpoint when session has no files", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "noop" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(await repo.hasCheckpoint(session.id, assistant.id), false);
  });

  it("records vfs state when capturing after user message", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/manual.md", "hand", { versionCheck: false });
    const user = await ctx.messages.append(session.id, "user", textBlocks("send"));
    await ctx.messageCheckpoint.capture(session.id, project.id, user.id);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, user.id);
    assert.ok(tree);
    assert.equal(tree.size, 1);
    assert.equal((await svfs.read("/manual.md")).version, tree.get("/manual.md"));
  });

  it("does not capture on manual FileEditor-style write without capture call", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("edit"));
    await svfs.write("/manual.md", "hand", { versionCheck: false });

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const rows = await repo.listFilePointersForSession(session.id);
    assert.equal(rows.length, 0);
  });
});
