import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteSessionExecuteRepository } from "../../src/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("SessionFs execute batch (legacy)", () => {
  it("continueBatchId appends actions with increasing seq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const msgId = "assistant-msg-1";

    const first = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/x.md", content: "1" }],
      "assistant",
      { messageId: msgId },
    );
    const second = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/y.md", content: "2" }],
      "assistant",
      { continueBatchId: first.batchId },
    );
    assert.equal(second.batchId, first.batchId);

    const execute = new SqliteSessionExecuteRepository(ctx.conn);
    const actions = await execute.listActions(first.batchId);
    assert.equal(actions.length, 2);
    assert.equal(actions[0]!.seq, 0);
    assert.equal(actions[1]!.seq, 1);

    const batch = await execute.findBatch(first.batchId);
    assert.equal(batch?.messageId, msgId);

    await ctx.conn.close();
  });

  it("continueBatchId allows two writes to the same path", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);

    const first = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/same.md", content: "v1" }],
      "assistant",
    );
    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/same.md", content: "v2" }],
      "assistant",
      { continueBatchId: first.batchId },
    );

    const svfs = ctx.sessionVfs(project.id, session.id);
    assert.equal((await svfs.read("/same.md")).content, "v2");

    await ctx.conn.close();
  });
});
