import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("MessageCheckpointService.capture", () => {
  it("records file path and head version pointers", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
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

    await ctx.conn.close();
  });

  it("skips checkpoint when session has no files", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "noop" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(await repo.hasCheckpoint(session.id, assistant.id), false);

    await ctx.conn.close();
  });

  it("does not capture on manual FileEditor-style write without capture call", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("edit"));
    await svfs.write("/manual.md", "hand", { versionCheck: false });

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const rows = await repo.listFilePointersForSession(session.id);
    assert.equal(rows.length, 0);

    await ctx.conn.close();
  });
});
