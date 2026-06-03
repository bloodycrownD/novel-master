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

describe("vfs-tools executeRound", () => {
  it("write then replace in same round yields one batch", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const executeRound = { messageId: "msg-1", batchId: null as string | null };
    const baseCtx: VfsToolContext = {
      vfs,
      sessionFs: ctx.sessionFs,
      projectId: project.id,
      sessionId: session.id,
      executeRound,
    };

    await runner.call("vfs.write", { path: "/t.txt", content: "hello world" }, baseCtx);
    assert.notEqual(executeRound.batchId, null);
    await runner.call(
      "vfs.replace",
      { path: "/t.txt", oldString: "world", newString: "there" },
      baseCtx,
    );

    const batches = await ctx.sessionFs.listBatches(session.id);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]!.messageId, "msg-1");
    assert.equal(executeRound.batchId, batches[0]!.id);

    const execute = new SqliteSessionExecuteRepository(ctx.conn);
    const actions = await execute.listActions(batches[0]!.id);
    assert.equal(actions.length, 2);

    await ctx.conn.close();
  });
});
