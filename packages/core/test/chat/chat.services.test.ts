import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type TdbcConnection } from "@novel-master/core";

import { type MessageContent } from "@novel-master/core/chat";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

function firstTextBlock(content: MessageContent): string {
  const block = content.blocks[0];
  assert.equal(block?.type, "text");
  return block!.type === "text" ? block.text : "";
}

async function assertNoSessionFsData(
  conn: TdbcConnection,
  sessionId: string,
): Promise<void> {
  const checkpoints = new SqliteMessageCheckpointRepository(conn);
  assert.equal((await checkpoints.listFilePointersForSession(sessionId)).length, 0);
}


novelMasterTestFixture();

describe("Chat services", () => {
  it("session create copies project template to session vfs", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/sub/b.md", "B");

    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths.sort(), ["/a.md", "/sub/b.md"]);
    assert.equal((await svfs.read("/a.md")).content, "A");
  });

  it("project template changes after session create do not affect session vfs", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await pvfs.write("/a.md", "CHANGED", { versionCheck: false });
    await pvfs.write("/new.md", "NEW");

    assert.equal((await svfs.read("/a.md")).content, "A");
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths.sort(), ["/a.md"]);
  });

  it("empty template yields empty session vfs", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create("Empty");
    const session = await ctx.sessions.create(project.id);
    const paths = await ctx.sessionVfs(project.id, session.id).list("/");
    assert.deepEqual(paths, []);
  });

  it("project rename updates name and updatedAtMs", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create("Old Name");
    const renamed = await ctx.projects.rename(project.id, "New Name");
    assert.equal(renamed.name, "New Name");
    assert.ok(renamed.updatedAtMs >= project.updatedAtMs);
    const loaded = await ctx.projects.get(project.id);
    assert.equal(loaded.name, "New Name");
  });

  it("project rename rejects empty name", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await assert.rejects(
      () => ctx.projects.rename(project.id, "   "),
      (err: unknown) =>
        err instanceof Error && err.message.includes("must not be empty"),
    );
  });

  it("project create rejects empty name", async () => {
    const ctx = getNovelMasterTestContext();
    await assert.rejects(
      () => ctx.projects.create("  "),
      (err: unknown) =>
        err instanceof Error && err.message.includes("must not be empty"),
    );
  });

  it("message delete removes row", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.delete(m.id);
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 0);
  });

  it("message truncateAfter(anchor) 删掉 anchor 之后的全部消息但保留 anchor", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const u1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    await ctx.messages.append(session.id, "assistant", textBlocks("partial"));
    await ctx.messages.append(session.id, "user", textBlocks("tool_results"));

    await ctx.messages.truncateAfter(session.id, u1.id);
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 1, "仅保留 anchor");
    assert.equal(list[0]!.id, u1.id);
  });

  it("message truncateAfter(null) 清空整个 session 的消息", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", textBlocks("a"));
    await ctx.messages.append(session.id, "assistant", textBlocks("b"));

    await ctx.messages.truncateAfter(session.id, null);
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 0, "session 被清空");
  });

  it("message truncateAfter 同步清掉被删消息的 checkpoint 指针", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const u1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    const a1 = await ctx.messages.append(session.id, "assistant", textBlocks("partial"));

    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    await checkpointRepo.insertCheckpoint({
      sessionId: session.id,
      messageId: a1.id,
      createdAtMs: Date.now(),
      files: [],
    });
    assert.equal(await checkpointRepo.hasCheckpoint(session.id, a1.id), true);

    await ctx.messages.truncateAfter(session.id, u1.id);
    assert.equal(
      await checkpointRepo.hasCheckpoint(session.id, a1.id),
      false,
      "被删 assistant 的 checkpoint 指针应同步清掉",
    );
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 1);
  });

  it("message updateContent replaces text", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    const updated = await ctx.messages.updateContent(
      m.id,
      textBlocks("edited"),
    );
    assert.equal(firstTextBlock(updated.content), "edited");
    const loaded = await ctx.messages.get(m.id);
    assert.equal(firstTextBlock(loaded.content), "edited");
  });

  it("message append preserves seq order", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", textBlocks("hey"));
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 2);
    assert.equal(list[0]!.seq, 1);
    assert.equal(list[1]!.seq, 2);
  });

  it("message tail/page ordering stays consistent with full list", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    for (let i = 1; i <= 8; i += 1) {
      await ctx.messages.append(session.id, "user", textBlocks(`m${i}`));
    }
    const all = await ctx.messages.listBySession(session.id);
    const tail = await ctx.messages.listBySessionTail(session.id, { limit: 3 });
    assert.deepEqual(
      tail.map(m => firstTextBlock(m.content)),
      ["m6", "m7", "m8"],
    );
    const older = await ctx.messages.listBySessionPage(session.id, {
      limit: 3,
      beforeSeq: tail[0]!.seq,
    });
    assert.deepEqual(
      older.map(m => firstTextBlock(m.content)),
      ["m3", "m4", "m5"],
    );
    const oldest = await ctx.messages.listBySessionPage(session.id, {
      limit: 3,
      beforeSeq: older[0]!.seq,
    });
    const rebuilt = [...oldest, ...older, ...tail].map(m => m.id);
    assert.deepEqual(rebuilt, all.map(m => m.id));
  });

  it("message fork copies vfs and messages up to id", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "edited");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const forked = await ctx.messages.fork(session.id, m2.id);
    assert.equal(forked.title, "会话_ckpt_1");
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 2);
    assert.equal(firstTextBlock(forkedMsgs[0]!.content), "1");
    assert.equal(firstTextBlock(forkedMsgs[1]!.content), "2");
    assert.equal(
      (await ctx.sessionVfs(project.id, forked.id).read("/note.md")).content,
      "edited",
    );
    assert.equal((await ctx.messages.listBySession(session.id)).length, 3);
  });

  it("message fork titles session as sourceName_ckpt_n", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "新会话1");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));

    const first = await ctx.messages.fork(session.id, m1.id);
    assert.equal(first.title, "新会话1_ckpt_1");

    const second = await ctx.messages.fork(session.id, m1.id);
    assert.equal(second.title, "新会话1_ckpt_2");
  });

  it("message fork 继承源会话的 agent 配置", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    // 先设一个非默认配置（agentId + modelId 都改掉），再 fork 验证继承。
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "agent-fk-src",
      modelId: "model-fk-x",
    });

    const forked = await ctx.messages.fork(session.id, m1.id);
    assert.deepEqual(
      await ctx.sessions.getSessionAgentConfig(forked.id),
      { agentId: "agent-fk-src", modelId: "model-fk-x" },
    );
  });

  it("message fork 源会话 agent 配置为 NULL 时不抛错且新会话保持 NULL", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    // service 层 updateSessionAgentConfig 不允许置空 agentId，
    // 这里走 repo 层直接把源会话 agent_config_json 清成 NULL。
    const sessionRepo = new SqliteSessionRepository(ctx.conn);
    assert.equal(
      await sessionRepo.setSessionAgentConfig(session.id, null, Date.now()),
      true,
    );
    assert.equal(await sessionRepo.getSessionAgentConfig(session.id), null);

    const forked = await ctx.messages.fork(session.id, m1.id);
    // service 层 getSessionAgentConfig 对 NULL 会抛，断言走 repo 层。
    assert.equal(await sessionRepo.getSessionAgentConfig(forked.id), null);
  });

  it("message fork then append on forked session does not affect source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const forked = await ctx.messages.fork(session.id, m2.id);
    await ctx.messages.append(forked.id, "user", textBlocks("fork-only"));

    const sourceMsgs = await ctx.messages.listBySession(session.id);
    assert.equal(sourceMsgs.length, 3);
    assert.equal(firstTextBlock(sourceMsgs[2]!.content), "3");

    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 3);
    assert.equal(firstTextBlock(forkedMsgs[0]!.content), "1");
    assert.equal(firstTextBlock(forkedMsgs[1]!.content), "2");
    assert.equal(firstTextBlock(forkedMsgs[2]!.content), "fork-only");
    assert.notEqual(forkedMsgs[0]!.id, m1.id);
  });

  it("session copy duplicates vfs and messages", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "body");
    await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", textBlocks("hey"));

    const copy = await ctx.sessions.copy(session.id);
    const copyVfs = ctx.sessionVfs(project.id, copy.id);
    assert.equal((await copyVfs.read("/note.md")).content, "body");
    const copyMsgs = await ctx.messages.listBySession(copy.id);
    assert.equal(copyMsgs.length, 2);
    assert.equal(firstTextBlock(copyMsgs[0]!.content), "hi");
    assert.equal(firstTextBlock(copyMsgs[1]!.content), "hey");
    assert.notEqual(copyMsgs[0]!.id, (await ctx.messages.listBySession(session.id))[0]!.id);

    await svfs.write("/note.md", "mutated", { versionCheck: false });
    assert.equal((await copyVfs.read("/note.md")).content, "body");
  });

  it("session delete purges message checkpoints in transaction", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const assistant = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("checkpoint"),
    );
    await ctx.sessionVfs(project.id, session.id).write("/cp.md", "v1", {
      versionCheck: false,
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(
      await checkpointRepo.hasCheckpoint(session.id, assistant.id),
      true,
    );
    assert.ok((await checkpointRepo.listFilePointersForSession(session.id)).length > 0);

    await ctx.sessions.delete(session.id);
    await assertNoSessionFsData(ctx.conn, session.id);
  });

  it("project delete purges message checkpoints for all sessions", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const s1 = await ctx.sessions.create(project.id);
    const s2 = await ctx.sessions.create(project.id);
    for (const session of [s1, s2]) {
      const assistant = await ctx.messages.append(
        session.id,
        "assistant",
        textBlocks("checkpoint"),
      );
      await ctx.sessionVfs(project.id, session.id).write("/cp.md", "v1", {
        versionCheck: false,
      });
      await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
    }

    await ctx.projects.delete(project.id);
    await assertNoSessionFsData(ctx.conn, s1.id);
    await assertNoSessionFsData(ctx.conn, s2.id);
  });

  it("session rename updates title", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "旧名");
    const renamed = await ctx.sessions.rename(session.id, "新名");
    assert.equal(renamed.title, "新名");
    const loaded = await ctx.sessions.get(session.id);
    assert.equal(loaded.title, "新名");
  });

  it("project copy copies template only", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/foo.md", "FOO");
    await ctx.sessions.create(project.id);

    const copy = await ctx.projects.copy(project.id);
    assert.equal(
      (await ctx.projectVfs(copy.id).read("/foo.md")).content,
      "FOO",
    );
    assert.equal((await ctx.sessions.listByProject(copy.id)).length, 0);
  });
});
