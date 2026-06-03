import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  registerVfsTools,
  type VfsToolContext,
} from "../../src/domain/tool/builtin/vfs-tools.js";
import { SqliteSessionExecuteRepository } from "../../src/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("execute round batch", () => {
  it("shares one batch for two mutating tools in the same executeRound", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const executeRound = { messageId: assistant.id, batchId: null as string | null };
    const toolCtx: VfsToolContext = {
      vfs,
      sessionFs: ctx.sessionFs,
      projectId: project.id,
      sessionId: session.id,
      executeRound,
    };

    await runner.call("vfs.write", { path: "/a.md", content: "A" }, toolCtx);
    await runner.call("vfs.write", { path: "/b.md", content: "B" }, toolCtx);
    await runner.call(
      "vfs.replace",
      { path: "/a.md", oldString: "A", newString: "A2" },
      toolCtx,
    );

    const batches = await ctx.sessionFs.listBatches(session.id);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]!.messageId, assistant.id);

    const execute = new SqliteSessionExecuteRepository(ctx.conn);
    const actions = await execute.listActions(batches[0]!.id);
    assert.equal(actions.length, 3);
    assert.equal(actions[0]!.logicalPath, "/a.md");
    assert.equal(actions[1]!.logicalPath, "/b.md");
    assert.equal(actions[2]!.logicalPath, "/a.md");

    await ctx.conn.close();
  });

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
