/**
 * backfill 两段式「无空窗」短路判定 + 扫描游标（init-busy-yield Step 4）。
 *
 * - decideBackfillShortCircuit 决策单测（mock 仓储，断言短路不发全量扫描查询）；
 * - service 级集成（真实 sqlite）：游标短路 / 回退补写 / truncate 清游标 /
 *   连续对话第二轮两段式正反场景 / 删除路径回退全量。
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  decideBackfillShortCircuit,
  type BackfillShortCircuitDecision,
} from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { SessionKkvRepository } from "@/domain/session-kkv/repositories/session-kkv.port.js";
import type { SessionKkvEntry } from "@/domain/session-kkv/model/session-kkv-entry.js";
import {
  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** ---------------------------------------------------------------------------
 * decide 决策单测（mock 仓储）：验证判定矩阵与「短路不发全量扫描查询」。
 * --------------------------------------------------------------------------- */

interface DecideHarness {
  readonly sessionKkv: SessionKkvRepository;
  readonly messageRepo: MessageRepository;
  readonly checkpointRepo: MessageCheckpointRepository;
}

/** 内存 mock：count / 圈段结果 / 段内计数 / hasAny / 游标值均可注入。 */
function makeDecideHarness(options: {
  readonly cursorValue: string | null;
  readonly count: number;
  readonly segment?: ReadonlyArray<{ readonly id: string }>;
  readonly segmentCheckpointCount?: number;
  readonly hasAny?: boolean;
}): DecideHarness {
  const get = mock.fn(
    async (
      sessionId: string,
      domain: string,
      key: string
    ): Promise<SessionKkvEntry | null> =>
      options.cursorValue == null
        ? null
        : { sessionId, domain, key, value: options.cursorValue }
  );
  const sessionKkv = {
    get,
    set: mock.fn(async () => undefined),
    delete: mock.fn(async () => true),
    clearDomain: mock.fn(async () => undefined),
    clearSession: mock.fn(async () => undefined),
    listKeys: mock.fn(async () => [] as string[]),
  } as unknown as SessionKkvRepository;

  const listBySession = mock.fn(
    async (): Promise<ChatMessage[]> => [] as ChatMessage[]
  );
  const countBySession = mock.fn(async () => options.count);
  const listBySessionOffset = mock.fn(
    async (): Promise<ChatMessage[]> =>
      (options.segment ?? []).map(
        (m) => ({ ...m, role: "user" }) as ChatMessage
      )
  );
  const messageRepo = {
    listBySession,
    countBySession,
    listBySessionOffset,
  } as unknown as MessageRepository;

  const hasAnyCheckpointForSession = mock.fn(
    async (): Promise<boolean> => options.hasAny ?? true
  );
  const countCheckpointsForMessages = mock.fn(
    async (): Promise<number> => options.segmentCheckpointCount ?? 0
  );
  const checkpointRepo = {
    hasAnyCheckpointForSession,
    countCheckpointsForMessages,
  } as unknown as MessageCheckpointRepository;

  return { sessionKkv, messageRepo, checkpointRepo };
}

async function decide(h: DecideHarness): Promise<BackfillShortCircuitDecision> {
  return decideBackfillShortCircuit({
    sessionKkv: h.sessionKkv,
    messageRepo: h.messageRepo,
    checkpointRepo: h.checkpointRepo,
    sessionId: "s-decide",
  });
}

describe("decideBackfillShortCircuit（决策矩阵）", () => {
  it("游标缺失（未扫过/矛盾态）→ 回退全量", async () => {
    const h = makeDecideHarness({ cursorValue: null, count: 3 });
    const d = await decide(h);
    assert.equal(d.kind, "full-scan");
    assert.equal(d.kind === "full-scan" ? d.count : -1, 3);
    // 全量前不做圈段查询。
    assert.equal(
      (h.messageRepo.listBySessionOffset as ReturnType<typeof mock.fn>)
        .mock.callCount(),
      0
    );
  });

  it("count == 游标 → 第一段 O(1) 短路，不发圈段/全量查询", async () => {
    const h = makeDecideHarness({ cursorValue: "3", count: 3 });
    const d = await decide(h);
    assert.deepEqual(
      d.kind === "short-circuit"
        ? { newCursor: d.newCursor, previousCursor: d.previousCursor }
        : null,
      { newCursor: 3, previousCursor: 3 }
    );
    // 矛盾检测只发一条 LIMIT 1 的 hasAny；圈段与全量 listBySession 均不发。
    assert.equal(
      (h.messageRepo.listBySession as ReturnType<typeof mock.fn>).mock
        .callCount(),
      0,
      "短路时不得发全量 listBySession"
    );
    assert.equal(
      (h.messageRepo.listBySessionOffset as ReturnType<typeof mock.fn>).mock
        .callCount(),
      0
    );
  });

  it("count > 游标且新增段全覆盖 → 短路且游标前移至 count", async () => {
    const h = makeDecideHarness({
      cursorValue: "2",
      count: 4,
      segment: [{ id: "m3" }, { id: "m4" }],
      segmentCheckpointCount: 2,
    });
    const d = await decide(h);
    assert.deepEqual(
      d.kind === "short-circuit"
        ? { newCursor: d.newCursor, previousCursor: d.previousCursor }
        : null,
      { newCursor: 4, previousCursor: 2 }
    );
    // 圈段按游标行偏移取新增段，且不发全量 listBySession。
    assert.equal(
      (h.messageRepo.listBySessionOffset as ReturnType<typeof mock.fn>).mock
        .callCount(),
      1
    );
    assert.deepEqual(
      (h.messageRepo.listBySessionOffset as ReturnType<typeof mock.fn>).mock
        .calls[0]!.arguments[1],
      2
    );
    assert.equal(
      (h.messageRepo.listBySession as ReturnType<typeof mock.fn>).mock
        .callCount(),
      0,
      "圈段短路时不得发全量 listBySession"
    );
  });

  it("count > 游标但新增段有缺口（尾部 assistant 无点）→ 回退全量", async () => {
    const h = makeDecideHarness({
      cursorValue: "2",
      count: 4,
      segment: [{ id: "m3" }, { id: "m4" }],
      segmentCheckpointCount: 1,
    });
    const d = await decide(h);
    assert.equal(d.kind, "full-scan");
  });

  it("count < 游标（删除可疑态）→ 回退全量，不做圈段比对", async () => {
    const h = makeDecideHarness({ cursorValue: "5", count: 3 });
    const d = await decide(h);
    assert.equal(d.kind, "full-scan");
    assert.equal(
      (h.messageRepo.listBySessionOffset as ReturnType<typeof mock.fn>).mock
        .callCount(),
      0
    );
  });

  it("游标 > 0 但会话无任何 checkpoint（矛盾）→ 回退全量", async () => {
    const h = makeDecideHarness({
      cursorValue: "3",
      count: 3,
      hasAny: false,
    });
    const d = await decide(h);
    assert.equal(d.kind, "full-scan");
  });

  it("游标值为脏数据（非数字）→ 视为不可信回退全量", async () => {
    const h = makeDecideHarness({ cursorValue: "not-a-number", count: 3 });
    const d = await decide(h);
    assert.equal(d.kind, "full-scan");
  });

  it("游标 = 0 且 count = 0（空会话）→ 短路，且不做 hasAny 矛盾检测", async () => {
    const h = makeDecideHarness({ cursorValue: "0", count: 0, hasAny: false });
    const d = await decide(h);
    assert.equal(d.kind, "short-circuit");
    assert.equal(
      (h.checkpointRepo.hasAnyCheckpointForSession as ReturnType<
        typeof mock.fn
      >).mock.callCount(),
      0,
      "游标为 0（上次确认时是空会话）时 hasAny=false 不算矛盾"
    );
  });
});

/** ---------------------------------------------------------------------------
 * service 级集成（真实 sqlite）：游标短路 / 回退补写 / 清空面 / 正反场景。
 * --------------------------------------------------------------------------- */

/** 读取当前游标值（null = 未写入）。SessionKkvService.get 直接返回 value 字符串。 */
async function readCursor(sessionId: string): Promise<string | null> {
  const ctx = getNovelMasterTestContext();
  return ctx.sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
    BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY
  );
}

/** 在 prototype 上包一层计数 spy（透传原实现），返回调用计数与还原函数。 */
function spyListBySession(): {
  readonly callCount: () => number;
  readonly restore: () => void;
} {
  const holder = SqliteMessageRepository.prototype as unknown as {
    listBySession: (this: unknown, sessionId: string) => Promise<ChatMessage[]>;
  };
  const original = holder.listBySession;
  let calls = 0;
  holder.listBySession = function (this: unknown, sessionId: string) {
    calls += 1;
    return original.call(this, sessionId);
  };
  return {
    callCount: () => calls,
    restore: () => {
      holder.listBySession = original;
    },
  };
}

async function hasCheckpoint(
  sessionId: string,
  messageId: string
): Promise<boolean> {
  const ctx = getNovelMasterTestContext();
  const repo = new SqliteMessageCheckpointRepository(ctx.conn);
  return repo.hasCheckpoint(sessionId, messageId);
}

describe("backfillMissingBaselines 游标短路（T-B1/B2/B3/B5/B6）", () => {
  it("T-B1: 已扫会话再 backfill 为 no-op，不发全量扫描查询", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-b1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });
    // 首轮：游标缺失 → 全量补建 + 游标落库。
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.equal(await readCursor(session.id), "2");

    // 第二轮（= 下一轮 run 开头）：count == 游标 → 短路，不发全量扫描。
    const spy = spyListBySession();
    try {
      await ctx.messageCheckpoint.backfillMissingBaselines(
        session.id,
        project.id
      );
    } finally {
      spy.restore();
    }
    assert.equal(spy.callCount(), 0, "游标短路不得发全量 listBySession");
    assert.equal(await readCursor(session.id), "2");
  });

  it("T-B2: 游标缺失时回退全量扫描并补写游标", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-b2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "2" }],
    });

    assert.equal(await readCursor(session.id), null, "未扫过时无游标");
    const spy = spyListBySession();
    try {
      await ctx.messageCheckpoint.backfillMissingBaselines(
        session.id,
        project.id
      );
    } finally {
      spy.restore();
    }
    assert.equal(spy.callCount(), 1, "游标缺失必须回退全量扫描");
    assert.ok(await hasCheckpoint(session.id, m1.id));
    assert.ok(await hasCheckpoint(session.id, m2.id));
    assert.equal(await readCursor(session.id), "2", "全量跑完后补写游标");
  });

  it("T-B3: truncate 回滚删尾后游标被清，新消息复用 seq 仍被下次 backfill 覆盖", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-b3-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "2" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("3"));
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.equal(await readCursor(session.id), "3");

    // undo_send 主路径（truncate-tail）：回滚到 m1 发送前，m1 自身也会被删。
    await ctx.sessionFs.rollbackToMessage(session.id, project.id, m1.id);
    assert.equal(await readCursor(session.id), null, "发生删除即清游标");

    // 清尾后新消息复用被删的 seq（nextSeq = MAX(seq)+1，tail 已删则从头计）。
    const m4 = await ctx.messages.append(session.id, "user", textBlocks("4"));
    assert.equal(m4.seq, m1.seq, "truncate 后新消息复用被删消息的 seq");

    // 下次 backfill：游标缺失 → 回退全量 → 复用 seq 的新消息被补建 + 游标补写。
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.ok(
      await hasCheckpoint(session.id, m4.id),
      "复用 seq 的新消息必须被全量补建覆盖"
    );
    assert.equal(await readCursor(session.id), "1");
  });

  it("T-B5 正向: 连续对话第二轮两段式短路（新增段源头已建点，共 2 条）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-b5a-${testIsolationSuffix()}`
    );
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "2" }],
    });
    // 上一轮产出形态：user + assistant 均有源头建点。
    await ctx.messageCheckpoint.capture(session.id, project.id, m1.id);
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.equal(await readCursor(session.id), "2");

    // 追加新一轮「源头已建点」的两条（发送链 user capture + mutating 工具轮
    // assistant capture 的形态）。
    const m3 = await ctx.messages.append(session.id, "user", textBlocks("3"));
    const m4 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "4" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, m3.id);
    await ctx.messageCheckpoint.capture(session.id, project.id, m4.id);

    // 第二次 run 开头 backfill：count=4 > 游标=2 → 圈段 [m3, m4] 覆盖比对通过
    // → 短路 no-op、不回退全量、游标前移至 4。
    const spy = spyListBySession();
    try {
      await ctx.messageCheckpoint.backfillMissingBaselines(
        session.id,
        project.id
      );
    } finally {
      spy.restore();
    }
    assert.equal(spy.callCount(), 0, "两段式短路不得回退全量扫描");
    assert.equal(await readCursor(session.id), "4", "游标前移至新 count");
  });

  it("T-B5 反向: 纯文本轮尾部 assistant 无点 → 比对失败 → 回退补建 + 游标补写", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-b5b-${testIsolationSuffix()}`
    );
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messageCheckpoint.capture(session.id, project.id, m1.id);
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.equal(await readCursor(session.id), "1");

    // 追加一轮纯文本：user 有源头建点、尾部 assistant 无点（真实空窗）。
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("2"));
    const m3 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "3" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    assert.equal(
      await hasCheckpoint(session.id, m3.id),
      false,
      "前置：尾部 assistant 尚无 checkpoint"
    );

    const spy = spyListBySession();
    try {
      await ctx.messageCheckpoint.backfillMissingBaselines(
        session.id,
        project.id
      );
    } finally {
      spy.restore();
    }
    assert.equal(spy.callCount(), 1, "覆盖比对失败必须回退全量扫描");
    assert.ok(
      await hasCheckpoint(session.id, m3.id),
      "真实空窗必须被补建"
    );
    assert.equal(await readCursor(session.id), "3", "游标补写至新 count");
  });

  it("T-B6 之一: 中间删除后新增无点消息 → 回退全量补建 + 游标补写", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-b6a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "2" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("3"));
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.equal(await readCursor(session.id), "3");

    // 中间删除（tool-turn-actions 的形态：删 tool-result user + assistant 对）。
    await ctx.messages.delete(m2.id);
    assert.equal(await readCursor(session.id), null, "发生删除即清游标");

    // 新增无 checkpoint 消息后下次 run：游标缺失 → 全量补建 + 游标补写。
    const m4 = await ctx.messages.append(session.id, "user", textBlocks("4"));
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.ok(await hasCheckpoint(session.id, m4.id));
    assert.equal(await readCursor(session.id), "3", "游标补写至删除后的 count");
  });

  it("T-B6 之二: 清空会话（truncateAfter anchor=null）重聊 → 首轮回退全量", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-b6b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "v1", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messageCheckpoint.capture(session.id, project.id, m1.id);
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.equal(await readCursor(session.id), "1");

    // 清空整会话（anchor=null 分支）。
    await ctx.messages.truncateAfter(session.id, null);
    assert.equal(
      (await ctx.messages.listBySession(session.id)).length,
      0
    );
    assert.equal(await readCursor(session.id), null, "清空分支必须清游标");

    // 重聊首轮：游标缺失 → 回退全量补建 + 游标补写。
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messageCheckpoint.backfillMissingBaselines(
      session.id,
      project.id
    );
    assert.ok(await hasCheckpoint(session.id, m2.id));
    assert.equal(await readCursor(session.id), "1");
  });
});
