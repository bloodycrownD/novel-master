/**
 * C1-5：`deleteSessionTree` / 删项目路径复用窄投影读口（21 列 → 4 列）。
 *
 * 与 C1-2 同读口族：读**留在事务内**（产出的正是要减的写集合），
 * 本条只降列数、不动事务边界。观测面 = repository prototype spy + 真实
 * `vfs_revision.ref_count` 行对账。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { scopeKey } from "../../src/domain/vfs/logic/vfs-path-mapper.js";
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

async function seedRevision(
  projectId: string,
  sessionId: string,
  path: string,
  body: string
): Promise<{ entryId: number; version: number; contentHash: string }> {
  const written = await ctx
    .sessionVfs(projectId, sessionId)
    .write(path, body, { versionCheck: false });
  const entries = new SqliteVfsEntryRepository(ctx.conn);
  const sk = scopeKey({ kind: "session", projectId, sessionId });
  const entry = await entries.findByPath(sk, path);
  assert.ok(entry != null);
  const contentHash = await entries.findContentHash(sk, path);
  assert.ok(contentHash != null && contentHash !== "");
  return { entryId: entry.entryId, version: written.version, contentHash };
}

async function appendReadRef(
  sessionId: string,
  ref: { entryId: number; version: number; contentHash: string },
  path: string
): Promise<void> {
  const block = buildToolResultBlock(
    `tu-${testIsolationSuffix()}`,
    {
      ok: true,
      output: {
        path,
        entryId: ref.entryId,
        version: ref.version,
        contentHash: ref.contentHash,
        totalBytes: 1,
        offset: 1,
        returnedLines: 1,
        totalLines: 1,
        truncated: false,
      },
    },
    { toolName: "read" },
  );
  assert.ok(block.contentRef != null);
  const { adjustReadRefCount } = await import(
    "../../src/domain/vfs/logic/revision-ref-count.js"
  );
  const { SqliteVfsRevisionRepository } = await import(
    "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js"
  );
  // 消息 append 本身不做 read 引用 +1（那是工具执行时的显式通道），这里补上
  // 与生产一致的 +1，让删除链的 −1 有真实对账面。
  await adjustReadRefCount(
    new SqliteVfsRevisionRepository(ctx.conn),
    [{ entryId: ref.entryId, version: ref.version }],
    +1,
  );
  await ctx.messages.append(sessionId, "user", { blocks: [block] });
}

/** ref_count 行；行不存在 = 已被 GC（返回 null）。 */
async function refCountOf(
  entryId: number,
  version: number
): Promise<number | null> {
  const rows = await ctx.conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version],
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
}

describe("删会话 / 删项目：窄投影读口 + read 引用对账", () => {
  it("T-DEL-RT1 删会话零次全量读、每会话一次窄投影", async () => {
    const project = await ctx.projects.create(`P-del1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    for (let i = 0; i < 20; i++) {
      await ctx.messages.append(session.id, "user", {
        blocks: [{ type: "text", text: `m${i}` }],
      });
    }
    const spy = spyReadMouths();
    try {
      await ctx.sessions.delete(session.id);
    } finally {
      spy.restore();
    }
    assert.equal(spy.listBySession(), 0);
    assert.equal(spy.listReadRefTargetsBySession(), 1);
  });

  it("T-DEL-RT2/RT3 子会话递归删除的 read 引用逐条 −1，父仍引用的 revision 不被误 GC", async () => {
    const project = await ctx.projects.create(`P-del2-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id);
    const child = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "child",
    );
    assert.ok(child != null);

    const shared = await seedRevision(project.id, parent.id, "/shared.md", "S");
    await appendReadRef(parent.id, shared, "/shared.md");
    const beforeParent = await refCountOf(shared.entryId, shared.version);
    assert.ok(beforeParent != null && beforeParent >= 1);

    // 子会话持有同一 pair：删子会话后父侧仍持有 ⇒ ref_count 只减到父的持有数。
    await appendReadRef(child.id, shared, "/shared.md");
    const beforeChild = await refCountOf(shared.entryId, shared.version);
    assert.equal(beforeChild, beforeParent! + 1);

    await ctx.sessions.delete(parent.id);
    // 父 + 子各 −1 ⇒ 归零后被 GC（行不存在）。
    assert.equal(
      await refCountOf(shared.entryId, shared.version),
      null,
      "父删完后 pair 归零并被 GC",
    );
    // 递归：父子两个会话的消息/VFS 行全清。
    const parentMsgs = await ctx.messages.listBySession(parent.id);
    const childMsgs = await ctx.messages.listBySession(child.id);
    assert.equal(parentMsgs.length, 0);
    assert.equal(childMsgs.length, 0);
  });

  it("T-DEL-RT4 删项目路径（BFS 多会话）零次全量读、每会话一次窄投影", async () => {
    const project = await ctx.projects.create(`P-del4-${testIsolationSuffix()}`);
    const top = await ctx.sessions.create(project.id);
    const top2 = await ctx.sessions.create(project.id);
    const sub = await ctx.sessions.createSubSession(top.id, project.id, "sub");
    assert.ok(sub != null);
    for (const sid of [top.id, top2.id, sub.id]) {
      await ctx.messages.append(sid, "user", {
        blocks: [{ type: "text", text: "m" }],
      });
    }

    const spy = spyReadMouths();
    try {
      await ctx.projects.delete(project.id);
    } finally {
      spy.restore();
    }
    assert.equal(spy.listBySession(), 0, "删项目路径不得触发全量读口");
    // BFS 展开 3 个会话（top / top2 / sub）。
    assert.equal(spy.listReadRefTargetsBySession(), 3);
  });

  it("T-DEL-RT5 120 条消息下窄投影查询只取 4 列", async () => {
    // 夹具实数：120 条消息（不是用例名以前写的 500 条）。
    //
    // ⚠ 本条**只钉列数收窄**，不钉让步点：C1-5 修法 3（`yieldFn` 透传 /
    // `reposFor(tx, yieldFn)`）本波未做 ⇒ `deleteSessionTree` 仍是同步 parse，
    // 没有让步点可数。spec 的 I6 也写明「仅当修法 3 做了才立」。
    const project = await ctx.projects.create(`P-del5-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    for (let i = 0; i < 120; i++) {
      await ctx.messages.append(session.id, "user", {
        blocks: [{ type: "text", text: `m${i}` }],
      });
    }
    counter.clear();
    await ctx.sessions.delete(session.id);
    const selects = counter
      .all()
      .filter((r) => r.kind === "SELECT" && r.sql.includes("FROM chat_message"));
    assert.equal(selects.length, 1);
    const sql = selects[0]!.sql;
    assert.ok(sql.includes("content_json"));
    for (const heavy of ["raw_json", "attachments_json", "total_tokens"]) {
      assert.equal(sql.includes(heavy), false, `${heavy} 不得出现在窄投影里`);
    }
  });
});