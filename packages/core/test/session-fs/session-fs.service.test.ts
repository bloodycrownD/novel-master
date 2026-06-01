import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toPhysicalPath } from "../../src/domain/vfs/logic/vfs-path-mapper.js";
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

  it("rollback batch keeps explicit mkdir directory", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.mkdir("/drafts");
    await svfs.write("/drafts/a.md", "v1", { versionCheck: false });

    const result = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [
        { function: "write", path: "/drafts/a.md", content: "changed" },
        { function: "delete", path: "/drafts/a.md" },
      ],
      "assistant",
    );
    await ctx.sessionFs.rollbackBatch(session.id, project.id, result.batchId);
    assert.equal((await svfs.read("/drafts/a.md")).content, "v1");
    const root = await svfs.list("/");
    assert.ok(root.some((e) => e.path === "/drafts" && e.kind === "directory"));
    await ctx.conn.close();
  });

  it("rollback write ensures parent directory when missing", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.mkdir("/drafts");
    await svfs.write("/drafts/a.md", "only", { versionCheck: false });
    const physicalDrafts = toPhysicalPath(
      { kind: "session", projectId: project.id, sessionId: session.id },
      "/drafts",
    );
    await ctx.conn.execute(
      `DELETE FROM vfs_entry WHERE path = ? AND entry_kind = 'directory'`,
      [physicalDrafts],
    );

    const result = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "delete", path: "/drafts/a.md" }],
      "assistant",
    );
    await ctx.sessionFs.rollbackBatch(session.id, project.id, result.batchId);
    assert.equal((await svfs.read("/drafts/a.md")).content, "only");
    const root = await svfs.list("/");
    assert.ok(root.some((e) => e.path === "/drafts" && e.kind === "directory"));
    await ctx.conn.close();
  });

  it("rollback other batch does not remove unrelated empty directory", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.mkdir("/empty");
    await svfs.write("/other.md", "x", { versionCheck: false });

    const result = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/other.md", content: "y" }],
      "assistant",
    );
    await ctx.sessionFs.rollbackBatch(session.id, project.id, result.batchId);
    assert.ok(
      (await svfs.list("/")).some((e) => e.path === "/empty" && e.kind === "directory"),
    );
    await ctx.conn.close();
  });
});
