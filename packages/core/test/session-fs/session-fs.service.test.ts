import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("SessionFsService", () => {
  it("execute write+delete then rollback batch restores content", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/f.md", "original");

    const result = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [
        { function: "write", path: "/f.md", content: "changed" },
        { function: "delete", path: "/f.md" },
      ],
      "user",
    );
    await assert.rejects(() => svfs.read("/f.md"));

    await ctx.sessionFs.rollbackBatch(session.id, project.id, result.batchId);
    assert.equal((await svfs.read("/f.md")).content, "original");
    await ctx.conn.close();
  });

  it("snapshot list and rollback to rev", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/s.md", content: "v1" }],
      "assistant",
    );
    const afterV1 = await ctx.sessionFs.listSnapshots(session.id, "/s.md");
    const v1Rev = afterV1.find((s) => s.status === "active")!.snapshotRev;

    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/s.md", content: "v2" }],
      "assistant",
    );
    assert.equal((await svfs.read("/s.md")).content, "v2");

    await ctx.sessionFs.rollbackSnapshot(
      session.id,
      project.id,
      "/s.md",
      v1Rev,
    );
    assert.equal((await svfs.read("/s.md")).content, "v1");
    await ctx.conn.close();
  });
});
