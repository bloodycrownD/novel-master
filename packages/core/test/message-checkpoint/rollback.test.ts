import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("MessageRollbackService (revision model)", () => {
  it("R1: rollback to assistant anchor restores earlier file content", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "here" }],
    });
    await svfs.write("/poem.md", "roses", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.write("/poem.md", "violets", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/poem.md")).content, "roses");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);

    await ctx.conn.close();
  });

  it("R2: user anchor removes file created by later assistant", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("write poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });
    await svfs.write("/poem.md", "draft", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);
    await ctx.messages.append(session.id, "user", textBlocks("nice"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "thanks" }],
    });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    await assert.rejects(() => svfs.read("/poem.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, user1.id);

    await ctx.conn.close();
  });

  it("R3: text-only tail truncates messages without vfs changes", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/keep.md", "stable", { versionCheck: false });

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("bye"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    assert.equal((await svfs.read("/keep.md")).content, "stable");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);

    await ctx.conn.close();
  });

  it("R4: restore creates parent directories for nested paths", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "nested" }],
    });
    await svfs.write("/deep/nested/file.md", "content", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await svfs.delete("/deep/nested/file.md", { recursive: true });
    await svfs.delete("/deep", { recursive: true });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    assert.equal((await svfs.read("/deep/nested/file.md")).content, "content");

    await ctx.conn.close();
  });

  it("R10: rollback nested file when parent directory still exists", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "nested" }],
    });
    await svfs.write("/dir/file.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "update" }],
    });
    await svfs.write("/dir/file.md", "v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    assert.equal((await svfs.read("/dir/file.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, assistant1.id);

    await ctx.conn.close();
  });

  it("R9: anchor without checkpoint uses prior checkpoint tree", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "mutate" }],
    });
    await svfs.write("/state.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const textOnly = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "no tools" }],
    });
    await svfs.write("/state.md", "v2", { versionCheck: false });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, textOnly.id);

    assert.equal((await svfs.read("/state.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, textOnly.id);

    await ctx.conn.close();
  });

  it("truncates tail on assistant anchor when session has no checkpoints", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "legacy" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant.id);

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, assistant.id);

    await ctx.conn.close();
  });

  it("assistant anchor before first checkpoint uses empty tree when session has later checkpoints", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("more"));

    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/created.md", "new file", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    await assert.rejects(() => svfs.read("/created.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, assistant1.id);

    await ctx.conn.close();
  });
});
