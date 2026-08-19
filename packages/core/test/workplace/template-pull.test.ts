import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";

import { createTemplatePullService, createWorkplaceService } from "@novel-master/core/workplace";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("template pull", () => {
  it("session create copies worktree with path mapping", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/a.md", "A");
    const pwt = createWorkplaceService(ctx.conn, {
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
    const swt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const rows = await swt.buildListRows();
    const fileRow = rows.find((r) => r.kind === "file" && r.path === "/a.md");
    assert.ok(fileRow);
    assert.equal(fileRow.inclusionMode, "show");
    const dirRoot = rows.find((r) => r.kind === "dir" && r.path === "/");
    assert.ok(dirRoot);
    assert.equal(dirRoot.ruleState, "rule_on");
  });

  it("session pull clears message checkpoints but keeps messages", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
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
  });

  it("session create 仅复制 template 文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/a.md", "A");
    await ctx.projectVfs(project.id).write("/b.md", "B");

    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/a.md", "/b.md"]);
  });

  it("session pull replace 语义移除 session 独有孤儿文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/a.md", "A");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/orphan.md", "orphan");

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/a.md"]);
  });
});