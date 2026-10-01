/**
 * C1-2：`truncateAfter(null 锚)`（清空整会话）窄投影读口 + 移进事务。
 *
 * 观测面纪律：
 * - 全量读归零用 **repository prototype spy**（不是「service 内部调了哪个方法」）；
 * - 列数收窄用 `SqlCounter` 记真实 SQL 文本；
 * - 「读在写事务内」用 **SQL 顺序**（SELECT FROM chat_message 出现在 BEGIN 之后、
 *   DELETE FROM chat_message 之前）——**不做并发注入**：单连接写事务内构造不出
 *   真正的并发窗口，同连接注入只会稳定复现「被删但 checkpoint 留着」这条被禁止的坏状态。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  openSqlCountingNovelMasterTestConnection,
  type SqlCounter,
} from "../helpers/sql-counting-connection.js";
import { testIsolationSuffix } from "../helpers/novel-master-fixture.js";

type Ctx = Awaited<ReturnType<typeof openSqlCountingNovelMasterTestConnection>>;

let ctx: Ctx;
let counter: SqlCounter;

before(async () => {
  ctx = await openSqlCountingNovelMasterTestConnection();
  counter = ctx.counter;
});
after(async () => {
  await ctx.conn.close();
});

function spyReadMouths(): {
  restore: () => void;
  listBySession: () => number;
  listReadRefTargetsBySession: () => number;
} {
  const proto = SqliteMessageRepository.prototype;
  const origList = proto.listBySession;
  const origTargets = proto.listReadRefTargetsBySession;
  let listCalls = 0;
  let targetCalls = 0;
  proto.listBySession = function patched(...args: never[]) {
    listCalls += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origList as any).apply(this, args);
  } as typeof origList;
  proto.listReadRefTargetsBySession = function patched(...args: never[]) {
    targetCalls += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origTargets as any).apply(this, args);
  } as typeof origTargets;
  return {
    restore: () => {
      proto.listBySession = origList;
      proto.listReadRefTargetsBySession = origTargets;
    },
    listBySession: () => listCalls,
    listReadRefTargetsBySession: () => targetCalls,
  };
}

/** 造一条带 read 引用（contentRef）的 tool_result 消息（走单源 block 构造）。 */
async function seedReadRefMessage(
  sessionId: string,
  path: string,
  entryId: number,
  version: number,
  contentHash: string,
  totalBytes: number
): Promise<string> {
  const { buildToolResultBlock } = await import(
    "../../src/domain/tool/logic/build-tool-result-block.js"
  );
  const block = buildToolResultBlock(
    `tu-${testIsolationSuffix()}`,
    {
      ok: true,
      output: {
        path,
        entryId,
        version,
        contentHash,
        totalBytes,
        offset: 1,
        returnedLines: 1,
        totalLines: 1,
        truncated: false,
      },
    },
    { toolName: "read" },
  );
  assert.ok(
    block.contentRef != null,
    "read 输出必须产出 contentRef（否则本用例没测到 read 引用）",
  );
  const tr = await ctx.messages.append(sessionId, "user", { blocks: [block] });
  return tr.id;
}

function textFields(text: string): {
  blocks: { type: "text"; text: string }[];
} {
  return { blocks: [{ type: "text", text }] };
}

/** 造一个带 revision 的 vfs 文件，返回 (entryId, version)。 */
async function seedRevision(
  c: Ctx,
  projectId: string,
  sessionId: string,
  path: string,
  body: string
): Promise<{ entryId: number; version: number; contentHash: string }> {
  const written = await c
    .sessionVfs(projectId, sessionId)
    .write(path, body, { versionCheck: false });
  const { SqliteVfsEntryRepository } = await import(
    "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js"
  );
  const { scopeKey } = await import(
    "../../src/domain/vfs/logic/vfs-path-mapper.js"
  );
  const entries = new SqliteVfsEntryRepository(c.conn);
  const sk = scopeKey({ kind: "session", projectId, sessionId });
  const entry = await entries.findByPath(sk, path);
  assert.ok(entry != null);
  const contentHash = await entries.findContentHash(sk, path);
  assert.ok(contentHash != null && contentHash !== "");
  return {
    entryId: entry.entryId,
    version: written.version,
    contentHash,
  };
}

describe("truncateAfter(空锚) 窄投影读口", () => {
  it("T-TRUNC-RT1 清空整会话：零次 listBySession、查询只取 4 列", async () => {
    const project = await ctx.projects.create(`P-tr1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    for (let i = 0; i < 30; i++) {
      await ctx.messages.append(session.id, "user", textFields(`m${i}`));
    }

    const spy = spyReadMouths();
    counter.clear();
    try {
      await ctx.messages.truncateAfter(session.id, null);
    } finally {
      spy.restore();
    }

    assert.equal(spy.listBySession(), 0, "不得触发 21 列全量读口");
    assert.equal(spy.listReadRefTargetsBySession(), 1);

    const selects = counter
      .all()
      .filter((r) => r.sql.includes("FROM chat_message") && r.kind === "SELECT");
    assert.equal(selects.length, 1);
    const sql = selects[0]!.sql;
    // 必须仍在 SELECT 列表内（collectReadRefs 需要完整 MessageContent）。
    assert.ok(sql.includes("content_json"), "content_json 必须在 SELECT 列表内");
    assert.ok(sql.includes("content_encoding"), "content_encoding 必须在");
    assert.ok(sql.includes("content_blob"), "content_blob 必须在");
    // 重列不得出现。
    for (const heavy of [
      "raw_json",
      "attachments_json",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cache_read_tokens",
      "cache_creation_tokens",
      "first_token_ms",
      "duration_ms",
    ]) {
      assert.equal(sql.includes(heavy), false, `${heavy} 不得出现在窄投影里`);
    }
  });

  it("T-TRUNC-RT2 read 引用逐条 −1，坏行隔离不影响其它行", async () => {
    const project = await ctx.projects.create(`P-tr2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const a = await seedRevision(ctx, project.id, session.id, "/a.md", "AAA");
    const b = await seedRevision(ctx, project.id, session.id, "/b.md", "BBB");
    await seedReadRefMessage(
      session.id,
      "/a.md",
      a.entryId,
      a.version,
      a.contentHash,
      3,
    );
    await seedReadRefMessage(
      session.id,
      "/b.md",
      b.entryId,
      b.version,
      b.contentHash,
      3,
    );
    // 坏行：content_json 非法 JSON（绕开 service 的 append 校验，直接改库）。
    const badId = `msg-bad-${testIsolationSuffix()}`;
    await ctx.conn.execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, content_encoding, content_blob, created_at_ms, hidden) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0)`,
      [badId, session.id, 900, "user", "{not-json", Date.now()],
    );

    // 直接读 vfs_revision.ref_count 行做对账（不用 adjustReadRefCount 的调用计数
// 当对账——那对「多减/漏减」没有牙齿）。
const refCountOf = async (
  entryId: number,
  version: number
): Promise<number | null> => {
  const rows = await ctx.conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version],
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
};

const beforeA = await refCountOf(a.entryId, a.version);
const beforeB = await refCountOf(b.entryId, b.version);
assert.ok(beforeA != null && beforeB != null);

await ctx.messages.truncateAfter(session.id, null);

assert.equal(
  await refCountOf(a.entryId, a.version),
  beforeA - 1,
  "A 的 read 引用精确 −1",
);
assert.equal(
  await refCountOf(b.entryId, b.version),
  beforeB - 1,
  "B 的 read 引用精确 −1",
);
    // 坏行不拖累其它行：清空整体成功、正常行照常减。
    const remaining = await ctx.messages.listBySession(session.id);
    assert.equal(remaining.length, 0);
  });

  it("T-TRUNC-RT3 产出写集合的读与删落在同一连接（事务内）", async () => {
    const project = await ctx.projects.create(`P-tr3-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", textFields("x"));

    // 观测面 = **连接身份 + 调用顺序**：更好的-sqlite3 的 BEGIN/COMMIT 不经
    // conn.execute 发出，SqlCounter 记不到事务边界；改断言「产出写集合的读」与
    // 「删」用的是**同一个连接对象**，且该对象不是根连接（即确实在写事务句柄上）。
    const proto = SqliteMessageRepository.prototype;
    const origTargets = proto.listReadRefTargetsBySession;
    const origDelete = proto.deleteBySession;
    const readConns: unknown[] = [];
    const deleteConns: unknown[] = [];
    const order: string[] = [];
    proto.listReadRefTargetsBySession = function patched(
      this: SqliteMessageRepository,
      ...args: never[]
    ) {
      readConns.push((this as unknown as { conn: unknown }).conn);
      order.push("read");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origTargets as any).apply(this, args);
    } as typeof origTargets;
    proto.deleteBySession = function patched(
      this: SqliteMessageRepository,
      ...args: never[]
    ) {
      deleteConns.push((this as unknown as { conn: unknown }).conn);
      order.push("delete");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origDelete as any).apply(this, args);
    } as typeof origDelete;
    try {
      await ctx.messages.truncateAfter(session.id, null);
    } finally {
      proto.listReadRefTargetsBySession = origTargets;
      proto.deleteBySession = origDelete;
    }

    assert.equal(readConns.length, 1, "读必须恰好一次");
    assert.equal(deleteConns.length, 1, "删必须恰好一次");
    assert.equal(readConns[0], deleteConns[0], "读与删必须在同一事务句柄上");
    assert.notEqual(readConns[0], ctx.conn, "不得在根连接上做事务内读写");
    assert.deepEqual(order, ["read", "delete"], "读必须在删之前");
  });

  it("T-TRUNC-RT4 checkpoint / backfill 游标 / tool_use 缓存失效三件套照旧", async () => {
    const project = await ctx.projects.create(`P-tr4-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/z.md", "Z", {
      versionCheck: false,
    });
    const m1 = await ctx.messages.append(session.id, "user", textFields("y"));
    await ctx.messageCheckpoint.capture(session.id, project.id, m1.id);
    const m2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [
        { type: "text", text: "调用" },
        {
          type: "tool_use",
          id: "tu-1",
          name: "read",
          input: { path: "/z.md" },
        },
      ],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);

    const ckBefore = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM message_checkpoint WHERE session_id = ?`,
      [session.id],
    );
    assert.ok(
      Number(ckBefore[0]!.n) > 0,
      "前置：capture 必须真的建出 checkpoint 行"
    );

    await ctx.messages.truncateAfter(session.id, null);

    const ckAfter = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM message_checkpoint WHERE session_id = ?`,
      [session.id],
    );
    assert.equal(Number(ckAfter[0]!.n), 0, "清空后 checkpoint 不得留孤儿");

    const usageStats = await ctx.sessionKkv.get(
      session.id,
      "usage_stats",
      "toolUseCount",
    );
    assert.notEqual(usageStats, null, "tool_use 缓存失效哨兵必须写入");
  });
});