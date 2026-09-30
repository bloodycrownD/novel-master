/**
 * backfill 弃权信号（r3-run-4 步骤 2：[改 core 签名]）。
 *
 * 覆盖三件事：
 * 1. **纯逻辑单测（mock 仓储）**：`backfillBaselineCheckpoints` 的两个扫描
 *    循环（倒扫 hasCheckpoint / 正插 insertCheckpoint）在 signal 翻真后
 *    **有限步退出**，且退出时 `confirmedNoGap` 恒为 false——中断态绝不能被
 *    当成「确认无空窗」，否则调用方把游标写到 count，下一轮短路成「已确认」，
 *    剩下的空窗永远补不上。
 * 2. **service 级（真实 sqlite）**：中断时游标**不写**；下一轮不带 signal 的
 *    backfill 仍能把剩余空窗补齐（中途退出的幂等可恢复性）。
 * 3. **不传 signal 时行为与旧版逐字节等价**（对不传 signal 的调用方零影响）。
 *
 * @module test/message-checkpoint/backfill-abort-signal.test
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { backfillBaselineCheckpoints } from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import {
  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 造 N 条只有 id / seq / role 的头投影（backfill 只要 id 与顺序）。 */
function headerMessages(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    seq: i,
    role: "user",
    hidden: false,
    content: { blocks: [] },
  })) as unknown as ChatMessage[];
}

/**
 * 内存 harness：两个扫描循环的每一步都可观测（调用次数），signal 可在第 N 步
 * 翻真——这样「有限步退出」是**数出来的**，不是推断的。
 */
function makeScanHarness(args: {
  readonly messageCount: number;
  /** 倒扫到第几次 hasCheckpoint 之后翻真；null = 不翻。 */
  readonly abortAfterHasCheckpointCalls?: number | null;
  /** 插到第几条之后翻真；null = 不翻。 */
  readonly abortAfterInserts?: number | null;
  /** hasCheckpoint 一律返回 false（= 全部消息都是空窗）。 */
  readonly anyCheckpoint?: boolean;
}) {
  const controller = new AbortController();
  let hasCalls = 0;
  let insertCalls = 0;
  const hasCheckpoint = mock.fn(async (): Promise<boolean> => {
    hasCalls += 1;
    if (
      args.abortAfterHasCheckpointCalls != null &&
      hasCalls >= args.abortAfterHasCheckpointCalls
    ) {
      controller.abort();
    }
    return args.anyCheckpoint === true;
  });
  const insertCheckpoint = mock.fn(async (): Promise<void> => {
    insertCalls += 1;
    if (args.abortAfterInserts != null && insertCalls >= args.abortAfterInserts) {
      controller.abort();
    }
  });

  const entryRepo = {
    listFileHeadsUnderPrefix: async () => [
      { entryId: "e1", path: "/a.md", headVersion: 1 },
    ],
  } as unknown as VfsEntryRepository;
  const messageRepo = {
    listMessageHeadersBySession: async () => headerMessages(args.messageCount),
  } as unknown as MessageRepository;
  const checkpointRepo = {
    hasCheckpoint,
    insertCheckpoint,
  } as unknown as MessageCheckpointRepository;

  return {
    signal: controller.signal,
    hasCalls: () => hasCalls,
    insertCalls: () => insertCalls,
    run: () =>
      backfillBaselineCheckpoints(
        entryRepo,
        messageRepo,
        checkpointRepo,
        "p1",
        "s1",
        controller.signal
      ),
  };
}

describe("backfillBaselineCheckpoints 弃权信号（r3-run-4 步骤 2）", () => {
  it("入场即 aborted：两个循环都不跑（0 次 hasCheckpoint / 0 次 insert）", async () => {
    // 模拟「进 backfill 前用户已经按了停止」：signal 一进场就是 aborted。
    const hasCheckpoint = mock.fn(async (): Promise<boolean> => false);
    const insertCheckpoint = mock.fn(async (): Promise<void> => undefined);
    const result = await backfillBaselineCheckpoints(
      {
        listFileHeadsUnderPrefix: async () => [
          { entryId: "e1", path: "/a.md", headVersion: 1 },
        ],
      } as unknown as VfsEntryRepository,
      {
        listMessageHeadersBySession: async () => headerMessages(50),
      } as unknown as MessageRepository,
      { hasCheckpoint, insertCheckpoint } as unknown as MessageCheckpointRepository,
      "p1",
      "s1",
      AbortSignal.abort()
    );
    assert.equal(
      (hasCheckpoint as ReturnType<typeof mock.fn>).mock.callCount(),
      0,
      "已 aborted 的 signal 必须让倒扫一步都不走"
    );
    assert.equal(
      (insertCheckpoint as ReturnType<typeof mock.fn>).mock.callCount(),
      0,
      "已 aborted 的 signal 必须让插入一步都不走"
    );
    assert.equal(
      result.confirmedNoGap,
      false,
      "中断态必须报「未确认」——报 true 会让调用方把游标写到 count，下轮短路成「已确认」，剩余空窗永远补不上"
    );
  });

  it("倒扫中 abort：hasCheckpoint 只跑 N 步就退出（50 条消息只查 3 次）", async () => {
    const h = makeScanHarness({
      messageCount: 50,
      abortAfterHasCheckpointCalls: 3,
    });
    const result = await h.run();
    assert.equal(
      h.hasCalls(),
      3,
      "倒扫必须在 signal 翻真后的第一次迭代就退出——50 条消息只查 3 次就是「有限步」"
    );
    assert.equal(h.insertCalls(), 0, "倒扫阶段就退出，不该开始插 checkpoint");
    assert.equal(
      result.confirmedNoGap,
      false,
      "中断态不得被当成「确认无空窗」（否则游标前移 → 剩余空窗永远补不上）"
    );
  });

  it("倒扫跑完才 abort：仍然不插任何 checkpoint（空窗段之前就被拦下）", async () => {
    // 倒扫在最后一条（i=0）之后才翻真：firstGapIndex=0 已定，但插循环第一轮
    // 迭代就会撞弃权点 → 一条都不插。这是「有限步」的下界形态。
    const h = makeScanHarness({
      messageCount: 4,
      abortAfterHasCheckpointCalls: 4,
    });
    const result = await h.run();
    assert.equal(h.hasCalls(), 4, "4 条消息倒扫 4 步后翻真");
    assert.equal(
      h.insertCalls(),
      0,
      "插循环的第一次迭代就是弃权点，一条都不插"
    );
    assert.equal(result.confirmedNoGap, false);
  });

  it("插入中 abort：已写的部分留下、剩下的不写，仍报「未确认」", async () => {
    const h = makeScanHarness({
      messageCount: 10,
      abortAfterInserts: 3,
    });
    const result = await h.run();
    assert.equal(
      h.insertCalls(),
      3,
      "插到第 3 条翻真 → 有限步退出（不是把 10 条全插完才停）"
    );
    assert.equal(
      result.confirmedNoGap,
      false,
      "部分插入绝不能被当成「确认无空窗」"
    );
  });

  it("不传 signal：行为与旧版逐字节等价（全量跑完 + confirmedNoGap=true）", async () => {
    const hasCheckpoint = mock.fn(async (): Promise<boolean> => false);
    const insertCheckpoint = mock.fn(async (): Promise<void> => undefined);
    const result = await backfillBaselineCheckpoints(
      {
        listFileHeadsUnderPrefix: async () => [
          { entryId: "e1", path: "/a.md", headVersion: 1 },
        ],
      } as unknown as VfsEntryRepository,
      {
        listMessageHeadersBySession: async () => headerMessages(6),
      } as unknown as MessageRepository,
      { hasCheckpoint, insertCheckpoint } as unknown as MessageCheckpointRepository,
      "p1",
      "s1"
    );
    assert.equal(result.confirmedNoGap, true, "不传 signal 必须照旧全量完成");
    assert.equal(
      (hasCheckpoint as ReturnType<typeof mock.fn>).mock.callCount(),
      6,
      "倒扫不传 signal 时逐条跑完"
    );
    assert.equal(
      (insertCheckpoint as ReturnType<typeof mock.fn>).mock.callCount(),
      6,
      "空窗段 6 条全部补建"
    );
  });
});

describe("backfillMissingBaselines(service) 弃权信号", () => {
  /** 读取当前游标值（null = 未写入）。 */
  async function readCursor(sessionId: string): Promise<string | null> {
    const ctx = getNovelMasterTestContext();
    return ctx.sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
      BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY
    );
  }

  async function hasCheckpoint(
    sessionId: string,
    messageId: string
  ): Promise<boolean> {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    return repo.hasCheckpoint(sessionId, messageId);
  }

  it("T-BACKFILL-ABORT-SVC: 中断时不写游标；下一轮不带 signal 补齐剩余空窗", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-bfa-${testIsolationSuffix()}`
    );
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/a.md", "v1", { versionCheck: false });

    const msgs = [];
    for (const text of ["1", "2", "3", "4"]) {
      msgs.push(await ctx.messages.append(session.id, "user", textBlocks(text)));
    }

    // 第一轮：已 aborted 的 signal 进场 → 立即弃权。
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id,
      AbortSignal.abort()
    );
    assert.equal(
      await readCursor(session.id),
      null,
      "中断态不得写游标：写了就会把「没补完」误判成「已确认无空窗」"
    );
    assert.equal(
      await hasCheckpoint(session.id, msgs[0]!.id),
      false,
      "入场即弃权时不该插任何 checkpoint"
    );

    // 第二轮：正常 backfill（不传 signal）→ 幂等补齐全部 4 条 + 游标落库。
    await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id);
    for (const m of msgs) {
      assert.ok(
        await hasCheckpoint(session.id, m.id),
        `中断那一轮没补的 ${m.id} 必须由下一轮补齐（幂等可恢复）`
      );
    }
    assert.equal(await readCursor(session.id), "4", "跑完才写游标");
  });
});
