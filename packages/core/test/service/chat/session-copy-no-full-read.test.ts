/**
 * C2-3（CS-11）· `session.copy` 事务内全量读的回归锁：C1 / C2 / C3。
 *
 * 病症原形态：`session.service.ts::copy` 在一条**写事务里**对源会话做 21 列
 * 全量消息读（含 hidden、含正文），随后 `batchInsert` 再逐条 `JSON.stringify`。
 * 大会话上一次复制 = N 次 parse + N 次 stringify 全程独占连接写锁。
 * 同域的 `fork` 早已治过（读在 `conn.transaction` 之外），copy 是漏网的那个。
 *
 * 三条验收（原始条款见 fix-spec/wave-c2.md §C2-3 验收表）：
 *  - **C1 事务内零全量读**：`listBySession` 的调用发生在 `conn.transaction`
 *    回调**之外**；回调内消息相关语句只有 `batchInsert` 的分片 INSERT。
 *  - **C2 与 fork 对称**：copy 与 fork 都是「事务外 list → 事务内写」。
 *  - **C3 复制结果等价**：hidden 行 / attachments / usage / legacy
 *    `content_blob` 压缩行都覆盖，逐字段比对。
 *
 * 观测面纪律（照 truncate-after-readref-targets.test.ts 的既有形态）：
 *  - **调用点位置**用 `SqliteMessageRepository.prototype` 桩 + 「此刻是否在
 *    事务回调窗口内」的标记（RULE 明禁给读路径换实现的观测面）；
 *  - **语句窗口**用 conn 上的 `transaction` 覆写（better-sqlite3 的
 *    BEGIN/COMMIT 不经 `conn.execute` 发出，按 SQL 顺序判事务边界不可行，
 *    只能标记回调窗口本身）。
 *
 * ⚠ C3 对 legacy 压缩行的口径：`content_encoding` / `content_blob` 两列
 * **不做逐字段比对**——写侧 `toMessageParams` 对这两列无条件写 `null`，
 * 所以「压缩源行经 copy 归一为明文行」是明文化拍板的正形态，不是回归。
 *
 * @module test/service/chat/session-copy-no-full-read
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { compressZlib } from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { openSqlCountingNovelMasterTestConnection } from "../../helpers/sql-counting-connection.js";
import { testIsolationSuffix } from "../../helpers/novel-master-fixture.js";
import type { TdbcConnection } from "../../../src/infra/tdbc/ports/connection.port.js";
import type { Row } from "../../../src/infra/tdbc/types.js";

type Ctx = Awaited<ReturnType<typeof openSqlCountingNovelMasterTestConnection>>;

let ctx: Ctx;

before(async () => {
  ctx = await openSqlCountingNovelMasterTestConnection();
});
after(async () => {
  await ctx.conn.close();
});

// ---------------------------------------------------------------------------
// 观测面 1：事务回调窗口标记 + 窗口内外语句清单。
// ---------------------------------------------------------------------------

interface SqlTrace {
  readonly sql: string;
  readonly inTx: boolean;
}

/**
 * 在 `conn` 上装一个「事务回调窗口」探针。
 *
 * `transaction(fn)` 被包装成：进入 `fn(tx)` 前把 `inTx` 置真、并把传进去的
 * `tx` 再包一层记录器，于是事务内发出的每条语句都带 `inTx: true`。
 * 事务外发出的语句经 `conn` 自身的 execute/query/batch 记录，带 `inTx: false`。
 *
 * ⚠ 之所以不用 `SqlCounter` 的 SQL 顺序口径：better-sqlite3 的
 * BEGIN/COMMIT 不经 `conn.execute` 发出，探针记不到事务边界。
 */
function installTxWindowProbe(conn: TdbcConnection): {
  readonly trace: readonly SqlTrace[];
  /** 调用瞬间是否正处在 `conn.transaction` 回调窗口内。 */
  readonly inTx: () => boolean;
  restore: () => void;
} {
  const trace: SqlTrace[] = [];
  let depth = 0;
  const self = conn as unknown as Record<string, unknown>;
  const origExecute = conn.execute.bind(conn);
  const origQuery = conn.query.bind(conn);
  const origBatch = conn.batch.bind(conn);
  const origTransaction = conn.transaction.bind(conn);

  const record = (sql: string): void => {
    trace.push({ sql, inTx: depth > 0 });
  };

  const wrapTx = (tx: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      record(sql);
      return tx.execute(sql, parameters);
    },
    query: <R extends Row = Row>(sql: string, parameters?: readonly unknown[]) => {
      record(sql);
      return tx.query<R>(sql, parameters);
    },
    batch: (sql, parametersList) => {
      record(sql);
      return tx.batch(sql, parametersList);
    },
    transaction: <U>(fn: (nested: TdbcConnection) => Promise<U>) =>
      tx.transaction(fn),
    close: () => tx.close(),
  });

  self.execute = (sql: string, p?: readonly unknown[]) => {
    record(sql);
    return origExecute(sql, p);
  };
  self.query = (sql: string, p?: readonly unknown[]) => {
    record(sql);
    return origQuery(sql, p);
  };
  self.batch = (sql: string, pl: readonly (readonly unknown[])[]) => {
    record(sql);
    return origBatch(sql, pl);
  };
  self.transaction = async <T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> =>
    origTransaction(async (tx) => {
      depth += 1;
      try {
        return await fn(wrapTx(tx));
      } finally {
        depth -= 1;
      }
    });

  return {
    trace,
    inTx: () => depth > 0,
    restore: () => {
      // 这四个方法原本挂在原型上，删掉自有属性即回到原型实现。
      delete self.execute;
      delete self.query;
      delete self.batch;
      delete self.transaction;
    },
  };
}

// ---------------------------------------------------------------------------
// 观测面 2：全量读口调用点 + 调用瞬间的事务窗口状态。
// ---------------------------------------------------------------------------

interface ReadObservation {
  readonly mouth: "listBySession" | "listBySessionUpToSeq";
  readonly inTx: boolean;
}

/** 记录两个 21 列全量读口的调用点，以及调用瞬间是否落在事务回调窗口内。 */
async function withFullReadProbe<T>(
  isInTx: () => boolean,
  fn: () => Promise<T>
): Promise<{ result: T; reads: readonly ReadObservation[] }> {
  const proto = SqliteMessageRepository.prototype;
  const origList = proto.listBySession;
  const origUpTo = proto.listBySessionUpToSeq;
  const reads: ReadObservation[] = [];

  proto.listBySession = function patched(...args: never[]) {
    reads.push({ mouth: "listBySession", inTx: isInTx() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origList as any).apply(this, args);
  } as typeof origList;
  proto.listBySessionUpToSeq = function patched(...args: never[]) {
    reads.push({ mouth: "listBySessionUpToSeq", inTx: isInTx() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origUpTo as any).apply(this, args);
  } as typeof origUpTo;
  try {
    return { result: await fn(), reads };
  } finally {
    proto.listBySession = origList;
    proto.listBySessionUpToSeq = origUpTo;
  }
}

/** 会话 scope 下 21 列全量读的 SQL 特征（含正文三列 + token 列）。 */
function isFullMessageRead(sql: string): boolean {
  const norm = sql.replace(/\s+/g, " ").toUpperCase();
  return (
    norm.includes("FROM CHAT_MESSAGE") &&
    norm.includes("CONTENT_ENCODING") &&
    norm.includes("CACHE_READ_TOKENS")
  );
}

/** 事务窗口内跑一次 fn，同时拿到读口观测与语句清单。 */
async function observe<T>(
  fn: () => Promise<T>
): Promise<{
  result: T;
  reads: readonly ReadObservation[];
  trace: readonly SqlTrace[];
}> {
  const probe = installTxWindowProbe(ctx.conn);
  try {
    const { result, reads } = await withFullReadProbe(probe.inTx, fn);
    return { result, reads, trace: probe.trace };
  } finally {
    probe.restore();
  }
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const MSG_COUNT = 6;

/** 造一条带消息的会话；返回 session id 与最后一条消息 id。 */
async function seedSession(prefix: string): Promise<{
  projectId: string;
  sessionId: string;
  lastMessageId: string;
}> {
  const project = await ctx.projects.create(`P-${prefix}-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
  let lastMessageId = "";
  for (let i = 0; i < MSG_COUNT; i++) {
    const m = await ctx.messages.append(
      session.id,
      i % 2 === 0 ? "user" : "assistant",
      textBlocks(`${prefix}-m${i}`),
    );
    lastMessageId = m.id;
  }
  return { projectId: project.id, sessionId: session.id, lastMessageId };
}

// ---------------------------------------------------------------------------
// C1：事务内零全量读
// ---------------------------------------------------------------------------

describe("C2-3 C1: copy 事务内零全量读", () => {
  it("T-COPY-0 探针自证：事务回调窗口内发起的全量读会被标成 inTx=true", async () => {
    // 对照组：没有它，「copy 的读在事务外」可能只是因为探针窗口压根没开过
    // （即恒真）。这里故意把同一个全量读口放进事务回调里跑一次。
    const { sessionId } = await seedSession("c0");
    const { reads } = await observe(() =>
      ctx.conn.transaction(async (tx) => {
        await new SqliteMessageRepository(tx).listBySession(sessionId);
        return null;
      })
    );
    assert.deepEqual(
      reads,
      [{ mouth: "listBySession", inTx: true }],
      "探针窗口必须真的会在事务内亮起来（否则 C1 是恒真断言）"
    );
  });

  it("T-COPY-1: listBySession 恰一次且发生在事务回调之外", async () => {
    const { sessionId } = await seedSession("c1");
    const { result: copied, reads } = await observe(() =>
      ctx.sessions.copy(sessionId)
    );

    const listReads = reads.filter((r) => r.mouth === "listBySession");
    assert.equal(
      listReads.length,
      1,
      `copy 应恰好做一次全量读，实际 ${JSON.stringify(reads)}`
    );
    assert.equal(
      listReads[0]!.inTx,
      false,
      "listBySession 必须在 conn.transaction 回调之外（旧实现把它整段搬进事务）"
    );
    assert.notEqual(copied.id, sessionId);
  });

  it("T-COPY-2: 事务回调窗口内没有任何 chat_message 全列 SELECT", async () => {
    const { sessionId } = await seedSession("c2");
    const { trace } = await observe(() => ctx.sessions.copy(sessionId));

    const inTxFullReads = trace.filter(
      (t) => t.inTx && isFullMessageRead(t.sql)
    );
    assert.deepEqual(
      inTxFullReads.map((t) => t.sql.slice(0, 120)),
      [],
      "写事务内不得发出 21 列全量消息读（那正是 CS-11 的病灶）"
    );

    // 窗口外必须有——否则本条退化成「压根没读」。
    assert.ok(
      trace.some((t) => !t.inTx && isFullMessageRead(t.sql)),
      "事务外必须真的发出那次全量读（断言不是恒真）"
    );

    // 事务内的消息相关语句只有写入面（batchInsert 的 INSERT / seed 的读口）。
    const inTxChatStatements = trace.filter(
      (t) => t.inTx && /CHAT_MESSAGE/i.test(t.sql)
    );
    assert.ok(inTxChatStatements.length > 0, "事务内必须有消息写入面");
    for (const stmt of inTxChatStatements) {
      const norm = stmt.sql.replace(/\s+/g, " ").toUpperCase();
      assert.ok(
        !norm.includes("CONTENT_ENCODING") || norm.startsWith("INSERT"),
        `事务内不该出现带正文的读：${stmt.sql.slice(0, 120)}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// C2：与 fork 对称
// ---------------------------------------------------------------------------

describe("C2-3 C2: copy 与 fork 的读/写顺序形状一致", () => {
  it("T-COPY-3: copy 与 fork 都是「事务外读一次 → 事务内写」", async () => {
    const copySeed = await seedSession("sym-copy");
    const copyRun = await observe(() => ctx.sessions.copy(copySeed.sessionId));
    const copyReads = copyRun.reads.filter((r) => r.mouth === "listBySession");
    assert.equal(copyReads.length, 1, "copy：全量读恰一次");
    assert.equal(copyReads[0]!.inTx, false, "copy：读在事务外");

    const forkSeed = await seedSession("sym-fork");
    const forkRun = await observe(() =>
      ctx.messages.fork(forkSeed.sessionId, forkSeed.lastMessageId)
    );
    const forkReads = forkRun.reads.filter(
      (r) => r.mouth === "listBySessionUpToSeq"
    );
    assert.equal(forkReads.length, 1, "fork：上界读恰一次");
    assert.equal(forkReads[0]!.inTx, false, "fork：读在事务外");

    // 形状对称：两者都恰好一次全量读、都发生在事务回调之外。
    assert.deepEqual(
      copyReads.map((r) => r.inTx),
      forkReads.map((r) => r.inTx),
      "copy 与 fork 的读位置必须一致（不对称就是漏网的病）"
    );
  });
});

// ---------------------------------------------------------------------------
// C3：复制结果等价
// ---------------------------------------------------------------------------

describe("C2-3 C3: copy 结果等价（含 hidden / attachments / usage / legacy 压缩行）", () => {
  it("T-COPY-4: 三类消息逐字段复制，压缩两列归一为 NULL", async () => {
    const project = await ctx.projects.create(
      `P-c3-${testIsolationSuffix()}`
    );
    const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);

    // ① user + attachments
    await ctx.messages.append(session.id, "user", textBlocks("第一条"), {
      attachments: [
        {
          name: "/notes/a.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/notes/a.md",
        },
      ],
    });
    // ② assistant + usage + provider 三件套 + raw
    await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("第二条"),
      {
        provider: "anthropic",
        providerId: "prov-1",
        modelName: "claude-x",
        raw: { stop_reason: "end_turn" },
        usage: {
          promptTokens: 11,
          completionTokens: 22,
          totalTokens: 33,
        },
      }
    );
    // ③ hidden 行，随后被改造成 legacy zlib 压缩形态（明文化前的存量行）。
    const m3 = await ctx.messages.append(session.id, "user", textBlocks("第三条"));
    await ctx.conn.execute(
      `UPDATE chat_message SET hidden = 1 WHERE id = ?`,
      [m3.id]
    );
    await ctx.conn.execute(
      `UPDATE chat_message
          SET content_json = '', content_encoding = 'zlib', content_blob = ?
        WHERE id = ?`,
      [
        compressZlib(
          new TextEncoder().encode(JSON.stringify(textBlocks("第三条")))
        ),
        m3.id,
      ]
    );

    // 前置自证：源行确为压缩形态。
    const legacyRow = await ctx.conn.query<{
      content_encoding: string | null;
      hidden: number;
    }>(
      `SELECT content_encoding, hidden FROM chat_message WHERE id = ?`,
      [m3.id]
    );
    assert.equal(legacyRow[0]!.content_encoding, "zlib", "前置：源行是压缩形态");
    assert.equal(Number(legacyRow[0]!.hidden), 1, "前置：源行是 hidden 行");

    const copied = await ctx.sessions.copy(session.id);
    const source = await ctx.messages.listBySession(session.id);
    const target = await ctx.messages.listBySession(copied.id);
    assert.equal(target.length, 3, "三条一条不少");

    // 逐字段对拍：id / sessionId 换新，其余必须一致。
    for (let i = 0; i < source.length; i++) {
      const s = source[i]!;
      const t = target[i]!;
      const label = `seq=${s.seq}`;
      assert.notEqual(t.id, s.id, `${label}: id 必须是新 UUID`);
      assert.notEqual(t.sessionId, s.sessionId, `${label}: sessionId 必须换新`);
      assert.equal(t.sessionId, copied.id, `${label}: 落到目标会话`);
      assert.equal(t.seq, s.seq, `${label}: seq 一致`);
      assert.equal(t.role, s.role, `${label}: role 一致`);
      assert.equal(t.hidden, s.hidden, `${label}: hidden 一致（含 hidden 行）`);
      assert.equal(t.provider, s.provider, `${label}: provider 一致`);
      assert.equal(t.providerId, s.providerId, `${label}: providerId 一致`);
      assert.equal(t.modelName, s.modelName, `${label}: modelName 一致`);
      assert.deepEqual(t.raw, s.raw, `${label}: raw 一致`);
      assert.deepEqual(t.attachments, s.attachments, `${label}: attachments 一致`);
      assert.deepEqual(t.usage, s.usage, `${label}: usage 一致`);
      // legacy 压缩源行经 copy 归一为明文行：正文必须可读且逐字段相等。
      assert.deepEqual(t.content, s.content, `${label}: content 一致`);
    }

    // hidden 逐条复核（deepEqual 之上再钉一次布尔列）。
    assert.equal(target.find((m) => m.seq === 3)!.hidden, true);
    assert.equal(target.find((m) => m.seq === 1)!.hidden, false);

    // 压缩两列：明文化正形态——副本行两列恒 NULL、正文落 content_json。
    const copyRows = await ctx.conn.query<{
      content_json: string;
      content_encoding: string | null;
      content_blob: Uint8Array | null;
    }>(
      `SELECT content_json, content_encoding, content_blob
         FROM chat_message WHERE session_id = ? ORDER BY seq ASC`,
      [copied.id]
    );
    assert.equal(copyRows.length, 3);
    for (const row of copyRows) {
      assert.equal(row.content_encoding, null, "副本行 content_encoding 恒 NULL");
      assert.equal(row.content_blob, null, "副本行 content_blob 恒 NULL");
      assert.ok(row.content_json.length > 0, "副本行正文落明文列");
    }
    // legacy 那条的明文正文与源行一致。
    assert.deepEqual(
      JSON.parse(copyRows[2]!.content_json),
      textBlocks("第三条"),
      "压缩源行归一出的明文正文与源一致"
    );

    // 源行未被就地改写（copy 不得动源会话）。
    const sourceRows = await ctx.conn.query<{ content_encoding: string | null }>(
      `SELECT content_encoding FROM chat_message WHERE id = ?`,
      [m3.id]
    );
    assert.equal(sourceRows[0]!.content_encoding, "zlib", "源压缩行保持原状");
  });

  it("T-COPY-5: 空会话 copy 不抛，且不产生任何 chat_message 读", async () => {
    const project = await ctx.projects.create(`P-c3b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const { result: copied, reads, trace } = await observe(() =>
      ctx.sessions.copy(session.id)
    );
    assert.ok(copied.id.length > 0);
    assert.deepEqual(
      reads.filter((r) => r.mouth === "listBySession"),
      [{ mouth: "listBySession", inTx: false }],
      "空会话也走一次事务外读（不得跳过读口直接开事务）"
    );
    assert.deepEqual(
      trace.filter((t) => t.inTx && isFullMessageRead(t.sql)),
      []
    );
    assert.deepEqual(await ctx.messages.listBySession(copied.id), []);
  });
});