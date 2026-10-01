/**
 * C1-1：fork 全量读收窄（CD-13）。
 *
 * 观测面纪律：断言打在 **repository prototype** 上（spy `listBySession` /
 * `listBySessionUpToSeq` 的调用数），不是「服务内部调了哪个方法」——后者在换实现后
 * 立刻失真（RULE「给读路径换实现后观测面必须同步换」）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 装一个计数 spy，返回还原函数与两个读口的调用次数。 */
function spyReadMouths(): {
  restore: () => void;
  listBySession: () => number;
  listBySessionUpToSeq: () => number;
} {
  const proto = SqliteMessageRepository.prototype;
  const origList = proto.listBySession;
  const origUpTo = proto.listBySessionUpToSeq;
  let listCalls = 0;
  let upToCalls = 0;
  proto.listBySession = function patched(...args: never[]) {
    listCalls += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origList as any).apply(this, args);
  } as typeof origList;
  proto.listBySessionUpToSeq = function patched(...args: never[]) {
    upToCalls += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origUpTo as any).apply(this, args);
  } as typeof origUpTo;
  return {
    restore: () => {
      proto.listBySession = origList;
      proto.listBySessionUpToSeq = origUpTo;
    },
    listBySession: () => listCalls,
    listBySessionUpToSeq: () => upToCalls,
  };
}

/** 造 N 条消息，其中 hidden 分布：每第 7 条 hidden=true（两侧都有）。 */
async function seedSession(
  sessionId: string,
  count: number
): Promise<{ ids: string[]; seqs: number[] }> {
  const ctx = getNovelMasterTestContext();
  const ids: string[] = [];
  const seqs: number[] = [];
  for (let i = 0; i < count; i++) {
    const m = await ctx.messages.append(
      sessionId,
      i % 2 === 0 ? "user" : "assistant",
      textBlocks(`消息 ${i}`)
    );
    ids.push(m.id);
    seqs.push(m.seq);
    if (i % 7 === 3) {
      await ctx.messages.hide(m.id);
    }
  }
  return { ids, seqs };
}

describe("fork 上界读口（CD-13）", () => {
  it("T-FORK-UB1 锚点前 3 条：零次 listBySession、一次 listBySessionUpToSeq", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-fork-ub1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const { ids } = await seedSession(session.id, 100);

    const spy = spyReadMouths();
    let forkedId = "";
    try {
      const forked = await ctx.messages.fork(session.id, ids[2]!);
      forkedId = forked.id;
    } finally {
      spy.restore();
    }

    assert.equal(spy.listBySession(), 0, "fork 不得触发全量读口");
    assert.equal(spy.listBySessionUpToSeq(), 1, "fork 必须恰好一次上界读口");
    const forkedMsgs = await ctx.messages.listBySession(forkedId);
    assert.equal(forkedMsgs.length, 3);
  });

  it("T-FORK-UB2 上界读口与 listBySession().filter(seq<=N) 逐条等价（hidden 两侧分布）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-fork-ub2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const { ids } = await seedSession(session.id, 40);

    const anchorId = ids[20]!;
    const anchor = await ctx.messages.get(anchorId);
    const repo = new SqliteMessageRepository(ctx.conn);
    const all = await repo.listBySession(session.id);
    const expected = all.filter((m) => m.seq <= anchor.seq);
    assert.ok(
      expected.filter((m) => m.hidden).length >= 2,
      "夹具须含锚点两侧的 hidden 行",
    );
    assert.ok(
      expected.filter((m) => !m.hidden).length >= 2,
      "夹具须含锚点两侧的可见行",
    );

    const actual = await repo.listBySessionUpToSeq(session.id, anchor.seq);
    assert.deepEqual(actual, expected, "上界读口必须逐条等价");
    // hidden 行逐条保留（若实现误加 `AND hidden = 0`，此处必红）。
    assert.equal(
      actual.filter((m) => m.hidden).length,
      expected.filter((m) => m.hidden).length
    );

    const forked = await ctx.messages.fork(session.id, anchorId);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, expected.length);
    for (const m of forkedMsgs) {
      const src = expected.find((e) => e.seq === m.seq);
      assert.ok(src != null);
      assert.equal(m.hidden, src.hidden, "fork 须逐条保留 hidden 状态");
    }
  });

  it("T-FORK-UB3 空集合守卫仍在事务开之前抛出", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-fork-ub3-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const { ids } = await seedSession(session.id, 5);

    // 锚点 seq 比库里最小 seq 还小 ⇒ 上界读口返回空集合。
    // 用 prototype 桩制造该形态（真实数据里锚点由 findById 定位，构造不出空集合）。
    const proto = SqliteMessageRepository.prototype;
    const orig = proto.listBySessionUpToSeq;
    const origTx = ctx.conn.transaction;
    let txCalls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (proto as any).listBySessionUpToSeq = async () => [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.conn as any).transaction = (...args: never[]) => {
      txCalls += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origTx as any).apply(ctx.conn, args);
    };
    try {
      await assert.rejects(
        () => ctx.messages.fork(session.id, ids[0]!),
        /No messages to fork up to the given id/
      );
      assert.equal(txCalls, 0, "空集合守卫必须发生在开事务之前");
    } finally {
      proto.listBySessionUpToSeq = orig;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx.conn as any).transaction = origTx;
    }
  });

  it("T-FORK-UB4 上界闭区间：锚点是最后一条 ⇒ fork 出全部消息", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-fork-ub4-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const { ids } = await seedSession(session.id, 12);
    const forked = await ctx.messages.fork(session.id, ids[11]!);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 12);
  });

  it("T-FORK-UB5 100 条夹具下让步点 ≥1（证明走 mapRows 分片而非 rows.map 直通）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-fork-ub5-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await seedSession(session.id, 120);

    let yieldCount = 0;
    const repo = new SqliteMessageRepository(ctx.conn, async () => {
      yieldCount += 1;
    });
    const rows = await repo.listBySessionUpToSeq(session.id, 1000);
    assert.equal(rows.length, 120);
    // 120 行 = 3 片（每片 ≤50）⇒ 2 个片间让步点。
    assert.equal(yieldCount, 2, "必须走 mapRows 的分片让步分支");
  });
});