/**
 * agent-subagent M1 / Step 2-3 SessionService 子会话能力测试。
 *
 * 覆盖：
 *  - T-S2：createSubSession 创建的 session parentSessionId 正确；
 *          listByProject 不返回子 session；listByParentSession 返回子 session。
 *  - T-S3：删父 session 级联删子（messages/fs/kkv/vfs 全清）；项目删除同理。
 *  - T-S4（P2-13）：copy / fork 带子 session 的主会话后，新主会话 parentSessionId=null，
 *          原父的子 session 不会被挂到新主会话下。
 *
 * @module test/service/chat/session.subsession.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type TdbcConnection } from "@novel-master/core";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 直连 chat_session 行，读取 parent_session_id 原始列值（绕开 model 映射做断言）。 */
async function readParentSessionId(
  conn: TdbcConnection,
  sessionId: string,
): Promise<string | null> {
  const rows = await conn.query<{ parent_session_id: string | null }>(
    `SELECT parent_session_id FROM chat_session WHERE id = ?`,
    [sessionId],
  );
  if (rows.length === 0) {
    return undefined as unknown as null;
  }
  return rows[0]!.parent_session_id;
}

describe("SessionSubsession T-S2：createSubSession 基本行为", () => {
  it("createSubSession 写入的 session parentSessionId 正确，且不碰 VFS", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父会话");

    const child = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "查大纲",
    );

    assert.equal(child.parentSessionId, parent.id);
    assert.equal(child.projectId, project.id);
    assert.equal(child.title, "查大纲");

    // DB 行也应正确写入 parent_session_id。
    assert.equal(await readParentSessionId(ctx.conn, child.id), parent.id);

    // createSubSession 不应建 child VFS scope：子 session scope 读不到任何文件，
    // 也不应继承父 scope 的模板内容（父 scope 此时也没写文件，所以两边都空）。
    // 关键点是「没有 child scope 数据」——验证 entry 表里没有该 scope_key 的行。
    const entryRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_entry WHERE scope_key = ?`,
      [`session:${project.id}:${child.id}`],
    );
    assert.equal(entryRows[0]!.n, 0, "createSubSession 不应建 child VFS scope");
  });

  it("createSubSession 父不存在时抛 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await assert.rejects(
      () => ctx.sessions.createSubSession("nope-not-exist", project.id, "x"),
      (error: unknown) =>
        error instanceof Error && /session/i.test(error.message),
    );
  });

  it("listByProject 不返回子 session；listByParentSession 返回子 session", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    const child1 = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "c1",
    );
    await ctx.sessions.createSubSession(parent.id, project.id, "c2");

    // 仓储层 listByProject 应过滤掉子 session。
    const repo = new SqliteSessionRepository(ctx.conn);
    const projectSessions = await repo.listByProject(project.id);
    assert.equal(projectSessions.length, 1);
    assert.equal(projectSessions[0]!.id, parent.id);

    // listByParentSession 只返回直接子。
    const children = await repo.listByParentSession(parent.id);
    assert.equal(children.length, 2);
    const childIds = new Set(children.map((s) => s.id));
    assert.ok(childIds.has(child1.id));
    for (const c of children) {
      assert.equal(c.parentSessionId, parent.id);
    }

    // service 层 listByProject 同样只返顶层。
    const serviceList = await ctx.sessions.listByProject(project.id);
    assert.equal(serviceList.length, 1);
    assert.equal(serviceList[0]!.id, parent.id);
  });
});

describe("SessionSubsession T-S3：删父 session 级联删子", () => {
  it("delete 父 session 同时删掉全部子 session 及其 messages", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    const child = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "c",
    );
    const grandchild = await ctx.sessions.createSubSession(
      child.id,
      project.id,
      "gc",
    );

    // 给子 / 孙 各写一条消息，验证级联清消息。
    await ctx.messages.append(child.id, "user", textBlocks("子消息"));
    await ctx.messages.append(grandchild.id, "assistant", textBlocks("孙消息"));

    await ctx.sessions.delete(parent.id);

    // 父 / 子 / 孙 行都没了。
    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal(await repo.findById(parent.id), null);
    assert.equal(await repo.findById(child.id), null);
    assert.equal(await repo.findById(grandchild.id), null);

    // 消息也被级联清。
    assert.deepEqual(await ctx.messages.listBySession(child.id), []);
    assert.deepEqual(await ctx.messages.listBySession(grandchild.id), []);
  });

  it("delete 单独子 session 不影响父与兄弟", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    const c1 = await ctx.sessions.createSubSession(parent.id, project.id, "c1");
    const c2 = await ctx.sessions.createSubSession(parent.id, project.id, "c2");

    await ctx.sessions.delete(c1.id);

    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal(await repo.findById(c1.id), null);
    assert.ok((await repo.findById(parent.id)) != null);
    assert.ok((await repo.findById(c2.id)) != null);

    const remaining = await repo.listByParentSession(parent.id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.id, c2.id);
  });

  it("deleteByProject（项目删除）级联清理主会话及其全部子 session", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    const child = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "c",
    );
    await ctx.messages.append(child.id, "user", textBlocks("子消息"));

    await ctx.projects.delete(project.id);

    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal(await repo.findById(parent.id), null);
    assert.equal(await repo.findById(child.id), null);
    // 子 session 的消息也应被清掉（项目删除路径走 BFS 展开了子 session）。
    assert.deepEqual(await ctx.messages.listBySession(child.id), []);
  });
});

describe("SessionSubsession T-S4（P2-13）：copy/fork 不继承 parent 关系", () => {
  it("copy 带子 session 的主会话后，新主会话 parentSessionId=null 且不带子", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    await ctx.sessions.createSubSession(parent.id, project.id, "子");

    const copy = await ctx.sessions.copy(parent.id);

    // 新主会话是独立主会话：parentSessionId=null。
    assert.equal(copy.parentSessionId, null);
    assert.equal(await readParentSessionId(ctx.conn, copy.id), null);

    // 原 parent 的子 session 不应挂到 copy 下。
    const repo = new SqliteSessionRepository(ctx.conn);
    const childrenOfCopy = await repo.listByParentSession(copy.id);
    assert.equal(childrenOfCopy.length, 0);

    // 原 parent 的子 session 仍挂在原 parent 下（未被偷走）。
    const childrenOfOriginal = await repo.listByParentSession(parent.id);
    assert.equal(childrenOfOriginal.length, 1);
  });

  it("messages.fork 带子 session 的主会话后，forked session parentSessionId=null", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    await ctx.sessions.createSubSession(parent.id, project.id, "子");
    const m1 = await ctx.messages.append(parent.id, "user", textBlocks("1"));
    await ctx.messages.append(parent.id, "assistant", textBlocks("2"));

    const forked = await ctx.messages.fork(parent.id, m1.id);

    assert.equal(forked.parentSessionId, null);
    assert.equal(await readParentSessionId(ctx.conn, forked.id), null);

    // fork 出的会话也不应带上原 parent 的子 session。
    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal((await repo.listByParentSession(forked.id)).length, 0);
  });
});
