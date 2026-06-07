import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTemplatePullService,
  createWorktreeService,
  textBlocks,
} from "@novel-master/core";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("template pull", () => {
  it("session create copies worktree with path mapping", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    await ctx.projectVfs(project.id).write("/a.md", "A");
    const pwt = createWorktreeService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    await pwt.setDirRule({
      logicalPath: "/",
      headCount: 2,
    });
    await pwt.setFileRule({
      logicalPath: "/a.md",
      inclusionMode: "show",
    });

    const session = await ctx.sessions.create(project.id);
    const swt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const rows = await swt.buildListRows();
    const fileRow = rows.find((r) => r.kind === "file" && r.path === "/a.md");
    assert.ok(fileRow);
    assert.equal(fileRow.inclusionMode, "展示");
    const dirRoot = rows.find((r) => r.kind === "dir" && r.path === "/");
    assert.ok(dirRoot);
    assert.equal(dirRoot.ruleState, "规则·开");
    await ctx.conn.close();
  });

  it("project pull does not change existing session vfs or messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    await ctx.projectVfs(project.id).write("/base.md", "BASE");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/only-in-session.md", "session-only");
    await ctx.messages.append(session.id, "user", textBlocks("keep me"));

    await ctx.globalVfs().write("/g.md", "G");
    await createTemplatePullService(ctx.conn).projectTemplatePull(project.id);

    const sessionPaths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(sessionPaths.sort(), ["/base.md", "/only-in-session.md"]);
    assert.equal((await svfs.read("/only-in-session.md")).content, "session-only");
    assert.equal((await ctx.messages.listBySession(session.id)).length, 1);
    await ctx.conn.close();
  });

  it("project pull replaces vfs orphans and worktree from global", async () => {
    const ctx = await openNovelMasterTestConnection();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/g.md", "G");
    const gwt = createWorktreeService(ctx.conn, { kind: "global" });
    await gwt.setFileRule({
      logicalPath: "/g.md",
      inclusionMode: "hide",
    });

    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/p.md", "P");
    const pull = createTemplatePullService(ctx.conn);
    await pull.projectTemplatePull(project.id);

    const paths = (await pvfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths, ["/g.md"]);
    const pwt = createWorktreeService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    const rule = await pwt.buildListRows();
    const gRow = rule.find((r) => r.path === "/g.md");
    assert.equal(gRow?.inclusionMode, "隐藏");
    await ctx.conn.close();
  });

  it("session pull clears message checkpoints but keeps messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    await ctx.projectVfs(project.id).write("/x.md", "X");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/only.md", "local");
    await ctx.messages.append(session.id, "user", textBlocks("hi"));
    const assistant = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("wrote"),
    );
    await svfs.write("/x.md", "snap", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(
      await checkpointRepo.hasCheckpoint(session.id, assistant.id),
      true,
    );

    await ctx.projectVfs(project.id).write("/x.md", "NEW", {
      versionCheck: false,
    });
    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths, ["/x.md"]);
    assert.equal((await svfs.read("/x.md")).content, "NEW");
    assert.equal((await ctx.messages.listBySession(session.id)).length, 2);
    assert.equal(
      (await checkpointRepo.listFilePointersForSession(session.id)).length,
      0,
    );
    await ctx.conn.close();
  });
});
