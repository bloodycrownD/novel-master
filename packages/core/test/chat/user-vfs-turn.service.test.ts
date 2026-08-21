import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { type BuiltinToolContext, type TdbcConnection } from "@novel-master/core";
import { createUserVfsTurnServiceBundle } from "@novel-master/core/chat";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  USER_VFS_PENDING_QUEUE_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { parseFileCachePayload } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
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
  scopeKey,
} from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import { buildUserVfsDeleteOp } from "../../src/service/vfs/build-user-vfs-turn-op.js";
import { createMessageCheckpointService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import type { UserVfsTurnServiceDeps } from "../../src/service/chat/impl/user-vfs-turn.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 断言已停写 user_vfs_pending kkv（user ops 拆除后无操作日志半边）。 */
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

describe("UserVfsTurnService", () => {
  it("execute 失败不写盘；成功仅写盘并停写 pending kkv（无操作日志半边）", async () => {
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
    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
    assert.equal(
      (await ctx.sessionVfs(project.id, session.id).read("/ok.md")).content,
      "hello",
    );
  });

  it("user_ops write 新建文件补父链目录规则（与 agent 链路一致，C-orch-1）", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const ok = await userVfsTurn.executeOp(
      session.id,
      writeOp("/u/v/w/a.md", "hello", "tu_wr"),
    );
    assert.equal(ok.ok, true);

    // resolveToolCtx 注入了 session scope workplace：
    // 新建文件的父链各层应补上默认 rule_on，与 agent 链路同款
    const workplace = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    assert.equal((await workplace.getDirRule("/u"))?.ruleEnabled, true);
    assert.equal((await workplace.getDirRule("/u/v"))?.ruleEnabled, true);
    assert.equal((await workplace.getDirRule("/u/v/w"))?.ruleEnabled, true);
  });

  it("execute 使用会抛错的 tool 时不写 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registry.register({
      name: "test.boom",
      description: () => "boom",
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

  it("T-UO-SWEEP1：第二次 tool 失败时回滚已成功 path，且 sweep+blob gc；composite 后仍 sweep", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

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
          input: { path: "/a.md", content: "A-orphan-body" },
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

    // restore 后不可达 revision 被 sweep；无引用 blob 被全库 gc
    const sk = scopeKey(scope);
    const keys = await revisions.listKeysUnderScope(sk, "/");
    // entry 已被回滚清理，scope 下的 revision 均不可达，应全部被 sweep
    assert.equal(
      keys.filter((k) => k.entryId !== undefined).length,
      0,
      "失败回滚后 scope 下不应有残留 revision",
    );
    // content_hash 列始终存 hashContent() 输出的 hex 格式（SHA-256 hex），
    // zlib b64 只影响 bytes 列编码，不影响 content_hash 列。可直接精确验证。
    const orphanHash = hashContent("A-orphan-body");
    const hashRows = await ctx.conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM vfs_content_blob`,
      [],
    );
    assert.equal(
      hashRows.some((r) => String(r.content_hash) === orphanHash),
      false,
      "orphan blob 应被 runDeferredBlobGc 清理",
    );

    // composite restore 后仍执行 sweep：预埋不可达 revision，restore 抛错后须消失
    await svfs.write("/orphan-sweep.md", "seed", { versionCheck: false });
    const orphanEntry = await entries.findByPath(sk, "/orphan-sweep.md");
    assert.ok(orphanEntry != null);
    // 用 seed 产生 entry + revision 后，再 append 一个相同 entryId 但不可达的 revision
    await revisions.append({
      entryId: orphanEntry.entryId,
      version: 99,
      content: "pre-sweep-orphan",
      status: "active",
      mtimeMs: Date.now(),
    });
    const beforeOrphan = await revisions.findByEntryAndVersion(orphanEntry.entryId, 99);
    assert.ok(beforeOrphan);

    const baseVfs = createScopedVfsService(ctx.conn, scope);
    const failingVfs = new Proxy(baseVfs, {
      get(target, prop, receiver) {
        if (prop === "hardDelete" || prop === "resetHeadToVersion") {
          return async () => {
            throw new Error("restore composite boom");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const compositeTurn = new DefaultUserVfsTurnService(
      makeUserVfsTurnDeps(ctx.conn, {
        toolRunner,
        resolveToolCtx: () => ({
          vfs: failingVfs,
          projectId: project.id,
          sessionId: session.id,
          listSessionMessages: () =>
            new SqliteMessageRepository(ctx.conn).listBySession(session.id),
          sessionKkv: createSessionKkvService(ctx.conn),
        }),
      }),
    );

    const compositeResult = await compositeTurn.executeOp(session.id, {
      actionXml:
        '<action name="write">\n{"path":"/c.md","content":""}\n</action>\n<action name="write">\n{"path":"/d.md","content":""}\n</action>',
      tools: [
        {
          id: "tu_c",
          name: "write",
          input: { path: "/c.md", content: "C" },
        },
        {
          id: "tu_d",
          name: "write",
          input: { path: "/d.md", content: "D" },
        },
      ],
    });
    assert.equal(compositeResult.ok, false);
    assert.ok(compositeResult.partialFailure);
    const afterOrphan = await revisions.findByEntryAndVersion(orphanEntry.entryId, 99);
    assert.equal(
      afterOrphan,
      null,
      "restore 抛 composite 后仍须 sweep 掉不可达 revision",
    );
  });

  it("T2：两次 tool 均成功时磁盘保留、停写 pending kkv", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

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

    assert.equal(await loadPendingQueueJson(ctx.conn, session.id), null);
    assert.equal((await svfs.read("/1.md")).content, "one");
    assert.equal((await svfs.read("/2.md")).content, "two");
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
});
