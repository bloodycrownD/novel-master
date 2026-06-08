import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  registerVfsTools,
  type VfsToolContext,
} from "../../src/domain/tool/builtin/vfs-tools.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("ToolRunner.runParallel", () => {
  it("R6: parallel writes to three paths yield one checkpoint tree with three entries", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write three" }],
    });

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const toolContext: VfsToolContext = {
      vfs,
      projectId: project.id,
      sessionId: session.id,
    };

    const outcomes = await runner.runParallel(
      [
        { name: "write", input: { path: "/a.md", content: "A" } },
        { name: "write", input: { path: "/b.md", content: "B" } },
        { name: "write", input: { path: "/c.md", content: "C" } },
      ],
      toolContext,
    );
    assert.equal(outcomes.length, 3);
    assert.ok(outcomes.every((o) => o.ok));

    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, assistant.id);
    assert.ok(tree);
    assert.equal(tree.size, 3);
    assert.equal(tree.has("/a.md"), true);
    assert.equal(tree.has("/b.md"), true);
    assert.equal(tree.has("/c.md"), true);

    await ctx.conn.close();
  });

  it("R7: parallel same-path writes last-write-wins in checkpoint", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "race" }],
    });

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const toolContext: VfsToolContext = {
      vfs,
      projectId: project.id,
      sessionId: session.id,
    };

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const originalWrite = vfs.write.bind(vfs);
    let writeCount = 0;
    (vfs as { write: typeof vfs.write }).write = async (path, content, options) => {
      writeCount += 1;
      if (writeCount === 1) {
        await delay(30);
      }
      return originalWrite(path, content, options);
    };

    await runner.runParallel(
      [
        { name: "write", input: { path: "/race.md", content: "first" } },
        { name: "write", input: { path: "/race.md", content: "second" } },
      ],
      toolContext,
    );

    const live = await vfs.read("/race.md");
    assert.equal(live.content, "second");

    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, assistant.id);
    assert.ok(tree);
    assert.equal(tree.get("/race.md"), live.version);

    await ctx.conn.close();
  });

  it("runs read-only tools in parallel without error", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/x.md", "x");
    await vfs.write("/y.md", "y");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const toolContext: VfsToolContext = {
      vfs,
      projectId: project.id,
      sessionId: session.id,
    };

    const outcomes = await runner.runParallel(
      [
        { name: "read", input: { path: "/x.md" } },
        { name: "read", input: { path: "/y.md" } },
        { name: "list", input: { dir: "/" } },
      ],
      toolContext,
      { concurrency: 2 },
    );
    assert.equal(outcomes.length, 3);
    assert.ok(outcomes.every((o) => o.ok));

    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(
      (await checkpoints.listFilePointersForSession(session.id)).length,
      0,
    );
    await ctx.conn.close();
  });

  it("respects concurrency limit", async () => {
    const registry = new ToolRegistry();
    let inFlight = 0;
    let maxInFlight = 0;
    registry.register({
      name: "test.slow",
      description: "slow",
      inputSchema: z.object({ id: z.number() }),
      async run() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return { ok: true };
      },
    });

    const runner = new ToolRunner(registry);
    await runner.runParallel(
      Array.from({ length: 6 }, (_, i) => ({
        name: "test.slow",
        input: { id: i },
      })),
      {},
      { concurrency: 2 },
    );
    assert.equal(maxInFlight, 2);
  });
});
