/**
 * C2-10（CD-01 四步重排）· 间隙注入回归锁：R3 / R4 / R5。
 *
 * 这三条都只能在「plan 段与事务段之间存在一个可控间隙」时构造出来，而单连接写
 * 事务内**造不出真正的并发窗口**（同连接注入只会稳定复现坏状态）。因此本文件
 * 用的是 spec 点名的手法：**包一层 `conn`，在 `transaction` 回调真正开始之前
 * 做一次副作用**——那个位置正好落在 `resolveRollbackPlan` 算完指纹之后、
 * 事务体第一行之前，就是真实世界的 TOCTOU 间隙。
 *
 * - **R3 文件面乐观锁有牙**：间隙里改文件（消息数不变）⇒ 必须抛
 *   `ROLLBACK_CONFLICT`，重试耗尽后向上抛，**不静默**。
 *   旧形态（乐观锁只比 `chat_message` 行数）在同一注入下全绿 ⇒ 有牙。
 * - **R4 删集合用事务内 live 树**：间隙里新增一个文件 ⇒ 冲突后重试的 plan 把它
 *   纳入 live 快照，事务内重算出的删集合**包含**它 ⇒ 该文件被删。
 *   判据取 spec 给的两个验收里的第二个（「冲突抛出后重试的 plan 已包含它」）：
 *   若第 3 步被回退成「删集合取自事务外旧快照」，这个文件会**活下来** ⇒ 变红。
 * - **R5 tailIds 断言**：间隙里把 tail 的一条消息换成一条 seq 更大的新消息
 *   （消息总数不变、文件面不动）⇒ 计数闸与指纹闸都放行，撞上 tail 断言 ⇒ 抛
 *   `ROLLBACK_TAIL_DRIFT`，且那条新消息**未被截断**。
 *
 * @module test/message-checkpoint/rollback-fingerprint-lock
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createMessageRollbackService } from "@/service/message-checkpoint/create-message-checkpoint-services.js";
import { isSessionFsError } from "@/errors/session-fs-errors.js";
import { openSqlCountingNovelMasterTestConnection } from "../helpers/sql-counting-connection.js";
import { testIsolationSuffix } from "../helpers/novel-master-fixture.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import type { Row } from "../../src/infra/tdbc/types.js";

type Ctx = Awaited<ReturnType<typeof openSqlCountingNovelMasterTestConnection>>;

let ctx: Ctx;

before(async () => {
  ctx = await openSqlCountingNovelMasterTestConnection();
});
after(async () => {
  await ctx.conn.close();
});

// ---------------------------------------------------------------------------
// 间隙注入夹具
// ---------------------------------------------------------------------------

/**
 * 包一层 conn，让 `transaction` 回调开始**之前**先跑一次副作用。
 *
 * @param onGap 副作用；`attempt` 是第几次进入事务（0 起）。返回值即副作用本身。
 */
function gapInjectingConn(
  inner: TdbcConnection,
  onGap: (attempt: number) => Promise<void>
): { readonly conn: TdbcConnection; readonly attempts: () => number } {
  let attempts = 0;
  const conn: TdbcConnection = {
    execute: (sql, p) => inner.execute(sql, p),
    query: <R extends Row = Row>(sql: string, p?: readonly unknown[]) =>
      inner.query<R>(sql, p),
    batch: (sql, pl) => inner.batch(sql, pl),
    async transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
      const attempt = attempts++;
      // 关键：这一步发生在**事务之外**（还没有 BEGIN，驱动 mutex 未持有），
      // 所以副作用可以安全地用同一连接读写——这正是真实 TOCTOU 间隙的形状。
      await onGap(attempt);
      return inner.transaction(fn);
    },
    close: () => inner.close(),
  };
  return { conn, attempts: () => attempts };
}

// ---------------------------------------------------------------------------
// 业务夹具：锚点（rewind 型）+ 一轮 tail
// ---------------------------------------------------------------------------

interface Fixture {
  readonly projectId: string;
  readonly sessionId: string;
  /** rewind 锚点（assistant，mode = rewind ⇒ hasDirectTargetTree = true）。 */
  readonly anchorId: string;
  /** 锚点时 /base.md 的正文（restore 后的期望值）。 */
  readonly anchorBody: string;
}

/** user1 → assistantA(+capture) → user2 → assistantB(+capture)。 */
async function seedRollbackFixture(prefix: string): Promise<Fixture> {
  const project = await ctx.projects.create(`P-${prefix}-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
  const svfs = ctx.sessionVfs(project.id, session.id);

  await ctx.messages.append(session.id, "user", textBlocks("q1"));
  const anchorA = await ctx.messages.append(session.id, "assistant", textBlocks("a1"));
  await svfs.write("/base.md", "anchor-body", { versionCheck: false });
  await ctx.messageCheckpoint.capture(session.id, project.id, anchorA.id);

  await ctx.messages.append(session.id, "user", textBlocks("q2"));
  const anchorB = await ctx.messages.append(session.id, "assistant", textBlocks("a2"));
  await svfs.write("/base.md", "tail-body", { versionCheck: false });
  await svfs.write("/extra.md", "created-after-anchor", { versionCheck: false });
  await ctx.messageCheckpoint.capture(session.id, project.id, anchorB.id);

  return {
    projectId: project.id,
    sessionId: session.id,
    anchorId: anchorA.id,
    anchorBody: "anchor-body",
  };
}

/** 会话 scope 下现有文件的逻辑路径集合。 */
async function livePaths(projectId: string, sessionId: string): Promise<string[]> {
  const rows = await ctx.conn.query<{ path: string }>(
    `SELECT path FROM vfs_entry
      WHERE scope_key = ? AND entry_kind = 'file'
      ORDER BY path ASC`,
    [`session:${projectId}:${sessionId}`]
  );
  return rows.map((r) => String(r.path));
}

// ---------------------------------------------------------------------------
// R3：文件面乐观锁
// ---------------------------------------------------------------------------

describe("C2-10 R3: 间隙改文件 ⇒ ROLLBACK_CONFLICT 且不静默", () => {
  it("T-RB-FP-R3: 消息数不变、只动文件面 ⇒ 冲突抛到底（重试耗尽）", async () => {
    const fx = await seedRollbackFixture("r3");

    // 前置：锚点时消息数 N；注入只写文件，不碰 chat_message。
    const messageCountBefore = (await ctx.messages.listBySession(fx.sessionId)).length;

    // 每次进入事务都写一个**新路径** ⇒ 指纹每次都变 ⇒ 冲突不会被重试化解。
    const { conn, attempts } = gapInjectingConn(ctx.conn, async (attempt) => {
      await ctx
        .sessionVfs(fx.projectId, fx.sessionId)
        .write(`/gap-${attempt}.md`, `gap-${attempt}`, { versionCheck: false });
    });
    const rollback = createMessageRollbackService(conn);

    await assert.rejects(
      () => rollback.rollbackToMessage(fx.sessionId, fx.projectId, fx.anchorId),
      (error: unknown) => {
        assert.ok(
          isSessionFsError(error, "ROLLBACK_CONFLICT"),
          `必须是 ROLLBACK_CONFLICT，实际：${String(error)}`
        );
        return true;
      },
      "文件面变了就必须报冲突（旧乐观锁只比消息行数，这一支会静默绿）"
    );

    assert.ok(
      attempts() >= 2,
      `乐观锁重试循环应至少跑过 2 次 plan，实际只跑了 ${attempts()} 次`
    );
    // 注入没碰消息表 ⇒ 消息行数不变，这正是旧锁漏掉的那种间隙。
    assert.equal(
      (await ctx.messages.listBySession(fx.sessionId)).length,
      messageCountBefore,
      "注入只动文件面，消息行数必须保持不变"
    );
    // 事务整体回滚 ⇒ 工作区未被半途改写（/base.md 仍是 tail 版本）。
    assert.equal(
      (await ctx.sessionVfs(fx.projectId, fx.sessionId).read("/base.md")).content,
      "tail-body",
      "冲突后不得留下半途写盘的结果"
    );
  });
});

// ---------------------------------------------------------------------------
// R4：删集合用事务内 live 树
// ---------------------------------------------------------------------------

describe("C2-10 R4: 间隙新增文件 ⇒ 删集合按事务内 live 树重算", () => {
  it("T-RB-FP-R4: 冲突后重试的 plan 已含新文件 ⇒ 它被事务内删集合删掉", async () => {
    const fx = await seedRollbackFixture("r4");
    const svfs = ctx.sessionVfs(fx.projectId, fx.sessionId);

    // 一次性注入：只在第一次进入事务前建文件。
    const { conn, attempts } = gapInjectingConn(ctx.conn, async (attempt) => {
      if (attempt === 0) {
        await svfs.write("/gap-once.md", "gap", { versionCheck: false });
      }
    });
    const rollback = createMessageRollbackService(conn);

    await rollback.rollbackToMessage(fx.sessionId, fx.projectId, fx.anchorId);

    assert.ok(attempts() >= 2, "第一次必须撞冲突并重试（证明间隙被锁住了）");

    // 判据：删集合来自**事务内** live 快照 ⇒ 这个文件在集合里 ⇒ 被删。
    // 若第 3 步被回退成「删集合取自事务外旧快照」，它会活下来 → 本条变红。
    const paths = await livePaths(fx.projectId, fx.sessionId);
    assert.equal(
      paths.includes("/gap-once.md"),
      false,
      "间隙新增的文件必须在事务内重算出的删集合里（否则就是按旧快照删/不删）"
    );
    // 锚点期的文件按 targetTree 恢复；tail 期新建的文件按删集合清掉。
    assert.deepEqual(
      paths,
      ["/base.md"],
      `最终工作区应只剩锚点期的 /base.md，实际 ${JSON.stringify(paths)}`
    );
    assert.equal((await svfs.read("/base.md")).content, fx.anchorBody);
    // 消息按 afterSeq 截断到锚点。
    assert.equal((await ctx.messages.listBySession(fx.sessionId)).length, 2);
  });
});

// ---------------------------------------------------------------------------
// R5：tailIds 断言
// ---------------------------------------------------------------------------

describe("C2-10 R5: 间隙换掉一条 tail 消息 ⇒ ROLLBACK_TAIL_DRIFT 且新消息不被截断", () => {
  it("T-RB-FP-R5: tail 构成变了（总数不变）⇒ 拒绝截断", async () => {
    const fx = await seedRollbackFixture("r5");

    // 找到 tail 里 seq 最小的那条（rewind 锚点之后的第一条）。
    const all = await ctx.messages.listBySession(fx.sessionId);
    const anchorSeq = all.find((m) => m.id === fx.anchorId)!.seq;
    const tail = all.filter((m) => m.seq > anchorSeq);
    assert.ok(tail.length >= 2, "夹具要求 tail 至少两条");
    const victim = tail[0]!;
    let injectedId = "";

    // 一次性注入：删掉一条 tail、补一条 seq 更大的新消息。
    //   ① 消息**总数**不变 ⇒ 计数闸放行；
    //   ② 不碰文件     ⇒ 文件面指纹闸放行；
    //   ③ tail 构成变了 ⇒ 只能被第 4 步的 tail 断言拦下。
    const { conn } = gapInjectingConn(ctx.conn, async (attempt) => {
      if (attempt !== 0) {
        return;
      }
      await ctx.messages.delete(victim.id);
      const fresh = await ctx.messages.append(
        fx.sessionId,
        "user",
        textBlocks("gap-injected")
      );
      injectedId = fresh.id;
    });
    const rollback = createMessageRollbackService(conn);

    await assert.rejects(
      () => rollback.rollbackToMessage(fx.sessionId, fx.projectId, fx.anchorId),
      (error: unknown) => {
        assert.ok(
          isSessionFsError(error, "ROLLBACK_TAIL_DRIFT"),
          `必须是 ROLLBACK_TAIL_DRIFT，实际：${String(error)}`
        );
        return true;
      },
      "tail 构成变了必须拒绝截断（否则会连带截断用户从没回滚过的新消息）"
    );

    // 事务整体回滚 ⇒ 注入的两条消息都还在（未被截断）。
    const after = await ctx.messages.listBySession(fx.sessionId);
    assert.equal(
      after.some((m) => m.id === injectedId),
      true,
      "间隙注入的新消息不得被连带截断"
    );
    assert.equal(after.length, all.length, "被拒后消息一条不少");
  });
});