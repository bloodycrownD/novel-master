/**
 * UserVfsTurnService 集成测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { type BuiltinToolContext, type TdbcConnection } from "@novel-master/core";

import { createUserVfsTurnServiceBundle, readMessageMetadata, textBlocks, TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";
import { projectComposerStatusAttachments } from "../../src/domain/chat/logic/project-composer-status-attachments.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  USER_VFS_PENDING_QUEUE_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { parseFileCachePayload } from "../../src/domain/worktree/logic/rule-snapshot-codec.js";

import { prepareUserVfsTurnForAgentRun } from "../../src/service/agent/logic/prepare-user-vfs-turn-for-agent-run.js";

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
import {
  buildUserVfsDeleteOp,
  buildUserVfsMkdirOp,
  buildUserVfsSaveOp,
} from "../../src/service/vfs/build-user-vfs-turn-op.js";
import { createMessageCheckpointService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import type { UserVfsTurnServiceDeps } from "../../src/service/chat/impl/user-vfs-turn.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** T-OP1：pending 存于 session kkv，不经 chat_session 列。 */
async function loadPendingQueueJson(
  conn: TdbcConnection,
  sessionId: string,
): Promise<string | null> {
  return createSessionKkvService(conn).get(
    sessionId,
    SESSION_KKV_DOMAIN_USER_VFS_PENDING,
    USER_VFS_PENDING_QUEUE_KEY,
  );
}

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
    sessionKkv: createSessionKkvService(conn),
  };
}

function makeUserVfsTurnDeps(
  conn: TdbcConnection,
  overrides: Partial<UserVfsTurnServiceDeps> = {},
): UserVfsTurnServiceDeps {
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  const checkpointRepo = new CheckpointRepo(conn);
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const messages = new DefaultMessageService({
    conn,
    sessions: sessionRepo,
    messages: messageRepo,
    vfs: vfsRepo,
    checkpoints: checkpointRepo,
    revisions: revisionRepo,
  });

  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const toolRunner = new ToolRunner(registry);

  return {
    conn,
    sessions: sessionRepo,
    sessionKkv: createSessionKkvService(conn),
    messages,
    chatMessages: messageRepo,
    checkpoints: checkpointRepo,
    entries: vfsRepo,
    revisions: revisionRepo,
    toolRunner,
    resolveToolCtx: (sid, pid) => makeToolCtx(conn, pid, sid),
    messageCheckpoint: createMessageCheckpointService(conn),
    ...overrides,
  };
}

function writeOp(path: string, content: string, toolId = "tu_write") {
  return {
    actionXml: `<action name="write">\n${JSON.stringify({ path, content }, null, 2)}\n</action>`,
    tools: [
      {
        id: toolId,
        name: "write",
        input: { path, content },
      },
    ],
  };
}

/** 从 user_ops attachment XML 抽取 path/from/to（稳定排序）。 */
function pathsFromUserOpsXml(content: string): string[] {
  const paths = new Set<string>();
  for (const match of content.matchAll(/"path"\s*:\s*"([^"]+)"/g)) {
    paths.add(match[1]!);
  }
  for (const match of content.matchAll(/"(?:from|to)"\s*:\s*"([^"]+)"/g)) {
    paths.add(match[1]!);
  }
  return [...paths].sort();
}

describe("UserVfsTurnService", () => {
  it("F1：A+U pending 空续跑后顺序为 A, U（含 user_ops，无 UA）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    await ctx.messages.append(session.id, "user", textBlocks("用户续跑"));

    await userVfsTurn.executeOp(session.id, writeOp("/f1.md", "content"));

    await prepareUserVfsTurnForAgentRun({
      messages: ctx.messages,
      userVfsTurn,
      sessionId: session.id,
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]!.role, "assistant");
    assert.equal(listed[1]!.role, "user");
    const tailText = listed[1]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "用户续跑");
    assert.ok(
      listed.some((m) => readMessageMetadata(m.raw)?.kind === "user_vfs_action") ===
        false,
    );
    assert.equal(listed[1]!.attachments?.[0]?.source, "user_ops");
  });

  it("F2：A + pending 发送 hi 后顺序为 A, U(hi+user_ops)", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    await userVfsTurn.executeOp(session.id, writeOp("/f2.md", "content"));

    const prepared = await prepareUserVfsTurnForAgentRun({
      messages: ctx.messages,
      userVfsTurn,
      sessionId: session.id,
      trimmedInput: "hi",
    });
    await ctx.messages.append(session.id, "user", textBlocks("hi"), {
      attachments: prepared.attachments,
    });

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]!.role, "assistant");
    assert.equal(listed[1]!.role, "user");
    const tailText = listed[1]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "hi");
    assert.equal(listed[1]!.attachments?.[0]?.source, "user_ops");
  });

  it("F3：仅 U + pending 空续跑后顺序为 U（含 user_ops）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "user", textBlocks("用户续跑"));
    await userVfsTurn.executeOp(session.id, writeOp("/f3.md", "content"));

    await prepareUserVfsTurnForAgentRun({
      messages: ctx.messages,
      userVfsTurn,
      sessionId: session.id,
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.role, "user");
    const tailText = listed[0]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "用户续跑");
    assert.equal(listed[0]!.attachments?.[0]?.source, "user_ops");
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

    await prepareUserVfsTurnForAgentRun({
      messages: ctx.messages,
      userVfsTurn,
      sessionId: session.id,
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

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

    const fail = await userVfsTurn.executeOp(session.id, {
      actionXml: '<action name="write">\n{"path":"/x.md","content":""}\n</action>',
      tools: [
        {
          id: "tu_bad",
          name: "write",
          input: { path: "/x.md" },
        },
      ],
    });
    assert.equal(fail.ok, false);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);

    const ok = await userVfsTurn.executeOp(
      session.id,
      writeOp("/ok.md", "hello", "tu_ok"),
    );
    assert.equal(ok.ok, true);
    const pendingJson = await loadPendingQueueJson(ctx.conn, session.id);
    assert.ok(pendingJson);
    const pending = JSON.parse(pendingJson!) as unknown[];
    assert.equal(pending.length, 1);
    assert.equal((pending[0] as { tools: { id: string }[] }).tools[0]?.id, "tu_ok");
  });

  it("T-UO1：flush 不产生 user_vfs_action 行，仅产出 attachments 并清 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/a.md", "A"));
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(flush.attachments.length, 1);
    assert.equal(flush.attachments[0]!.source, "user_ops");

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
    assert.equal(
      messages.some(
        (m) => readMessageMetadata(m.raw)?.kind === "user_vfs_action",
      ),
      false,
    );
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
  });

  it("T-UO3：user_ops attachment.content 为 action XML（非 JSON）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/uo3.md", "body"));
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    const content = flush.attachments[0]!.content;
    assert.ok(typeof content === "string");
    assert.match(content!, /<action/);
    assert.equal(content!.trimStart().startsWith("{"), false);
    assert.equal(content!.includes("<system-message>"), false);
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

    const userVfsTurn = new DefaultUserVfsTurnService(
      makeUserVfsTurnDeps(ctx.conn, { toolRunner: trackingRunner }),
    );

    await userVfsTurn.executeOp(session.id, writeOp("/track.md", "T"));
    assert.equal(runParallelCalls, 1);

    await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(runParallelCalls, 1);
  });

  it("burst 3 次 pending flush 为 3×user_ops 附件（每 path 一条）且无消息行", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/1.md", "one", "tu_1"));
    await userVfsTurn.executeOp(session.id, writeOp("/2.md", "two", "tu_2"));
    await userVfsTurn.executeOp(session.id, writeOp("/3.md", "three", "tu_3"));

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(flush.attachments.length, 3);
    assert.deepEqual(
      flush.attachments.map((a) => a.name).sort(),
      ["/1.md", "/2.md", "/3.md"],
    );
    assert.ok(flush.attachments.every((a) => a.action === "write"));
    assert.ok(flush.attachments.every((a) => a.name === a.path));
    assert.equal((await ctx.messages.listBySession(session.id)).length, 0);
  });

  it("创建后再改同一文件：flush 仅一条 write，不以 pending write+edit 命名", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const v1 = "alpha\nbeta\ngamma\n";
    const v2 = "alpha\nbeta-edited\ngamma\n";
    await userVfsTurn.executeOp(session.id, writeOp("/net.md", v1, "tu_w"));
    // 再保存：相对刚写入内容走 edit；相对 checkpoint（空）净 diff 仍为 added → write
    const saveOp = buildUserVfsSaveOp(v1, v2, "/net.md", v2);
    assert.ok(saveOp);
    assert.equal(saveOp!.tools[0]?.name, "edit");
    await userVfsTurn.executeOp(session.id, saveOp!);

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(flush.attachments.length, 1);
    assert.equal(flush.attachments[0]!.name, "/net.md");
    assert.equal(flush.attachments[0]!.action, "write");
    assert.equal(flush.attachments[0]!.path, "/net.md");
    assert.match(flush.attachments[0]!.content ?? "", /name="write"/);
    assert.match(flush.attachments[0]!.content ?? "", /"content"/);
    assert.ok((flush.attachments[0]!.content ?? "").includes("beta-edited"));
    assert.equal(
      (flush.attachments[0]!.content ?? "").includes('name="edit"'),
      false,
    );
  });

  it("flush 本身不 capture；带 user_ops 的 user append 后可锚定 checkpoint", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const captureCalls: Array<{ sessionId: string; messageId: string }> = [];
    const mockCheckpoint: MessageCheckpointService = {
      capture: async (sessionId, _projectId, messageId) => {
        captureCalls.push({ sessionId, messageId });
      },
    };

    const deps = makeUserVfsTurnDeps(ctx.conn, {
      messageCheckpoint: mockCheckpoint,
    });
    const userVfsTurn = new DefaultUserVfsTurnService(deps);

    await userVfsTurn.executeOp(session.id, writeOp("/cp.md", "checkpoint"));
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(captureCalls.length, 0);

    const userMsg = await deps.messages.append(
      session.id,
      "user",
      textBlocks("带 ops"),
      { attachments: flush.attachments },
    );
    await ctx.messageCheckpoint.capture(session.id, project.id, userMsg.id);

    await svfs.write("/extra.md", "x", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, userMsg.id);
    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const tree = await repo.loadFileTree(session.id, userMsg.id);
    assert.ok(tree);
    assert.equal(tree.has("/cp.md"), true);
  });

  it("T-TS1：空续跑重排 delete+re-append 不丢末条 attachments", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const priorAttachments = [
      {
        name: "/prior.md",
        source: "attach" as const,
        type: "text" as const,
        content: null,
        path: "/prior.md",
      },
    ];
    await ctx.messages.append(session.id, "user", textBlocks("续跑原文"), {
      attachments: priorAttachments,
    });
    await userVfsTurn.executeOp(session.id, writeOp("/ts1.md", "ops"));

    await prepareUserVfsTurnForAgentRun({
      messages: ctx.messages,
      userVfsTurn,
      sessionId: session.id,
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 1);
    const att = listed[0]!.attachments ?? [];
    assert.ok(att.some((a) => a.source === "attach" && a.path === "/prior.md"));
    assert.ok(att.some((a) => a.source === "user_ops"));
    const body = listed[0]!.content.blocks[0];
    assert.equal(body?.type === "text" ? body.text : "", "续跑原文");
    assert.equal(
      (body?.type === "text" ? body.text : "").includes("<attachment>"),
      false,
    );
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

    const userVfsTurn = new DefaultUserVfsTurnService(
      makeUserVfsTurnDeps(ctx.conn, { toolRunner }),
    );

    const result = await userVfsTurn.executeOp(session.id, {
      actionXml: '<action name="write">\n{"path":"/f.md","content":""}\n</action>',
      tools: [{ id: "tu_boom", name: "test.boom", input: {} }],
    });
    assert.equal(result.ok, false);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
  });


  it("T1：第二次 tool 失败时回滚已成功 path 且 pending 为空", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
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

    const userVfsTurn = new DefaultUserVfsTurnService(
      makeUserVfsTurnDeps(ctx.conn, { toolRunner }),
    );

    const result = await userVfsTurn.executeOp(session.id, {
      actionXml:
        '<action name="write">\n{"path":"/a.md","content":""}\n</action>\n<action name="write">\n{"path":"/b.md","content":""}\n</action>',
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
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
    await assert.rejects(() => svfs.read("/a.md"));
    await assert.rejects(() => svfs.read("/b.md"));
  });

  it("T2：两次 tool 均成功时 pending 一条且磁盘保留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolRunner = new ToolRunner(registry);

    const userVfsTurn = new DefaultUserVfsTurnService(makeUserVfsTurnDeps(ctx.conn));

    const ok = await userVfsTurn.executeOp(session.id, {
      actionXml:
        '<action name="write">\n{"path":"/1.md","content":""}\n</action>\n<action name="write">\n{"path":"/2.md","content":""}\n</action>',
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

    const pendingJson = await loadPendingQueueJson(ctx.conn, session.id);
    assert.ok(pendingJson);
    assert.equal(JSON.parse(pendingJson).length, 1);
    assert.equal((await svfs.read("/1.md")).content, "one");
    assert.equal((await svfs.read("/2.md")).content, "two");
  });

  it("T3：flush 不 insert message（attachments 仅返回）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const userVfsTurn = new DefaultUserVfsTurnService(makeUserVfsTurnDeps(ctx.conn));

    await userVfsTurn.executeOp(session.id, writeOp("/tx.md", "body"));
    let insertCount = 0;
    const origInsert = SqliteMessageRepository.prototype.insert;
    SqliteMessageRepository.prototype.insert = async function insertSpy(message) {
      insertCount += 1;
      return origInsert.call(this, message);
    };

    try {
      const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
      assert.equal(flush.flushed, true);
      assert.equal(insertCount, 0);
      assert.equal((await ctx.messages.listBySession(session.id)).length, 0);
    } finally {
      SqliteMessageRepository.prototype.insert = origInsert;
    }
  });

  it("T5：flush 清 pending 且不调用 capture、不落库消息", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    let captureCalled = false;
    const deps = makeUserVfsTurnDeps(ctx.conn, {
      messageCheckpoint: {
        capture: async () => {
          captureCalled = true;
          throw new Error("capture should not run");
        },
      },
    });
    const userVfsTurn = new DefaultUserVfsTurnService(deps);

    await userVfsTurn.executeOp(session.id, writeOp("/cap.md", "x"));
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(captureCalled, false);
    assert.equal((await deps.messages.listBySession(session.id)).length, 0);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
  });

  it("F4 flush：pending 非空但 net diff 空（删目录再 mkdir 同路径）→ 无 message、pending 清空", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, buildUserVfsMkdirOp("/drafts"));
    await userVfsTurn.executeOp(session.id, buildUserVfsDeleteOp("/drafts", true));

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, false);
    assert.deepEqual(flush.attachments, []);
    assert.equal((await ctx.messages.listBySession(session.id)).length, 0);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
  });

  it("F4 flush：真删除仍产出 user_ops（含 delete action XML）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/gone.md", "bye"));
    const firstFlush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(firstFlush.flushed, true);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);

    // 第一次 ops 需落 checkpoint 才能作为后续 delete 的 baseline
    const anchor = await ctx.messages.append(
      session.id,
      "user",
      textBlocks(""),
      { attachments: firstFlush.attachments },
    );
    await ctx.messageCheckpoint.capture(session.id, project.id, anchor.id);

    await userVfsTurn.executeOp(
      session.id,
      buildUserVfsDeleteOp("/gone.md", false),
    );
    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.match(flush.attachments[0]!.content ?? "", /\/gone\.md/);
    assert.match(flush.attachments[0]!.content ?? "", /name="delete"/);
    assert.equal((await ctx.messages.listBySession(session.id)).length, 1);
  });

  it("F4 flush：删文件再 write 同路径同内容 → net diff 空", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/round.md", "same"));
    const first = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    const anchor = await ctx.messages.append(
      session.id,
      "user",
      textBlocks(""),
      { attachments: first.attachments },
    );
    await ctx.messageCheckpoint.capture(session.id, project.id, anchor.id);

    await userVfsTurn.executeOp(session.id, buildUserVfsDeleteOp("/round.md", false));
    await userVfsTurn.executeOp(session.id, writeOp("/round.md", "same", "tu_rewrite"));

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, false);
    assert.equal((await ctx.messages.listBySession(session.id)).length, 1);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
  });

  it("executeOp 可递归删除目录（不触发 IS_DIRECTORY）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);

    await svfs.mkdir("/55");
    await svfs.write("/55/诗歌.txt", "poem", { versionCheck: false });

    const result = await userVfsTurn.executeOp(
      session.id,
      buildUserVfsDeleteOp("/55", true),
    );
    assert.equal(result.ok, true);
    await assert.rejects(() => svfs.list("/55"));
  });

  it("T-FC1 assembly: createUserVfsTurnServiceBundle write 后有 file_cache full:{path}", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const sk = createSessionKkvService(ctx.conn);

    const result = await userVfsTurn.executeOp(
      session.id,
      writeOp("/asm-fc.md", "from-bundle"),
    );
    assert.equal(result.ok, true);

    const raw = await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/asm-fc.md"),
    );
    assert.ok(raw != null, "sessionKkv 须经 resolveToolCtx 注入");
    const payload = parseFileCachePayload(raw!);
    assert.ok(payload != null);
    assert.equal(payload!.body, "from-bundle");
  });

  it("T-OP2：preview path 与即将 flush 的 path 集一致，且不清 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(session.id, writeOp("/op2-a.md", "A", "tu_a"));
    await userVfsTurn.executeOp(session.id, writeOp("/op2-b.md", "B", "tu_b"));

    const preview = await userVfsTurn.previewUserOpsChangedPaths(session.id);
    assert.deepEqual([...preview], ["/op2-a.md", "/op2-b.md"]);
    assert.equal(await userVfsTurn.hasPendingTurns(session.id), true);
    assert.ok(await loadPendingQueueJson(ctx.conn, session.id));

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.deepEqual(
      pathsFromUserOpsXml(
        flush.attachments.map((a) => a.content ?? "").join("\n"),
      ),
      [...preview],
    );
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
  });

  it("T-OP3：同 path 写 A 再写回 baseline → preview 空集且不清 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/op3.md", "baseline", "tu_base"),
    );
    const firstFlush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(firstFlush.flushed, true);
    const anchor = await ctx.messages.append(
      session.id,
      "user",
      textBlocks(""),
      { attachments: firstFlush.attachments },
    );
    await ctx.messageCheckpoint.capture(session.id, project.id, anchor.id);

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/op3.md", "changed", "tu_a"),
    );
    assert.deepEqual(
      [...(await userVfsTurn.previewUserOpsChangedPaths(session.id))],
      ["/op3.md"],
    );

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/op3.md", "baseline", "tu_back"),
    );
    const preview = await userVfsTurn.previewUserOpsChangedPaths(session.id);
    assert.deepEqual([...preview], []);
    assert.equal(await userVfsTurn.hasPendingTurns(session.id), true);
    assert.ok(await loadPendingQueueJson(ctx.conn, session.id));
  });

  it("T-SD1：发送 flush 出 user_ops → pending 空且 checkpoint 后上条空", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/sd1.md", "payload", "tu_sd1"),
    );

    const statusDeps = {
      sessionKkv: ctx.sessionKkv,
      loadLiveWorkplacePaths: async () => [] as const,
      previewUserOpsActions: (id: string) =>
        userVfsTurn.previewUserOpsActions(id),
    };

    const before = await projectComposerStatusAttachments(
      session.id,
      statusDeps,
    );
    assert.ok(
      before.some(a => a.source === "user_ops" && a.path === "/sd1.md"),
      "flush 前应有 user_ops 状态 chip",
    );

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(await userVfsTurn.hasPendingTurns(session.id), false);
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);

    // 现网发送：append 带 user_ops → capture checkpoint（投影相对新基线）
    const anchor = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("send"),
      { attachments: flush.attachments },
    );
    await ctx.messageCheckpoint.capture(session.id, project.id, anchor.id);

    const after = await projectComposerStatusAttachments(session.id, statusDeps);
    assert.equal(
      after.filter(a => a.source === "user_ops").length,
      0,
      "发送收尾后上条不应再有 user_ops",
    );
  });

});
