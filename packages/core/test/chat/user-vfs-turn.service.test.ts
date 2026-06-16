/**
 * UserVfsTurnService 集成测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { type BuiltinToolContext, type TdbcConnection } from "@novel-master/core";

import { createUserVfsTurnServiceBundle, readMessageMetadata, TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";

import { type MessageCheckpointService } from "@novel-master/core/session-fs";
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

  it("flush 落库 4 条消息且 metadata 符合 spec", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/a.md", "A"));
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 4);

    const [m1, m2, m3, m4] = messages;
    assert.equal(m1!.role, "user");
    assert.equal(m2!.role, "assistant");
    assert.equal(m3!.role, "user");
    assert.equal(m4!.role, "assistant");

    assert.equal(readMessageMetadata(m1!.raw)?.source, "user");
    assert.equal(readMessageMetadata(m1!.raw)?.kind, "user_vfs_action");
    assert.equal(readMessageMetadata(m2!.raw)?.actor, "user");
    assert.equal(readMessageMetadata(m2!.raw)?.toolInputCompressed, true);
    assert.equal(readMessageMetadata(m3!.raw)?.source, "user");
    assert.equal(m3!.content.blocks[0]?.type, "tool_result");
    assert.equal(readMessageMetadata(m4!.raw)?.kind, "tool_turn_bridge");
    assert.equal(m4!.content.blocks[0]?.type, "text");
    if (m4!.content.blocks[0]?.type === "text") {
      assert.equal(m4!.content.blocks[0].text, TOOL_TURN_BRIDGE_TEXT);
    }
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

  it("burst 3 次 pending flush 为 1×U-A-U-A（4 条消息）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/1.md", "one", "tu_1"));
    await userVfsTurn.executeOp(session.id, writeOp("/2.md", "two", "tu_2"));
    await userVfsTurn.executeOp(session.id, writeOp("/3.md", "three", "tu_3"));

    await userVfsTurn.flushPendingUserVfsTurns(session.id);
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 4);

    const assistant = messages[1]!;
    const toolUses = assistant.content.blocks.filter((b) => b.type === "tool_use");
    assert.equal(toolUses.length, 3);
    assert.equal(toolUses[0]?.type === "tool_use" && toolUses[0].id, "tu_1");
    assert.equal(toolUses[2]?.type === "tool_use" && toolUses[2].id, "tu_3");
  });

  it("flush 后 checkpoint 锚定第 3 条 tool_result message", async () => {
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
      sessions: sessionRepo,
      messages,
      toolRunner,
      resolveToolCtx: (sid, pid) => makeToolCtx(ctx.conn, pid, sid),
      messageCheckpoint: mockCheckpoint,
    });

    await userVfsTurn.executeOp(session.id, writeOp("/cp.md", "checkpoint"));
    await userVfsTurn.flushPendingUserVfsTurns(session.id);

    const listed = await messages.listBySession(session.id);
    const toolResultMsg = listed[2]!;
    assert.equal(toolResultMsg.role, "user");
    assert.equal(toolResultMsg.content.blocks[0]?.type, "tool_result");

    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0]!.messageId, toolResultMsg.id);

    await svfs.write("/extra.md", "x", { versionCheck: false });
    await ctx.messageCheckpoint.capture(
      session.id,
      project.id,
      toolResultMsg.id,
    );
    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, toolResultMsg.id);
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
});
