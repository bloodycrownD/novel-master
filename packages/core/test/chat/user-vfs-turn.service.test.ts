/**
 * UserVfsTurnService 集成测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { type BuiltinToolContext, type TdbcConnection } from "@novel-master/core";

import { createUserVfsTurnServiceBundle, readMessageMetadata, textBlocks, TOOL_TURN_BRIDGE_TEXT, USER_VFS_TURN_ACK_TEXT } from "@novel-master/core/chat";

import { flushPendingUserVfsTurnsWithTrailingUserReorder } from "../../src/service/agent/logic/run-agent-turn.js";

import { type MessageCheckpointService } from "@novel-master/core/message-checkpoint";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import { DefaultUserVfsTurnService } from "../../src/service/chat/impl/user-vfs-turn.service.js";
import { DefaultMessageService } from "../../src/service/chat/impl/message.service.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository as CheckpointRepo } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { createScopedVfsService } from "../../src/service/vfs/create-scoped-vfs-service.js";
import { createMessageCheckpointService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function makeToolCtx(
  conn: TdbcConnection,
  projectId: string,
  sessionId: string,
): BuiltinToolContext {
  const messageRepo = new SqliteMessageRepository(conn);
  return {
    vfs: createScopedVfsService(conn, {
      kind: "session",
      projectId,
      sessionId,
    }),
    projectId,
    sessionId,
    listSessionMessages: () => messageRepo.listBySession(sessionId),
  };
}

function writeOp(path: string, content: string, toolId = "tu_write") {
  return {
    actionXml: `<user-vfs-action kind="save" path="${path}" method="write" />`,
    tools: [
      {
        id: toolId,
        name: "write",
        input: { path, content },
      },
    ],
  };
}

describe("UserVfsTurnService", () => {
  it("F1：A+U pending 空续跑 flush 后顺序为 A, U_vfs, A_ack, U", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    await ctx.messages.append(session.id, "user", textBlocks("用户续跑"));

    await userVfsTurn.executeOp(session.id, writeOp("/f1.md", "content"));

    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      { messages: ctx.messages, userVfsTurn },
      session.id,
      "",
    );

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 4);
    assert.equal(listed[0]!.role, "assistant");
    assert.equal(readMessageMetadata(listed[1]!.raw)?.kind, "user_vfs_action");
    assert.equal(readMessageMetadata(listed[2]!.raw)?.kind, "user_vfs_ack");
    assert.equal(listed[3]!.role, "user");
    const tailText = listed[3]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "用户续跑");
  });

  it("F2：A + pending 发送 hi 后顺序为 A, U_vfs, A_ack, U(hi)", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    await userVfsTurn.executeOp(session.id, writeOp("/f2.md", "content"));

    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      { messages: ctx.messages, userVfsTurn },
      session.id,
      "hi",
    );
    await ctx.messages.append(session.id, "user", textBlocks("hi"));

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 4);
    assert.equal(listed[0]!.role, "assistant");
    assert.equal(readMessageMetadata(listed[1]!.raw)?.kind, "user_vfs_action");
    assert.equal(readMessageMetadata(listed[2]!.raw)?.kind, "user_vfs_ack");
    assert.equal(listed[3]!.role, "user");
    const tailText = listed[3]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "hi");
  });

  it("F3：仅 U + pending 空续跑 flush 后顺序为 U_vfs, A_ack, U", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "user", textBlocks("用户续跑"));
    await userVfsTurn.executeOp(session.id, writeOp("/f3.md", "content"));

    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      { messages: ctx.messages, userVfsTurn },
      session.id,
      "",
    );

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 3);
    assert.equal(readMessageMetadata(listed[0]!.raw)?.kind, "user_vfs_action");
    assert.equal(readMessageMetadata(listed[1]!.raw)?.kind, "user_vfs_ack");
    assert.equal(listed[2]!.role, "user");
    const tailText = listed[2]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "用户续跑");
  });

  it("F4：pending 空时空续跑不写 UA、末条 user 保留", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("A"));
    const originalUser = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("续跑"),
    );

    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      { messages: ctx.messages, userVfsTurn },
      session.id,
      "",
    );

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]!.role, "assistant");
    assert.equal(listed[1]!.role, "user");
    const tailText = listed[1]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "续跑");
    assert.equal(listed[1]!.id, originalUser.id);
  });

  it("execute 失败不写 pending；成功写入 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessionRepo = new SqliteSessionRepository(ctx.conn);

    const fail = await userVfsTurn.executeOp(session.id, {
      actionXml: '<user-vfs-action kind="save" path="/x.md" method="write" />',
      tools: [
        {
          id: "tu_bad",
          name: "write",
          input: { path: "/x.md" },
        },
      ],
    });
    assert.equal(fail.ok, false);
    assert.equal(await sessionRepo.getUserVfsPendingJson(session.id), null);

    const ok = await userVfsTurn.executeOp(
      session.id,
      writeOp("/ok.md", "hello", "tu_ok"),
    );
    assert.equal(ok.ok, true);
    const pendingJson = await sessionRepo.getUserVfsPendingJson(session.id);
    assert.ok(pendingJson);
    const pending = JSON.parse(pendingJson!) as unknown[];
    assert.equal(pending.length, 1);
    assert.equal((pending[0] as { tools: { id: string }[] }).tools[0]?.id, "tu_ok");
  });

  it("flush 落库 2 条消息且 metadata 符合 spec", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/a.md", "A"));
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);

    const [m1, m2] = messages;
    assert.equal(m1!.role, "user");
    assert.equal(m2!.role, "assistant");

    assert.equal(readMessageMetadata(m1!.raw)?.source, "user");
    assert.equal(readMessageMetadata(m1!.raw)?.kind, "user_vfs_action");
    assert.match(
      m1!.content.blocks[0]?.type === "text" ? m1!.content.blocks[0].text : "",
      /<system-message>/,
    );
    assert.match(
      m1!.content.blocks[0]?.type === "text" ? m1!.content.blocks[0].text : "",
      /<user-vfs-action/,
    );

    assert.equal(readMessageMetadata(m2!.raw)?.kind, "user_vfs_ack");
    assert.equal(m2!.content.blocks[0]?.type, "text");
    if (m2!.content.blocks[0]?.type === "text") {
      assert.equal(m2!.content.blocks[0].text, USER_VFS_TURN_ACK_TEXT);
    }
    assert.equal(
      m2!.content.blocks.some((b) => b.type === "tool_use"),
      false,
    );
  });

  it("flush 空 pending 跳过", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, false);
    assert.equal((await ctx.messages.listBySession(session.id)).length, 0);
  });

  it("flush 不重跑 ToolRunner", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const sessionRepo = new SqliteSessionRepository(ctx.conn);
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    let runParallelCalls = 0;
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const innerRunner = new ToolRunner(registry);
    const trackingRunner = {
      runParallel: async (
        calls: readonly { name: string; input: unknown }[],
        toolCtx: BuiltinToolContext,
      ) => {
        runParallelCalls += 1;
        return innerRunner.runParallel(calls, toolCtx);
      },
      call: innerRunner.call.bind(innerRunner),
    } as ToolRunner<BuiltinToolContext>;

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner: trackingRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: createMessageCheckpointService(ctx.conn),
    });

    await userVfsTurn.executeOp(session.id, writeOp("/track.md", "T"));
    assert.equal(runParallelCalls, 1);

    await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(runParallelCalls, 1);
  });

  it("burst 3 次 pending flush 为 1×UA（2 条消息）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/1.md", "one", "tu_1"));
    await userVfsTurn.executeOp(session.id, writeOp("/2.md", "two", "tu_2"));
    await userVfsTurn.executeOp(session.id, writeOp("/3.md", "three", "tu_3"));

    await userVfsTurn.flushPendingUserVfsTurns(session.id);
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);

    const userMsg = messages[0]!;
    assert.equal(userMsg.role, "user");
    const text =
      userMsg.content.blocks[0]?.type === "text"
        ? userMsg.content.blocks[0].text
        : "";
    assert.ok(text.includes("/1.md"));
    assert.ok(text.includes("/2.md"));
    assert.ok(text.includes("/3.md"));
    assert.equal(
      messages[1]!.content.blocks.some((b) => b.type === "tool_use"),
      false,
    );
  });

  it("flush 后 checkpoint 锚定 U 条 user_vfs_action message", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const sessionRepo = new SqliteSessionRepository(ctx.conn);
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    const captureCalls: Array<{ sessionId: string; messageId: string }> = [];
    const mockCheckpoint: MessageCheckpointService = {
      capture: async (sessionId, _projectId, messageId) => {
        captureCalls.push({ sessionId, messageId });
      },
    };

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolRunner = new ToolRunner(registry);

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: mockCheckpoint,
    });

    await userVfsTurn.executeOp(session.id, writeOp("/cp.md", "checkpoint"));
    await userVfsTurn.flushPendingUserVfsTurns(session.id);

    const listed = await messages.listBySession(session.id);
    const actionUser = listed[0]!;
    assert.equal(actionUser.role, "user");
    assert.equal(readMessageMetadata(actionUser.raw)?.kind, "user_vfs_action");

    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0]!.messageId, actionUser.id);

    await svfs.write("/extra.md", "x", { versionCheck: false });
    await ctx.messageCheckpoint.capture(
      session.id,
      project.id,
      actionUser.id,
    );
    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, actionUser.id);
    assert.ok(tree);
    assert.equal(tree.has("/cp.md"), true);
  });

  it("appendToolTurnBridge 追加 kind=tool_turn_bridge assistant", async () => {
    const ctx = getNovelMasterTestContext();
    const { appendToolTurnBridge } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const bridge = await appendToolTurnBridge(session.id);
    assert.equal(bridge.role, "assistant");
    assert.equal(readMessageMetadata(bridge.raw)?.kind, "tool_turn_bridge");
    assert.equal(bridge.content.blocks[0]?.type, "text");
    if (bridge.content.blocks[0]?.type === "text") {
      assert.equal(bridge.content.blocks[0].text, TOOL_TURN_BRIDGE_TEXT);
    }
  });

  it("execute 使用会抛错的 tool 时不写 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessionRepo = new SqliteSessionRepository(ctx.conn);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registry.register({
      name: "test.boom",
      description: "boom",
      inputSchema: z.object({}),
      async run() {
        throw new Error("disk fail");
      },
    });
    const toolRunner = new ToolRunner(registry);
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: createMessageCheckpointService(ctx.conn),
    });

    const result = await userVfsTurn.executeOp(session.id, {
      actionXml: '<user-vfs-action kind="save" path="/f.md" method="write" />',
      tools: [{ id: "tu_boom", name: "test.boom", input: {} }],
    });
    assert.equal(result.ok, false);
    assert.equal(await sessionRepo.getUserVfsPendingJson(session.id), null);
  });


  it("T1：第二次 tool 失败时回滚已成功 path 且 pending 为空", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessionRepo = new SqliteSessionRepository(ctx.conn);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const innerRunner = new ToolRunner(registry);
    const toolRunner = {
      runParallel: async (calls, toolCtx) => {
        const outcomes = [];
        for (let index = 0; index < calls.length; index += 1) {
          const call = calls[index];
          if (index === 1) {
            outcomes.push({ ok: false as const, error: new Error("second fail") });
            continue;
          }
          try {
            const output = await innerRunner.call(call.name, call.input, toolCtx);
            outcomes.push({ ok: true as const, output });
          } catch (error: unknown) {
            outcomes.push({ ok: false as const, error });
          }
        }
        return outcomes;
      },
      call: innerRunner.call.bind(innerRunner),
    } as ToolRunner<BuiltinToolContext>;
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: createMessageCheckpointService(ctx.conn),
    });

    const result = await userVfsTurn.executeOp(session.id, {
      actionXml:
        '<user-vfs-action kind="save" path="/a.md" method="write" />\n<user-vfs-action kind="save" path="/b.md" method="write" />',
      tools: [
        {
          id: "tu_1",
          name: "write",
          input: { path: "/a.md", content: "A" },
        },
        {
          id: "tu_2",
          name: "write",
          input: { path: "/b.md", content: "B" },
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(await sessionRepo.getUserVfsPendingJson(session.id), null);
    await assert.rejects(() => svfs.read("/a.md"));
    await assert.rejects(() => svfs.read("/b.md"));
  });

  it("T2：两次 tool 均成功时 pending 一条且磁盘保留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessionRepo = new SqliteSessionRepository(ctx.conn);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolRunner = new ToolRunner(registry);
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: createMessageCheckpointService(ctx.conn),
    });

    const ok = await userVfsTurn.executeOp(session.id, {
      actionXml:
        '<user-vfs-action kind="save" path="/1.md" method="write" />\n<user-vfs-action kind="save" path="/2.md" method="write" />',
      tools: [
        {
          id: "tu_1",
          name: "write",
          input: { path: "/1.md", content: "one" },
        },
        {
          id: "tu_2",
          name: "write",
          input: { path: "/2.md", content: "two" },
        },
      ],
    });
    assert.equal(ok.ok, true);

    const pendingJson = await sessionRepo.getUserVfsPendingJson(session.id);
    assert.ok(pendingJson);
    assert.equal(JSON.parse(pendingJson).length, 1);
    assert.equal((await svfs.read("/1.md")).content, "one");
    assert.equal((await svfs.read("/2.md")).content, "two");
  });

  it("T3：flush 事务第二次 insert 失败时无消息且 pending 不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessionRepo = new SqliteSessionRepository(ctx.conn);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolRunner = new ToolRunner(registry);
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: createMessageCheckpointService(ctx.conn),
    });

    await userVfsTurn.executeOp(session.id, writeOp("/tx.md", "body"));
    const pendingBefore = await sessionRepo.getUserVfsPendingJson(session.id);
    assert.ok(pendingBefore);

    let insertCount = 0;
    const origInsert = SqliteMessageRepository.prototype.insert;
    SqliteMessageRepository.prototype.insert = async function insertSpy(message) {
      insertCount += 1;
      if (insertCount === 2) {
        throw new Error("flush insert aborted");
      }
      return origInsert.call(this, message);
    };

    try {
      await assert.rejects(() =>
        userVfsTurn.flushPendingUserVfsTurns(session.id),
      );
      assert.equal((await ctx.messages.listBySession(session.id)).length, 0);
      assert.equal(
        await sessionRepo.getUserVfsPendingJson(session.id),
        pendingBefore,
      );
    } finally {
      SqliteMessageRepository.prototype.insert = origInsert;
    }
  });

  it("T5：capture 失败时 flush 抛错且已落库 2 条消息、pending 已清空", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessionRepo = new SqliteSessionRepository(ctx.conn);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolRunner = new ToolRunner(registry);
    const messageRepo = new SqliteMessageRepository(ctx.conn);
    const vfsRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new CheckpointRepo(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const messages = new DefaultMessageService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages: messageRepo,
      vfs: vfsRepo,
      checkpoints: checkpointRepo,
      revisions: revisionRepo,
    });

    const userVfsTurn = new DefaultUserVfsTurnService({
      conn: ctx.conn,
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: {
        capture: async () => {
          throw new Error("capture failed");
        },
      },
    });

    await userVfsTurn.executeOp(session.id, writeOp("/cap.md", "x"));
    await assert.rejects(() =>
      userVfsTurn.flushPendingUserVfsTurns(session.id),
    );

    const listed = await messages.listBySession(session.id);
    assert.equal(listed.length, 2);
    assert.equal(await sessionRepo.getUserVfsPendingJson(session.id), null);
  });

});
