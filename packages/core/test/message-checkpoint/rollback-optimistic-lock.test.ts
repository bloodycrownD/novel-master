import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createSessionFsService } from "@novel-master/core/session-fs";
import type { TdbcConnection } from "@novel-master/core";
import { isSessionFsError } from "@novel-master/core/session-fs";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

// T-SC11（A-22 乐观锁）：resolveRollbackPlan 多次 await 读与 conn.transaction 写之间
// 存在 TOCTOU 间隙——agent 可在此期间 append 消息，导致 plan 基于过期读。
// 这里通过包装 conn.transaction 在事务体真正跑之前注入一条「竞态写入」，
// 验证：(a) 冲突被检出并抛 ROLLBACK_CONFLICT（重试上限耗尽后向上抛）；
//      (b) 仅首次注入 → 重试时拿到最新快照即可成功提交（乐观锁重试生效）；
//      (c) 没有并发写入的正常路径完全不受影响（计数一致 → 直接提交）。
novelMasterTestFixture();

/**
 * 构造一个「事务开始前注入写入」的包装 conn。
 *
 * 写入通过真实的 ctx.messages.append 落库（隐式事务提交），使得 rollback 服务
 * 在事务体重读会话消息计数时拿到的是注入后的最新值——与 plan 快照不一致 → 冲突。
 *
 * @param realConn       测试 fixture 共享的 conn
 * @param injectFn       真正执行「竞态写入」的回调（每次事务前调用一次）
 * @param maxInjections  一共注入多少次；达到上限后不再注入
 */
function wrapConnWithRaceWrite(
  realConn: TdbcConnection,
  injectFn: () => Promise<void>,
  maxInjections: number,
): TdbcConnection {
  let injections = 0;
  const wrapped: TdbcConnection = {
    execute: realConn.execute.bind(realConn),
    query: realConn.query.bind(realConn),
    batch: realConn.batch.bind(realConn),
    close: realConn.close.bind(realConn),
    async transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
      if (injections < maxInjections) {
        injections += 1;
        await injectFn();
      }
      return realConn.transaction(fn);
    },
  };
  return wrapped;
}

describe("MessageRollbackService A-22 optimistic lock (T-SC11)", () => {
  it("T-SC11a: 事务开始前持续注入 agent 写入 → 重试耗尽后抛 ROLLBACK_CONFLICT", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tsc11a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 锡点消息：使其有 checkpoint 可回滚，避免被 S-13 护栏拦下。
    await svfs.write("/a.md", "at-anchor", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messageCheckpoint.capture(session.id, project.id, user1.id);
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    // 事务开始前持续注入写入——多于重试上限（3），最后一次重试仍会冲突并向上抛。
    const messagesBefore = (await ctx.messages.listBySession(session.id)).length;
    const sessionFs = createSessionFsService(
      wrapConnWithRaceWrite(
        ctx.conn,
        () =>
          ctx.messages.append(session.id, "assistant", {
            blocks: [{ type: "text", text: "race" }],
          }),
        // 比重试上限多，确保最后一次重试仍然冲突 → 向上抛 ROLLBACK_CONFLICT。
        10,
      ),
    );

    await assert.rejects(
      () => sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) => {
        assert.equal(
          isSessionFsError(error, "ROLLBACK_CONFLICT"),
          true,
          "重试上限耗尽后应抛 ROLLBACK_CONFLICT",
        );
        // better-sqlite3 驱动会把事务里抛出的非 TdbcError 用 TdbcError 包起来（cause 链指向原错误），
        // isSessionFsError 会追 cause 链识别；但 expectedMessageCount / actualMessageCount 在原
        // SessionFsError 上，所以这里从 message 文本里验证计数与预期一致。
        const message = (error as Error).message;
        assert.match(message, /预期 \d+ 条/);
        assert.match(message, /实际 \d+ 条/);
        return true;
      },
    );

    // 冲突 → 未进行任何截断，锡点消息 + 其后的 assistant + 注入的竞态消息都还在。
    const messagesAfter = await ctx.messages.listBySession(session.id);
    assert.ok(messagesAfter.length > messagesBefore);
    // /a.md 未被恢复到锡点版本——根本没有进入 reconcile。
    assert.equal((await svfs.read("/a.md")).content, "at-anchor");
  });

  it("T-SC11b: 仅第一次事务注入写入 → 重试后成功提交（乐观锁重试生效）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tsc11b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("u1"));
    await ctx.messageCheckpoint.capture(session.id, project.id, user1.id);
    await svfs.write("/a.md", "v2", { versionCheck: false });
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a1" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    // 只注入 1 次：第一次事务冲突 → 重试；第二次重试时 resolveRollbackPlan 拿到的是
    // 含竞态写入后的新快照，事务重读计数一致 → 提交成功。
    const sessionFs = createSessionFsService(
      wrapConnWithRaceWrite(
        ctx.conn,
        () =>
          ctx.messages.append(session.id, "assistant", {
            blocks: [{ type: "text", text: "race" }],
          }),
        1,
      ),
    );

    await sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    // 重试后锡点消息被截断（undo_send 语义含锡点），竞态写入也被一起截掉。
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
    assert.equal((await svfs.read("/a.md")).content, "v1");
  });

  it("T-SC11c: 无并发写入的正常路径不受影响", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tsc11c-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("u1"));
    await ctx.messageCheckpoint.capture(session.id, project.id, user1.id);
    await svfs.write("/a.md", "v2", { versionCheck: false });
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a1" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    // 走默认的 ctx.sessionFs（未包装 conn，没有任何注入）。
    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    // rewind 锡点 assistant1 保留，其后无 tail。
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, assistant1.id);
    assert.equal((await svfs.read("/a.md")).content, "v2");
  });
});
